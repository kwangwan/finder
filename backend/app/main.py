import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import init_db, AsyncSessionLocal
from app.routers import folders, files, storage, search, system, auth, admin, workspaces, invitations, trash
from app.routers.trash import _auto_purge_expired

from app.services.deletion_service import deletion_service

async def _periodic_trash_cleanup():
    """Periodically purge trashed items older than 30 days every 12 hours."""
    while True:
        try:
            await asyncio.sleep(43200) # 12 hours
            async with AsyncSessionLocal() as db:
                await _auto_purge_expired(db)
                print(f"[{settings.APP_NAME}] Periodic 30-day trash cleanup completed.")
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
    deletion_service.start_worker()
    cleanup_task = asyncio.create_task(_periodic_trash_cleanup())
    
    yield
    
    cleanup_task.cancel()
    await deletion_service.stop_worker()
    print(f"[{settings.APP_NAME}] Shutting down...")

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
app.include_router(search.router)
app.include_router(system.router)

@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "online",
        "docs": "/docs"
    }
