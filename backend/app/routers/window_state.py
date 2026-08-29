import asyncio
import json
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, AsyncSessionLocal
from app.core.security import get_current_approved_user
from app.models import User, UserWindowState, FileItem, Folder
from app.services.access_service import access_service

router = APIRouter(prefix="/api/window-state", tags=["Window State"])

# A taskbar that has grown past this is unusable anyway, and the cap keeps a
# runaway client from writing an unbounded blob into the row.
MAX_WINDOWS = 40

# How long a stream may sit silent before a keep-alive comment goes out.
# Idle connections are otherwise liable to be dropped by the reverse proxy
# and the Cloudflare Tunnel in front of this app, which look identical to a
# network failure from the client's side.
SSE_HEARTBEAT_SECONDS = 20

# Streams held open per user, across every tab and device. Well above normal
# use; it exists so a client stuck in a reconnect loop cannot pin an unbounded
# number of connections open.
MAX_STREAMS_PER_USER = 8

# In-process fan-out: user id -> the queues of that user's live streams.
# One uvicorn worker serves this app (run.py sets no `workers=`), so a plain
# in-memory registry reaches every connection. Introducing a second worker
# would split it and require an external broker — worth knowing before that
# change is ever made.
_subscribers: Dict[uuid.UUID, Set[asyncio.Queue]] = {}


def _publish(user_id: uuid.UUID) -> None:
    """Wake every live stream for this user. Never blocks the writer."""
    for queue in list(_subscribers.get(user_id, ())):
        try:
            queue.put_nowait(1)
        except asyncio.QueueFull:
            # A client too slow to drain a single-slot queue already has an
            # update pending; dropping this one loses nothing, since the
            # stream re-reads current state rather than replaying a log.
            pass


class WindowEntry(BaseModel):
    # "file" for a preview window, "folder" for a folder browser window.
    # Defaults to "file" so rows written before folder windows existed still
    # deserialize without a migration — the column is plain JSON.
    kind: str = "file"
    file_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    # Only folder windows carry this: a folder window can show a workspace
    # other than the one the app is currently switched to, so it cannot be
    # inferred at restore time.
    workspace_id: Optional[uuid.UUID] = None
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

    entries = [e for e in row.windows if isinstance(e, dict) and (e.get("file_id") or e.get("folder_id"))]
    if not entries:
        return WindowStateResponse(windows=[], updated_at=row.updated_at)

    def _uuid(v):
        try:
            return uuid.UUID(str(v))
        except (ValueError, TypeError):
            return None

    file_ids = [i for i in (_uuid(e.get("file_id")) for e in entries if e.get("file_id")) if i]
    folder_ids = [i for i in (_uuid(e.get("folder_id")) for e in entries if e.get("folder_id")) if i]

    alive_files = set((await db.execute(
        select(FileItem.id).where(FileItem.id.in_(file_ids), FileItem.is_trashed == False)  # noqa: E712
    )).scalars().all()) if file_ids else set()
    alive_folders = {
        f.id: f for f in (await db.execute(
            select(Folder).where(Folder.id.in_(folder_ids), Folder.is_trashed == False)  # noqa: E712
        )).scalars().all()
    } if folder_ids else {}

    visible = []
    for e in entries:
        minimized = bool(e.get("is_minimized"))
        if e.get("folder_id"):
            fid = _uuid(e.get("folder_id"))
            folder = alive_folders.get(fid) if fid else None
            if not folder:
                continue
            if not await access_service.can_access_folder(db, current_user, fid):
                continue
            visible.append(WindowEntry(
                kind="folder", folder_id=fid, workspace_id=folder.workspace_id, is_minimized=minimized
            ))
            continue

        fid = _uuid(e.get("file_id"))
        if not fid or fid not in alive_files:
            continue
        if not await access_service.can_access_file(db, current_user, fid):
            continue
        visible.append(WindowEntry(kind="file", file_id=fid, is_minimized=minimized))

    return WindowStateResponse(windows=visible, updated_at=row.updated_at)


@router.get("/version")
async def get_window_state_version(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Just the timestamp, for polling.

    The full GET resolves every entry against the file table and runs a
    per-file access check, which is far too heavy to run every couple of
    seconds. Clients poll this instead and only fetch the real state when the
    timestamp actually moves — which is what makes a near-instant poll
    interval affordable.
    """
    updated_at = (await db.execute(
        select(UserWindowState.updated_at).where(UserWindowState.user_id == current_user.id)
    )).scalar_one_or_none()
    return {"updated_at": updated_at}


@router.get("/stream")
async def stream_window_state(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Push the state's timestamp to the client whenever it changes.

    Like /version this deliberately carries only the timestamp, not the state:
    the client already knows how to fetch the full list when the timestamp
    moves, so the stream stays a cheap notification channel and the expensive
    per-file access check keeps happening in one place.

    Clients that cannot hold the stream open fall back to polling /version, so
    this is a latency optimisation rather than a required transport.
    """
    user_id = current_user.id

    # A dependency-injected session is only released once the response is
    # finished, which for a stream means "whenever the user closes the tab".
    # Holding a pool connection for that long would let a handful of open tabs
    # exhaust the pool, so the session is handed back now that authentication
    # is done; the loop below opens its own short-lived sessions instead.
    await db.close()

    subscribers = _subscribers.setdefault(user_id, set())
    if len(subscribers) >= MAX_STREAMS_PER_USER:
        # Refusing is safe: the client treats this as "streaming unavailable"
        # and stays on the polling path rather than losing sync.
        return StreamingResponse(
            iter(("event: unavailable\ndata: {}\n\n",)),
            media_type="text/event-stream",
        )

    queue: asyncio.Queue = asyncio.Queue(maxsize=1)
    subscribers.add(queue)

    async def read_version() -> Optional[datetime]:
        async with AsyncSessionLocal() as session:
            return (await session.execute(
                select(UserWindowState.updated_at).where(UserWindowState.user_id == user_id)
            )).scalar_one_or_none()

    async def events():
        try:
            last = await read_version()
            yield f"event: version\ndata: {json.dumps({'updated_at': last.isoformat() if last else None})}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    await asyncio.wait_for(queue.get(), timeout=SSE_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue

                current = await read_version()
                # A write that lands on an identical timestamp changed nothing
                # the client needs; skipping it keeps a busy writer from
                # triggering a pointless full-state fetch on every viewer.
                if current == last:
                    continue
                last = current
                yield f"event: version\ndata: {json.dumps({'updated_at': current.isoformat() if current else None})}\n\n"
        finally:
            subscribers.discard(queue)
            if not subscribers:
                _subscribers.pop(user_id, None)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Tells nginx not to buffer this response. Without it nginx holds
            # the events back until its buffer fills, which for a stream this
            # small means they arrive minutes late or not at all.
            "X-Accel-Buffering": "no",
        },
    )


@router.put("", response_model=WindowStateResponse)
async def put_window_state(
    req: WindowStateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """Replace the user's open-window list (last write wins)."""
    entries = []
    for w in req.windows[:MAX_WINDOWS]:
        if w.kind == "folder" and w.folder_id:
            entries.append({
                "kind": "folder",
                "folder_id": str(w.folder_id),
                "workspace_id": str(w.workspace_id) if w.workspace_id else None,
                "is_minimized": bool(w.is_minimized),
            })
        elif w.file_id:
            entries.append({
                "kind": "file",
                "file_id": str(w.file_id),
                "is_minimized": bool(w.is_minimized),
            })

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
    _publish(current_user.id)
    return WindowStateResponse(
        windows=[
            WindowEntry(
                kind=e.get("kind", "file"),
                file_id=uuid.UUID(e["file_id"]) if e.get("file_id") else None,
                folder_id=uuid.UUID(e["folder_id"]) if e.get("folder_id") else None,
                workspace_id=uuid.UUID(e["workspace_id"]) if e.get("workspace_id") else None,
                is_minimized=e["is_minimized"],
            )
            for e in row.windows
        ],
        updated_at=row.updated_at,
    )
