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
            # Capture metadata read from the media file itself (photo EXIF /
            # video moov atom). media_scanned_at records that extraction ran,
            # so the backfill can skip files it has already examined even when
            # they turned out to carry no metadata at all.
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS gps_latitude DOUBLE PRECISION;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS gps_longitude DOUBLE PRECISION;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS camera_make VARCHAR(128);",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS camera_model VARCHAR(128);",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS media_width INTEGER;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS media_height INTEGER;",
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS media_scanned_at TIMESTAMPTZ;",
            # The backfill repeatedly asks for "media files not yet scanned";
            # without this it degrades into a full scan of a 12k-row table
            # every time the periodic job runs.
            "CREATE INDEX IF NOT EXISTS ix_kb_files_media_scan ON kb_files (file_type, media_scanned_at) WHERE s3_key IS NOT NULL;",
        ]

        # Every timestamp column was originally created as a naive
        # TIMESTAMP, always populated via datetime.utcnow() — so every value
        # already stored is UTC, just not labeled as such. FastAPI/Pydantic
        # serializes a naive datetime with no offset, and per the JS Date
        # spec, `new Date(isoStringWithNoOffset)` is parsed as browser-LOCAL
        # time, not UTC — silently shifting every timestamp shown anywhere
        # in the app by the viewer's UTC offset. Converting each column to
        # TIMESTAMPTZ (reinterpreting the existing naive values as UTC, not
        # shifting them) makes Postgres/asyncpg hand back tz-aware datetimes,
        # which serialize with an explicit offset and let the browser convert
        # correctly. Guarded by an information_schema check (not just
        # IF NOT EXISTS, which ALTER COLUMN TYPE has no equivalent of) so
        # this is a no-op — not a repeated, wrongly-double-shifting cast —
        # on every startup after the first.
        TIMESTAMPTZ_COLUMNS = [
            ("kb_users", "created_at"), ("kb_users", "updated_at"), ("kb_users", "last_login_at"),
            ("kb_files", "created_at"), ("kb_files", "updated_at"), ("kb_files", "trashed_at"),
            ("kb_folders", "created_at"), ("kb_folders", "updated_at"), ("kb_folders", "trashed_at"),
            ("kb_workspaces", "created_at"), ("kb_workspaces", "updated_at"),
            ("kb_workspace_members", "created_at"),
            ("kb_invitations", "created_at"), ("kb_invitations", "expires_at"),
            ("kb_file_versions", "created_at"),
            ("kb_document_chunks", "created_at"),
            ("deletion_queue", "created_at"), ("deletion_queue", "updated_at"),
        ]
        for table, column in TIMESTAMPTZ_COLUMNS:
            migrations.append(f"""
                DO $$
                BEGIN
                    IF (SELECT data_type FROM information_schema.columns
                        WHERE table_name = '{table}' AND column_name = '{column}') = 'timestamp without time zone' THEN
                        ALTER TABLE {table} ALTER COLUMN {column} TYPE TIMESTAMPTZ USING {column} AT TIME ZONE 'UTC';
                    END IF;
                END $$;
            """)

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

        # At most one "open" (still-being-edited) version row per file — see
        # FileVersion.is_open. Without this, two requests that both read "no
        # open version yet" before either commits (a genuine race under
        # concurrent edits — e.g. two tabs, or an autosave retry overlapping
        # a slow-but-still-in-flight original request) could each insert
        # their own open row, leaving a file with two simultaneously "open"
        # versions — confirmed already present in existing data, not just a
        # theoretical race. The retry path in update_markdown_note (files.py)
        # is what turns the resulting IntegrityError into a clean recovery
        # instead of a failed save going forward.
        #
        # A unique index can't be created while duplicates already violate
        # it, so first close out every already-open row except the most
        # recent one per file (into permanent history, same as any other
        # session-end close — no content is discarded).
        try:
            await conn.execute(text("""
                UPDATE kb_file_versions v
                SET is_open = false
                WHERE v.is_open = true
                AND v.created_at < (
                    SELECT MAX(v2.created_at) FROM kb_file_versions v2
                    WHERE v2.file_id = v.file_id AND v2.is_open = true
                );
            """))
        except Exception as e:
            print(f"[DB Migration Warning] Could not dedupe pre-existing open file versions: {e}")

        try:
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_file_versions_one_open_per_file "
                "ON kb_file_versions (file_id) WHERE is_open = true;"
            ))
        except Exception as e:
            print(f"[DB Init Index Warning] Could not create one-open-version-per-file index: {e}")

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

