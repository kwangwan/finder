"""
What a document is attached to, and what a file is used by.

The document's own content is the single source of truth: every save reads
the file references out of the markdown and makes the link rows say the same
thing. That way attaching and detaching need no special handling of their own
— pasting an image, dropping a file, deleting the block again, restoring an
older version, all of it ends up as one content change, and the links follow.
"""

import re
import uuid
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BoardTask, FileItem, FileLink

# Every way a file's id can appear in a document: media uploaded into the
# editor, a download link, and the "보관함 파일 첨부" card.
_UUID = r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
REFERENCE_PATTERNS = [
    re.compile(rf"/api/storage/preview/{_UUID}"),
    re.compile(rf"/api/storage/download/{_UUID}"),
    re.compile(rf"/api/storage/presigned-download/{_UUID}"),
    re.compile(rf"/api/files/{_UUID}/download"),
]


def referenced_file_ids(content: Optional[str]) -> Set[uuid.UUID]:
    """The files a document's markdown points at."""
    found: Set[uuid.UUID] = set()
    if not content:
        return found
    for pattern in REFERENCE_PATTERNS:
        for raw in pattern.findall(content):
            try:
                found.add(uuid.UUID(raw))
            except ValueError:
                continue
    return found


async def sync_document_links(db: AsyncSession, document: FileItem) -> None:
    """
    Make the link rows agree with what the document now says.

    Not committed here — it runs inside whatever transaction saved the
    document, so the content and the links can never disagree.
    """
    if not document.is_markdown:
        return

    wanted = referenced_file_ids(document.content)
    wanted.discard(document.id)

    if wanted:
        # Only files that actually exist. A reference to something already
        # deleted for good stays in the text as a broken attachment, which is
        # what the document view reports; there is no row to keep for it.
        existing = set((await db.execute(
            select(FileItem.id).where(FileItem.id.in_(wanted))
        )).scalars().all())
        wanted = wanted & existing

    current_rows = (await db.execute(
        select(FileLink).where(FileLink.document_id == document.id)
    )).scalars().all()
    current = {row.target_file_id: row for row in current_rows}

    for target_id in wanted - set(current):
        db.add(FileLink(document_id=document.id, target_file_id=target_id))
    for target_id in set(current) - wanted:
        await db.delete(current[target_id])


async def documents_referencing(db: AsyncSession, file_id: uuid.UUID) -> List[FileItem]:
    """The documents that have this file attached, trashed ones included."""
    return list((await db.execute(
        select(FileItem)
        .join(FileLink, FileLink.document_id == FileItem.id)
        .where(FileLink.target_file_id == file_id)
        .order_by(FileItem.name)
    )).scalars().all())


async def documents_referencing_many(db: AsyncSession, file_ids: Iterable[uuid.UUID]) -> Dict[uuid.UUID, List[FileItem]]:
    """The same, for a batch — one query rather than one per file."""
    ids = [fid for fid in set(file_ids) if fid]
    if not ids:
        return {}
    rows = (await db.execute(
        select(FileLink.target_file_id, FileItem)
        .join(FileItem, FileItem.id == FileLink.document_id)
        .where(FileLink.target_file_id.in_(ids))
        .order_by(FileItem.name)
    )).all()
    out: Dict[uuid.UUID, List[FileItem]] = {}
    for target_id, document in rows:
        out.setdefault(target_id, []).append(document)
    return out


async def attachments_of(db: AsyncSession, document_id: uuid.UUID) -> List[FileItem]:
    """The files a document has attached, in the order they were attached."""
    return list((await db.execute(
        select(FileItem)
        .join(FileLink, FileLink.target_file_id == FileItem.id)
        .where(FileLink.document_id == document_id)
        .order_by(FileLink.created_at)
    )).scalars().all())


async def missing_attachment_count(db: AsyncSession, document: FileItem) -> int:
    """
    How many of a document's attachments are gone — deleted for good, so no
    link row is left, or sitting in the trash.
    """
    if not document.is_markdown:
        return 0
    referenced = referenced_file_ids(document.content)
    referenced.discard(document.id)
    if not referenced:
        return 0
    alive = set((await db.execute(
        select(FileItem.id).where(and_(
            FileItem.id.in_(referenced), FileItem.is_trashed.is_(False),
        ))
    )).scalars().all())
    return len(referenced - alive)


async def owning_task(db: AsyncSession, file_id: uuid.UUID) -> Optional[BoardTask]:
    """The 할 일 this document belongs to, if it is one's document."""
    return (await db.execute(
        select(BoardTask).where(BoardTask.document_id == file_id)
    )).scalars().first()


async def owning_tasks(db: AsyncSession, file_ids: Iterable[uuid.UUID]) -> Dict[uuid.UUID, BoardTask]:
    ids = [fid for fid in set(file_ids) if fid]
    if not ids:
        return {}
    rows = (await db.execute(
        select(BoardTask).where(BoardTask.document_id.in_(ids))
    )).scalars().all()
    return {row.document_id: row for row in rows}
