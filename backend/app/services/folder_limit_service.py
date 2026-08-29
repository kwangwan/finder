import uuid
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Folder, Workspace

# How many folders one location may hold directly.
#
# Files are paginated; folders are not — every folder at a location is fetched
# and rendered at once, in the grid and in the sidebar tree alike. That is fine
# for a working number of folders and stops being fine well before the database
# would notice, so the ceiling is a rendering one, not a storage one. 100 is far
# above what anyone organises by hand and far below where the tree drags.
MAX_CHILD_FOLDERS = 100


async def _is_shared_workspace(db: AsyncSession, workspace_id) -> bool:
    if not workspace_id:
        return False
    return bool((await db.execute(
        select(Workspace.is_shared).where(Workspace.id == workspace_id)
    )).scalar_one_or_none())


async def is_exempt(db: AsyncSession, workspace_id, parent_id: Optional[uuid.UUID]) -> bool:
    """
    The shared workspace's home is the one place that grows with the user count
    rather than with anyone's filing: it holds exactly one folder per person,
    and nobody can trim it. It has its own search and paging for that reason,
    so it is deliberately left uncapped. Everywhere else is somebody's own
    filing, and a cap there is a cap on what one person can do to a shared view.
    """
    return parent_id is None and await _is_shared_workspace(db, workspace_id)


async def count_children(
    db: AsyncSession,
    workspace_id,
    parent_id: Optional[uuid.UUID],
    excluding: Optional[Iterable[uuid.UUID]] = None,
) -> int:
    """
    How many folders sit directly at this location.

    `excluding` leaves out folders that are about to leave it — a batch move
    within the same parent would otherwise count them on both sides and refuse
    a rearrangement that adds nothing.
    """
    q = select(func.count(Folder.id)).where(
        Folder.workspace_id == workspace_id,
        Folder.is_trashed == False,  # noqa: E712
    )
    q = q.where(Folder.parent_id.is_(None) if parent_id is None else Folder.parent_id == parent_id)
    ids = [i for i in (excluding or []) if i]
    if ids:
        q = q.where(Folder.id.notin_(ids))
    return (await db.execute(q)).scalar_one() or 0


async def has_room(db: AsyncSession, workspace_id, parent_id: Optional[uuid.UUID], adding: int = 1) -> bool:
    if await is_exempt(db, workspace_id, parent_id):
        return True
    return await count_children(db, workspace_id, parent_id) + adding <= MAX_CHILD_FOLDERS


async def require_room(
    db: AsyncSession,
    workspace_id,
    parent_id: Optional[uuid.UUID],
    adding: int = 1,
    excluding: Optional[Iterable[uuid.UUID]] = None,
) -> None:
    """
    Refuse before anything happens when a location cannot take them all.

    Checked for the whole batch rather than per item on the way through. Half a
    move is nobody's intention: the user picked a set, and being told after the
    fact that some of it went and some of it did not leaves them to work out
    which — so the answer has to come before the first one moves.
    """
    if await is_exempt(db, workspace_id, parent_id):
        return
    current = await count_children(db, workspace_id, parent_id, excluding=excluding)
    if current + adding <= MAX_CHILD_FOLDERS:
        return
    where = "홈" if parent_id is None else "이 폴더"
    room = max(0, MAX_CHILD_FOLDERS - current)
    if adding > 1:
        detail = (
            f"{where} 안에는 폴더를 최대 {MAX_CHILD_FOLDERS}개까지 둘 수 있습니다. "
            f"현재 {current}개라 {room}개만 더 들어갈 수 있는데 {adding}개를 옮기려 했습니다. "
            f"일부만 옮기지 않고 취소했습니다. 폴더를 정리한 뒤 다시 시도해 주세요."
        )
    else:
        detail = (
            f"{where} 안에는 폴더를 최대 {MAX_CHILD_FOLDERS}개까지 둘 수 있습니다. "
            f"현재 {current}개입니다. 폴더를 정리하거나 하위 폴더로 나눠 주세요."
        )
    raise HTTPException(status_code=409, detail=detail)
