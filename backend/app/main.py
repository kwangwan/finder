import asyncio
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import init_db, AsyncSessionLocal
from app.routers import folders, files, storage, search, system, auth, admin, workspaces, invitations, trash, window_state, reports, favorites, boards
from app.routers.trash import _auto_purge_expired
from app.routers.storage import cleanup_stale_chunk_sessions, cleanup_phantom_files, backfill_missing_thumbnails
from app.routers.folders import reconcile_orphaned_trashed_files
from app.routers.files import prune_old_file_versions
from app.services.media_metadata_service import backfill_media_metadata

from app.services.deletion_service import deletion_service
from app.services.copy_service import copy_service
from app.services import shared_workspace_service

async def _daily_storage_alert():
    """
    Re-send the shared-pool storage warning once a day while it is still over
    its line.

    A single mail at the moment of crossing is easy to miss — it arrives once
    and nothing follows it. This wakes hourly and defers to the service, which
    sends at most one message per calendar day and stops as soon as the pool
    comes back under the threshold.
    """
    from app.services.shared_policy_service import send_daily_threshold_reminder, get_setting
    while True:
        try:
            await asyncio.sleep(3600)  # check hourly; the service rate-limits to daily
            async with AsyncSessionLocal() as db:
                hour = int(await get_setting(db, "shared.alert_daily_hour_utc") or 0)
                if datetime.now(timezone.utc).hour == hour:
                    if await send_daily_threshold_reminder(db):
                        print(f"[{settings.APP_NAME}] Daily shared-storage warning sent.")
        except Exception as e:
            print(f"[{settings.APP_NAME}] Daily storage alert error: {e}")


async def _periodic_trash_cleanup():
    """Periodically purge trashed items older than 30 days, abandoned chunk
    upload sessions older than 24 hours, phantom file rows (a FileItem whose
    storage object doesn't actually exist — e.g. from a write that failed
    after the row was already committed) younger than 48 hours, files left
    behind under an already-trashed folder, image/video files missing a
    thumbnail, and note version-history rows beyond the per-file retention
    cap, every 12 hours."""
    while True:
        try:
            await asyncio.sleep(43200) # 12 hours
            async with AsyncSessionLocal() as db:
                await _auto_purge_expired(db)
                print(f"[{settings.APP_NAME}] Periodic 30-day trash cleanup completed.")
            async with AsyncSessionLocal() as db:
                removed = await cleanup_stale_chunk_sessions(db, max_age_hours=24)
                if removed:
                    print(f"[{settings.APP_NAME}] Removed {removed} abandoned chunk-upload sessions.")
            async with AsyncSessionLocal() as db:
                removed = await cleanup_phantom_files(db, max_age_hours=48)
                if removed:
                    print(f"[{settings.APP_NAME}] Removed {removed} phantom file rows with no matching storage object.")
            async with AsyncSessionLocal() as db:
                fixed = await reconcile_orphaned_trashed_files(db)
                if fixed:
                    print(f"[{settings.APP_NAME}] Marked {fixed} files trashed to match their already-trashed parent folder.")
            async with AsyncSessionLocal() as db:
                generated = await backfill_missing_thumbnails(db)
                if generated:
                    print(f"[{settings.APP_NAME}] Generated {generated} thumbnails that were missing.")
            async with AsyncSessionLocal() as db:
                pruned = await prune_old_file_versions(db)
                if pruned:
                    print(f"[{settings.APP_NAME}] Pruned {pruned} old note version-history rows.")
            # Media uploaded before capture-metadata extraction existed. Runs
            # in bounded batches keyed off media_scanned_at, so it works
            # through the backlog over successive passes and then stops.
            async with AsyncSessionLocal() as db:
                scanned = await backfill_media_metadata(db)
                if scanned:
                    print(f"[{settings.APP_NAME}] Scanned {scanned} media file(s) for capture metadata.")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[{settings.APP_NAME} Warning] Trash cleanup error: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[{settings.APP_NAME}] Starting up... Initializing PostgreSQL & pgvector...")
    try:
        await init_db()
        print(f"[{settings.APP_NAME}] PostgreSQL & pgvector initialized successfully.")
    except Exception as e:
        print(f"[{settings.APP_NAME} Error] DB initialization error: {e}")
    
    # Start background deletion queue worker & periodic 30-day trash cleanup
    # Everyone needs somewhere to work from the moment they are approved, so
    # the shared workspace is ensured at startup rather than created on demand.
    # Accounts created before handles existed get one derived from their email
    # so nothing is left without an identity; they can change it afterwards.
    try:
        from app.core.database import AsyncSessionLocal as _S
        from app.services import username_service
        async with _S() as _db:
            n = await username_service.backfill_all(_db)
            if n:
                print(f"[{settings.APP_NAME}] Assigned handles to {n} existing account(s).")
    except Exception as e:
        print(f"[{settings.APP_NAME}] Username backfill skipped: {e}")

    await shared_workspace_service.ensure_on_startup()

    # Favourites used to be a flag on the file itself, which made one person's
    # shortcut everybody's in the shared workspace. Runs once; the marker it
    # writes keeps it from running again.
    try:
        from app.core.database import AsyncSessionLocal as _S2
        from app.services import favorite_service
        async with _S2() as _db:
            await favorite_service.backfill_from_file_column(_db)
    except Exception as e:
        print(f"[{settings.APP_NAME}] Favorite backfill skipped: {e}")

    daily_alert_task = asyncio.create_task(_daily_storage_alert())
    deletion_service.start_worker()
    # A job left mid-flight by the previous shutdown is nobody's work now;
    # put it back on the queue before the worker starts draining.
    await copy_service.requeue_orphans()
    copy_service.start_worker()
    cleanup_task = asyncio.create_task(_periodic_trash_cleanup())
    
    yield
    
    cleanup_task.cancel()
    daily_alert_task.cancel()
    await deletion_service.stop_worker()
    await copy_service.stop_worker()
    print(f"[{settings.APP_NAME}] Shutting down...")

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)

# CORS configuration: restricted to the app's own known origins. `allow_origins=["*"]`
# combined with `allow_credentials=True` makes Starlette reflect the caller's actual
# Origin header, which amounts to "any website may make authenticated requests" —
# unnecessary here since the frontend only ever calls this API same-origin (via /api).
def _get_allowed_origins() -> list[str]:
    origins = [settings.APP_PUBLIC_URL]
    if settings.CORS_ALLOWED_ORIGINS:
        origins += [o.strip() for o in settings.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]
    if settings.DEBUG:
        origins += ["http://localhost:5173", "http://127.0.0.1:5173"]
    return origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(invitations.router)
app.include_router(workspaces.router)
app.include_router(folders.router)
app.include_router(files.router)
app.include_router(trash.router)
app.include_router(storage.router)
app.include_router(reports.router)
app.include_router(search.router)
app.include_router(system.router)
app.include_router(window_state.router)
app.include_router(favorites.router)
app.include_router(boards.router)

@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "online",
        "docs": "/docs"
    }
