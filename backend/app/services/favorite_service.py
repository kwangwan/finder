import logging
import uuid
from typing import Iterable, Optional

from sqlalchemy import String, and_, case, cast, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting, Favorite, FileItem, Folder, User

logger = logging.getLogger(__name__)

FOLDER = "folder"
FILE = "file"

# Marks the one-time move of the old per-file `is_favorite` column into this
# table, so the backfill runs once rather than on every start.
BACKFILL_KEY = "favorites.backfilled_from_file_column"


def file_favorite_condition(user_id: uuid.UUID, wanted: bool):
    """
    A filter for "files this user has favourited", for use in the file list
    queries. EXISTS rather than a join so the row count is untouched.
    """
    sub = exists().where(and_(
        Favorite.user_id == user_id,
        Favorite.target_type == FILE,
        Favorite.target_id == FileItem.id,
    ))
    return sub if wanted else ~sub


async def favorite_ids(db: AsyncSession, user_id: uuid.UUID, target_type: str, ids: Iterable[uuid.UUID]) -> set:
    """Which of these are favourites of this user — for marking up a listing."""
    ids = [i for i in ids if i]
    if not ids:
        return set()
    rows = (await db.execute(
        select(Favorite.target_id).where(
            Favorite.user_id == user_id,
            Favorite.target_type == target_type,
            Favorite.target_id.in_(ids),
        )
    )).scalars().all()
    return set(rows)


async def is_favorite(db: AsyncSession, user_id: uuid.UUID, target_type: str, target_id: uuid.UUID) -> bool:
    return (await db.execute(
        select(Favorite.id).where(
            Favorite.user_id == user_id,
            Favorite.target_type == target_type,
            Favorite.target_id == target_id,
        )
    )).scalar_one_or_none() is not None


async def set_favorite(
    db: AsyncSession,
    user_id: uuid.UUID,
    target_type: str,
    target_id: uuid.UUID,
    workspace_id: Optional[uuid.UUID],
    on: bool,
) -> bool:
    """Add or remove. Idempotent in both directions; returns the new state."""
    existing = (await db.execute(
        select(Favorite).where(
            Favorite.user_id == user_id,
            Favorite.target_type == target_type,
            Favorite.target_id == target_id,
        )
    )).scalars().first()

    if on and existing is None:
        db.add(Favorite(
            user_id=user_id,
            workspace_id=workspace_id,
            target_type=target_type,
            target_id=target_id,
        ))
        try:
            await db.commit()
        except IntegrityError:
            # Two tabs pressing the star at once; the row exists either way.
            await db.rollback()
    elif not on and existing is not None:
        await db.delete(existing)
        await db.commit()
    return on


async def drop_favorites(db: AsyncSession, target_type: str, target_ids: Iterable[uuid.UUID]) -> None:
    """
    Forget favourites pointing at things that no longer exist.

    Called when a target is permanently deleted. Reads already skip missing
    targets, so this is housekeeping rather than correctness — but without it
    the table only ever grows.
    """
    target_ids = [i for i in target_ids if i]
    if not target_ids:
        return
    rows = (await db.execute(
        select(Favorite).where(Favorite.target_type == target_type, Favorite.target_id.in_(target_ids))
    )).scalars().all()
    for row in rows:
        await db.delete(row)


async def list_favorites(
    db: AsyncSession,
    user: User,
    workspace_ids: Optional[Iterable[uuid.UUID]],
    kind: str = "all",
    q: Optional[str] = None,
    page: int = 1,
    page_size: int = 24,
):
    """
    One page of this user's favourites, newest first.

    Targets that were deleted or moved to the trash are left out rather than
    listed as broken rows: a shortcut to something that is not there is worse
    than no shortcut. Search matches the target's name.
    """
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    like = f"%{q.strip()}%" if q and q.strip() else None

    def scoped(model, target_type):
        conds = [
            Favorite.user_id == user.id,
            Favorite.target_type == target_type,
            model.id == Favorite.target_id,
            model.is_trashed == False,  # noqa: E712
        ]
        if workspace_ids is not None:
            conds.append(model.workspace_id.in_(list(workspace_ids)))
        if like is not None:
            conds.append(model.name.ilike(like))
        return conds

    folder_q = select(
        Favorite.id.label("fav_id"),
        Favorite.created_at.label("fav_at"),
        Favorite.target_type.label("kind"),
        Folder.id.label("target_id"),
        Folder.name.label("name"),
        Folder.workspace_id.label("workspace_id"),
        Folder.parent_id.label("parent_id"),
        cast(Folder.color, String).label("color"),
    ).select_from(Favorite).join(Folder, Folder.id == Favorite.target_id).where(and_(*scoped(Folder, FOLDER)))

    file_q = select(
        Favorite.id.label("fav_id"),
        Favorite.created_at.label("fav_at"),
        Favorite.target_type.label("kind"),
        FileItem.id.label("target_id"),
        FileItem.name.label("name"),
        FileItem.workspace_id.label("workspace_id"),
        FileItem.folder_id.label("parent_id"),
        cast(FileItem.file_type, String).label("color"),
    ).select_from(Favorite).join(FileItem, FileItem.id == Favorite.target_id).where(and_(*scoped(FileItem, FILE)))

    if kind == FOLDER:
        union = folder_q
    elif kind == FILE:
        union = file_q
    else:
        union = folder_q.union_all(file_q)

    sub = union.subquery()
    total = (await db.execute(select(func.count()).select_from(sub))).scalar_one()

    # Folders first: they are containers, and burying one between files makes a
    # mixed list hard to scan. Ranked explicitly — sorting on the kind string
    # puts "file" before "folder".
    kind_rank = case((sub.c.kind == FOLDER, 0), else_=1)
    rows = (await db.execute(
        select(sub)
        .order_by(kind_rank.asc(), sub.c.fav_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).all()

    items = [
        {
            "kind": r.kind,
            "id": str(r.target_id),
            "name": r.name,
            "workspace_id": str(r.workspace_id) if r.workspace_id else None,
            "parent_id": str(r.parent_id) if r.parent_id else None,
            "color": r.color if r.kind == FOLDER else None,
            "file_type": r.color if r.kind == FILE else None,
            "favorited_at": r.fav_at,
        }
        for r in rows
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


async def backfill_from_file_column(db: AsyncSession) -> None:
    """
    Move the old per-file favourite flag into this table, once.

    The flag lived on the file, so in the shared workspace one person's
    favourite was everyone's. There is no record of who set it, so it is
    credited to whoever uploaded the file — the only defensible guess, and it
    keeps their existing list intact instead of dropping it on upgrade.
    """
    done = (await db.execute(
        select(AppSetting).where(AppSetting.key == BACKFILL_KEY)
    )).scalars().first()
    if done is not None:
        return

    rows = (await db.execute(
        select(FileItem.id, FileItem.created_by, FileItem.workspace_id).where(
            FileItem.is_favorite == True,  # noqa: E712
            FileItem.created_by.isnot(None),
        )
    )).all()

    added = 0
    for file_id, owner_id, ws_id in rows:
        exists_row = (await db.execute(
            select(Favorite.id).where(
                Favorite.user_id == owner_id,
                Favorite.target_type == FILE,
                Favorite.target_id == file_id,
            )
        )).scalar_one_or_none()
        if exists_row is None:
            db.add(Favorite(user_id=owner_id, workspace_id=ws_id, target_type=FILE, target_id=file_id))
            added += 1

    db.add(AppSetting(key=BACKFILL_KEY, value="1"))
    await db.commit()
    logger.info(f"[Favorites] backfilled {added} file favourite(s) from the old column")
