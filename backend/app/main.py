from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import init_db
from app.routers import folders, files, storage, search, system, auth, admin, workspaces, invitations, trash

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[{settings.APP_NAME}] Starting up... Initializing PostgreSQL & pgvector...")
    try:
        await init_db()
        print(f"[{settings.APP_NAME}] PostgreSQL & pgvector initialized successfully.")
    except Exception as e:
        print(f"[{settings.APP_NAME} Error] DB initialization error: {e}")
    yield
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
