import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_approved_user
from app.models import User, UserWindowState, FileItem
from app.services.access_service import access_service

router = APIRouter(prefix="/api/window-state", tags=["Window State"])

# A taskbar that has grown past this is unusable anyway, and the cap keeps a
# runaway client from writing an unbounded blob into the row.
MAX_WINDOWS = 40


class WindowEntry(BaseModel):
    file_id: uuid.UUID
    is_minimized: bool = False


class WindowStateResponse(BaseModel):
    windows: List[WindowEntry] = Field(default_factory=list)
    updated_at: Optional[datetime] = None


class WindowStateUpdate(BaseModel):
    windows: List[WindowEntry] = Field(default_factory=list)


@router.get("", response_model=WindowStateResponse)
async def get_window_state(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Return the user's open-window list.

    Entries are filtered against what the user can still reach, so a file
    that was trashed, deleted, or moved into a workspace they were removed
    from simply drops out of the taskbar rather than restoring as a window
    that cannot load. That check is done here rather than left to the client,
    which would otherwise have to fetch every entry just to discover it is
    gone.
    """
    row = (await db.execute(
        select(UserWindowState).where(UserWindowState.user_id == current_user.id)
    )).scalar_one_or_none()
    if not row or not row.windows:
        return WindowStateResponse(windows=[], updated_at=row.updated_at if row else None)

    entries = [e for e in row.windows if isinstance(e, dict) and e.get("file_id")]
    if not entries:
        return WindowStateResponse(windows=[], updated_at=row.updated_at)

    ids = []
    for e in entries:
        try:
            ids.append(uuid.UUID(str(e["file_id"])))
        except (ValueError, TypeError):
            continue

    found = (await db.execute(
        select(FileItem.id).where(FileItem.id.in_(ids), FileItem.is_trashed == False)  # noqa: E712
    )).scalars().all()
    alive = set(found)

    visible = []
    for e in entries:
        try:
            fid = uuid.UUID(str(e["file_id"]))
        except (ValueError, TypeError):
            continue
        if fid not in alive:
            continue
        if not await access_service.can_access_file(db, current_user, fid):
            continue
        visible.append(WindowEntry(file_id=fid, is_minimized=bool(e.get("is_minimized"))))

    return WindowStateResponse(windows=visible, updated_at=row.updated_at)


@router.put("", response_model=WindowStateResponse)
async def put_window_state(
    req: WindowStateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """Replace the user's open-window list (last write wins)."""
    entries = [
        {"file_id": str(w.file_id), "is_minimized": bool(w.is_minimized)}
        for w in req.windows[:MAX_WINDOWS]
    ]

    row = (await db.execute(
        select(UserWindowState).where(UserWindowState.user_id == current_user.id)
    )).scalar_one_or_none()
    if row is None:
        row = UserWindowState(user_id=current_user.id, windows=entries)
        db.add(row)
    else:
        row.windows = entries
        # onupdate only fires when a mapped column actually changes; writing
        # the same list twice would otherwise leave updated_at stale and make
        # other clients think nothing had happened.
        row.updated_at = datetime.now(tz=None).astimezone()

    await db.commit()
    await db.refresh(row)
    return WindowStateResponse(
        windows=[WindowEntry(file_id=uuid.UUID(e["file_id"]), is_minimized=e["is_minimized"]) for e in row.windows],
        updated_at=row.updated_at,
    )
