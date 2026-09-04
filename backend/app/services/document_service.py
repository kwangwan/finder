import uuid
from typing import Optional
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from app.models import FileItem, DocumentChunk
from app.services.chunking_service import chunking_service
from app.services.embedding_service import embedding_service
from app.services.s3_service import s3_service

class DocumentService:
    async def index_file_chunks_safely(
        self, db: AsyncSession, file_item: FileItem, raw_bytes: Optional[bytes] = None
    ) -> int:
        """
        Index what can be indexed, and never take the caller down with it.

        Indexing runs at the end of a save or an upload, after the file itself
        is stored and committed, so it has nothing left to undo — but a failure
        inside it leaves the session needing a rollback, and every caller went
        on to read the file it had just written and got a broken session
        instead. That is how one PDF carrying a NUL byte in its text turned
        into a failed upload of a file that was, in fact, already stored.

        Rolled back and re-read here so the caller is handed a session it can
        keep using and a file it can still read.
        """
        try:
            return await self.index_file_chunks(db, file_item, raw_bytes=raw_bytes)
        except Exception as e:
            print(f"[Embedding Warning] Indexing failed for {file_item.id}: {e}")
            try:
                await db.rollback()
                await db.refresh(file_item)
            except Exception as recovery_error:  # pragma: no cover - nothing left to do
                print(f"[Embedding Warning] Could not recover the session: {recovery_error}")
            return 0

    async def index_file_chunks(self, db: AsyncSession, file_item: FileItem, raw_bytes: Optional[bytes] = None) -> int:
        """
        Chunk and embed the content of a file item (Markdown, PDF, Word DOCX, Excel XLSX, plain text)
        and replace its existing document chunks in the database.
        """
        content_to_index = ""
        file_name_lower = file_item.name.lower()

        # 1. Determine text to index based on file format
        if file_item.is_markdown or file_name_lower.endswith(".md") or file_item.file_type in ["text", "code"]:
            content_to_index = file_item.content or ""
        
        # 2. Extract from PDF
        elif file_name_lower.endswith(".pdf") or file_item.file_type == "pdf":
            pdf_bytes = raw_bytes or (await run_in_threadpool(s3_service.get_object_content, file_item.s3_key) if file_item.s3_key else None)
            if pdf_bytes:
                content_to_index = await run_in_threadpool(chunking_service.extract_text_from_pdf, pdf_bytes)
                if not file_item.content and content_to_index:
                    file_item.content = content_to_index[:50000]

        # 3. Extract from Word (.docx)
        elif file_name_lower.endswith(".docx") or file_item.file_type in ["docx", "word"]:
            doc_bytes = raw_bytes or (await run_in_threadpool(s3_service.get_object_content, file_item.s3_key) if file_item.s3_key else None)
            if doc_bytes:
                content_to_index = await run_in_threadpool(chunking_service.extract_text_from_docx, doc_bytes)
                if not file_item.content and content_to_index:
                    file_item.content = content_to_index[:50000]

        # 4. Extract from Excel (.xlsx, .xls)
        elif file_name_lower.endswith(".xlsx") or file_name_lower.endswith(".xls") or file_item.file_type in ["xlsx", "excel", "sheet"]:
            xls_bytes = raw_bytes or (await run_in_threadpool(s3_service.get_object_content, file_item.s3_key) if file_item.s3_key else None)
            if xls_bytes:
                content_to_index = await run_in_threadpool(chunking_service.extract_text_from_excel, xls_bytes)
                if not file_item.content and content_to_index:
                    file_item.content = content_to_index[:50000]

        # If still no content but file_item.content has text (e.g. uploaded text)
        if not content_to_index and file_item.content:
            content_to_index = file_item.content

        # Whatever the source — an extractor, or text typed into the editor —
        # what goes into a database column has to be something a column can
        # hold. See chunking_service.sanitize_text.
        content_to_index = chunking_service.sanitize_text(content_to_index)

        # If there is no extractable text content (e.g. image-only PDF, empty note, raw media), do not embed
        if not content_to_index or not content_to_index.strip():
            await db.execute(delete(DocumentChunk).where(DocumentChunk.file_id == file_item.id))
            file_item.is_embedded = False
            file_item.embedded_chunks_count = 0
            await db.commit()
            return 0

        # 2. Chunk content
        if file_item.is_markdown or file_name_lower.endswith(".md"):
            chunks = chunking_service.chunk_markdown(content_to_index)
        else:
            chunks = chunking_service.chunk_plain_text(content_to_index)

        if not chunks:
            await db.execute(delete(DocumentChunk).where(DocumentChunk.file_id == file_item.id))
            file_item.is_embedded = False
            file_item.embedded_chunks_count = 0
            await db.commit()
            return 0

        # 3. Delete existing chunks for this file
        await db.execute(delete(DocumentChunk).where(DocumentChunk.file_id == file_item.id))

        # 4. Generate embeddings and create new DocumentChunk rows
        chunk_count = 0
        for item in chunks:
            chunk_text = item["content"]
            embedding = await embedding_service.get_embedding(chunk_text)
            
            chunk_row = DocumentChunk(
                file_id=file_item.id,
                chunk_index=item["chunk_index"],
                content=chunk_text,
                embedding=embedding
            )
            db.add(chunk_row)
            chunk_count += 1

        file_item.is_embedded = (chunk_count > 0)
        file_item.embedded_chunks_count = chunk_count
        await db.commit()
        return chunk_count

document_service = DocumentService()
