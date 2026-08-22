from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
import psycopg2
from app.core.config import settings

Base = declarative_base()

# Async SQLAlchemy Engine & Session
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

def init_pgvector_and_schema_sync():
    """Ensure pgvector extension is created and tables are initialized."""
    try:
        conn = psycopg2.connect(
            host=settings.POSTGRES_HOST,
            port=settings.POSTGRES_PORT,
            user=settings.POSTGRES_USER,
            password=settings.POSTGRES_PASSWORD,
            dbname=settings.POSTGRES_DB,
            connect_timeout=5,
        )
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";")
        conn.close()
    except Exception as e:
        print(f"[DB Init Warning] Error checking/enabling vector extension: {e}")

async def init_db():
    """Create all tables in PostgreSQL asynchronously and ensure schema migrations."""
    init_pgvector_and_schema_sync()
    async with engine.begin() as conn:
        from app.models import Folder, FileItem, DocumentChunk, User, Workspace, WorkspaceMember, Invitation
        await conn.run_sync(Base.metadata.create_all)
        
        # Schema migrations: add columns if they do not exist
        migrations = [
            # User hashed_password
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS hashed_password VARCHAR(255);",
            # User storage quota (default 100GB)
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT NOT NULL DEFAULT 107374182400;",
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT NOT NULL DEFAULT 0;",
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS storage_reserved_bytes BIGINT NOT NULL DEFAULT 0;",
            # Workspace columns on folders
            "ALTER TABLE kb_folders ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES kb_workspaces(id) ON DELETE CASCADE;",
            "ALTER TABLE kb_folders ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES kb_users(id) ON DELETE SET NULL;",
            # Workspace columns on files
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES kb_workspaces(id) ON DELETE CASCADE;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES kb_users(id) ON DELETE SET NULL;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS thumbnail_s3_key VARCHAR(1024);",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS is_embedded BOOLEAN NOT NULL DEFAULT FALSE;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS embedded_chunks_count BIGINT NOT NULL DEFAULT 0;",
            # Trash columns
            "ALTER TABLE kb_folders ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;",
            "ALTER TABLE kb_folders ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP;",
            # Default (non-deletable, always-fallback) workspace per user
            "ALTER TABLE kb_workspaces ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;",
            # Last editor (distinct from created_by/uploader) for markdown notes
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES kb_users(id) ON DELETE SET NULL;",
        ]
        for sql in migrations:
            try:
                await conn.execute(text(sql))
            except Exception as e:
                print(f"[DB Migration Warning] {e}")

        # Create HNSW index on embeddings if not exists
        try:
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON kb_document_chunks "
                "USING hnsw (embedding vector_cosine_ops);"
            ))
        except Exception as e:
            print(f"[DB Init Index Warning] Could not create HNSW index: {e}")

        # Recalculate each user's storage_used_bytes based on files in their owned workspaces.
        # Trashed files still occupy real storage until permanently purged, so they must stay
        # counted here too, matching the live incremental accounting in quota_service (which
        # only frees quota on permanent deletion, not on move-to-trash).
        try:
            await conn.execute(text("""
                UPDATE kb_users u
                SET storage_used_bytes = COALESCE((
                    SELECT SUM(f.size_bytes)
                    FROM kb_files f
                    JOIN kb_workspaces w ON f.workspace_id = w.id
                    WHERE w.owner_id = u.id
                ), 0) + COALESCE((
                    SELECT SUM(f.size_bytes)
                    FROM kb_files f
                    WHERE f.workspace_id IS NULL AND f.created_by = u.id
                ), 0);
            """))
        except Exception as e:
            print(f"[DB Migration Warning] Could not sync user storage_used_bytes: {e}")

        # Backfill is_default for users whose workspace(s) predate that column:
        # their single oldest owned workspace becomes the default. Idempotent —
        # once an owner has any workspace marked default, this is a no-op for them.
        try:
            await conn.execute(text("""
                WITH earliest AS (
                    SELECT DISTINCT ON (owner_id) id, owner_id
                    FROM kb_workspaces
                    ORDER BY owner_id, created_at ASC
                )
                UPDATE kb_workspaces w
                SET is_default = TRUE
                FROM earliest e
                WHERE w.id = e.id
                AND NOT EXISTS (
                    SELECT 1 FROM kb_workspaces w2
                    WHERE w2.owner_id = w.owner_id AND w2.is_default = TRUE
                );
            """))
        except Exception as e:
            print(f"[DB Migration Warning] Could not backfill default workspaces: {e}")

        # Backfill last_edited_by for files that predate that column — nobody
        # has edited them since upload/creation, so the uploader/creator is
        # the correct initial "last edited by".
        try:
            await conn.execute(text(
                "UPDATE kb_files SET last_edited_by = created_by WHERE last_edited_by IS NULL AND created_by IS NOT NULL;"
            ))
        except Exception as e:
            print(f"[DB Migration Warning] Could not backfill last_edited_by: {e}")

