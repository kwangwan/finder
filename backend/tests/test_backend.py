import pytest
from app.models import Folder, FileItem, DocumentChunk
from app.services.chunking_service import chunking_service
from app.services.embedding_service import embedding_service
from app.services.document_service import document_service
from app.services.search_service import search_service
from app.schemas.search import SearchRequest

def test_markdown_chunking():
    md = """# Introduction
This is the knowledge base overview.

## Section 1: Features
- Markdown editor
- Folder hierarchy
- Vector similarity search

## Section 2: Storage
MinIO is used for files with multipart chunks.
"""
    chunks = chunking_service.chunk_markdown(md)
    assert len(chunks) >= 2
    assert any("Introduction" in c["content"] for c in chunks)
    assert any("Features" in c["content"] for c in chunks)

@pytest.mark.asyncio
async def test_embedding_generation():
    emb = await embedding_service.get_embedding("This is a test document for personal knowledge base.")
    assert emb is not None
    assert len(emb) == 768

@pytest.mark.asyncio
async def test_note_creation_and_search(db_session):
    # 1. Create a test folder
    folder = Folder(name="AI 연구 폴더")
    db_session.add(folder)
    await db_session.commit()
    await db_session.refresh(folder)

    # 2. Create a test markdown note
    note = FileItem(
        folder_id=folder.id,
        name="인공지능 지식 베이스 아키텍처.md",
        file_type="note",
        content="# 인공지능 지식저장소 구축\n\nFastAPI와 React를 사용하고 PostgreSQL pgvector를 통해 시맨틱 유사도 검색을 수행합니다.",
        is_markdown=True
    )
    db_session.add(note)
    await db_session.commit()
    await db_session.refresh(note)

    # 3. Index chunks with embedding
    chunk_count = await document_service.index_file_chunks(db_session, note)
    assert chunk_count > 0
    assert note.is_embedded is True
    assert note.embedded_chunks_count == chunk_count

    # 4. Perform semantic search
    search_req = SearchRequest(query="FastAPI와 pgvector로 벡터 검색", min_similarity=0.1)
    search_res = await search_service.search(db_session, search_req)
    assert search_res.total_results > 0
    assert any(r.file_id == note.id for r in search_res.results)

    # 5. Clean up test data
    await db_session.delete(note)
    await db_session.delete(folder)
    await db_session.commit()


@pytest.mark.asyncio
async def test_nested_folder_hierarchy(db_session):
    # Test infinite depth folder nesting (Level 1 -> Level 2 -> Level 3 -> Level 4)
    f1 = Folder(name="1단계 상위")
    db_session.add(f1)
    await db_session.commit()
    await db_session.refresh(f1)

    f2 = Folder(name="2단계 하위", parent_id=f1.id)
    db_session.add(f2)
    await db_session.commit()
    await db_session.refresh(f2)

    f3 = Folder(name="3단계 하위", parent_id=f2.id)
    db_session.add(f3)
    await db_session.commit()
    await db_session.refresh(f3)

    f4 = Folder(name="4단계 하위", parent_id=f3.id)
    db_session.add(f4)
    await db_session.commit()
    await db_session.refresh(f4)

    assert f4.parent_id == f3.id
    assert f3.parent_id == f2.id
    assert f2.parent_id == f1.id

    # Clean up test data
    await db_session.delete(f4)
    await db_session.delete(f3)
    await db_session.delete(f2)
    await db_session.delete(f1)
    await db_session.commit()
