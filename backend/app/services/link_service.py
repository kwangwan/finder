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

from sqlalchemy import select
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


def not_task_document():
    """
    A condition for listings: leave out documents that belong to a 할 일.

    They are real documents — searched, embedded, opened in a window like any
    other — but they are reached through their 일정, not by browsing the folder
    the board happens to sit in. A board of thirty 할 일 would otherwise bury
    everything else in the folder it lives in.
    """
    return ~select(BoardTask.id).where(BoardTask.document_id == FileItem.id).exists()


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


async def rename_owning_task(db: AsyncSession, file_item) -> bool:
    """
    Carry a 할 일 document's new title back to the 할 일 itself.

    The two are one thing wearing two faces: the board row and the document
    are created together and deleted together, and the name is the same name.
    Renaming from the board already updated the document; without this, doing
    it from the document left the board saying something else.
    """
    if file_item is None:
        return False
    task = (await owning_tasks(db, [file_item.id])).get(file_item.id)
    if task is None or task.name == file_item.name:
        return False
    task.name = file_item.name
    return True
