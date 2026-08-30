import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Locate .env file in root workspace
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
ENV_FILE = ROOT_DIR / ".env"

class Settings(BaseSettings):
    # App
    APP_NAME: str = "Project Run : Finder"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    APP_PUBLIC_URL: str = "https://finder.proj.run"
    # Comma-separated list of additional origins allowed to make credentialed
    # cross-origin requests (beyond APP_PUBLIC_URL, and localhost in DEBUG mode).
    CORS_ALLOWED_ORIGINS: str = ""
    
    # MinIO
    MINIO_PUBLIC_URL: str = "https://public-storage.proj.run"
    MINIO_PUBLIC_ROOT_USER: str = "project-run"
    MINIO_PUBLIC_ROOT_PASSWORD: str = ""
    MINIO_MAX_CHUNK_SIZE_MB: int = 5
    # Total uncompressed size across all files in one ZIP download request.
    # Building/streaming a ZIP is CPU- and I/O-bound work tied up for the
    # whole request; without a cap a single request for a huge folder could
    # still run long enough to be impractical even though it no longer
    # buffers everything in memory.
    # A ZIP is built and streamed in one request: nothing about it resumes, so
    # a 10GB archive was a download that had to survive an hour of perfect
    # network to be worth anything. 2GB is large enough for the folders people
    # actually archive and small enough to finish.
    MAX_ZIP_DOWNLOAD_BYTES: int = 2 * 1024 * 1024 * 1024  # 2 GB
    MINIO_BUCKET_NAME: str = "knowledge-base"
    MINIO_REGION: str = "us-east-1"
    
    # Optional internal MinIO endpoint if tunnel has separate API routing
    MINIO_INTERNAL_URL: str = ""

    # PostgreSQL
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = "postgres"
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres"
    SYNC_DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/postgres"

    # OpenWebUI / LLM & Embeddings
    OPENWEBUI_URL: str = "http://localhost:3000"
    OPENWEBUI_API_KEY: str = ""
    OPENWEBUI_MODEL: str = "gemma4:latest"
    OPENWEBUI_EMBEDDING_MODEL: str = "embeddinggemma:latest"
    MAX_EMBED_TOKENS: int = 8000
    EMBEDDING_DIM: int = 768

    # Authentication & Google OAuth
    JWT_SECRET: str = "change_me_in_env_file"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 10080
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # Realtime document collaboration (Hocuspocus/Yjs sync server) — the
    # frontend's own VITE_SYNC_URL build-time env var only bakes in on a plain
    # `npm run build`; the Docker build context is `frontend/` alone, so it
    # never sees the repo-root .env. Read it here (backend's container does
    # get the root .env, via docker-compose's env_file) and serve it through
    # /api/auth/config, the same runtime-fallback pattern already used for
    # GOOGLE_CLIENT_ID.
    VITE_SYNC_URL: str = "ws://localhost:1234"

    # AWS SES (초대 및 알림 메일 발송용)
    AWS_SES_ACCESS_KEY_ID: str = ""
    AWS_SES_SECRET_ACCESS_KEY: str = ""
    AWS_SES_REGION: str = "ap-northeast-2"
    SES_FROM_EMAIL_NOTIFY: str = "notify@proj.run"

    # Fallback aliases
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "ap-northeast-2"
    SES_SOURCE_EMAIL: str = "notify@proj.run"

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

# Normalize database URLs
if settings.DATABASE_URL.startswith("postgresql://"):
    settings.SYNC_DATABASE_URL = settings.DATABASE_URL
    settings.DATABASE_URL = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
elif settings.DATABASE_URL.startswith("postgresql+asyncpg://"):
    settings.SYNC_DATABASE_URL = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
