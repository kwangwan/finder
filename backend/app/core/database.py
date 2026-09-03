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
            # The single organisation-wide workspace every approved user can use
            "ALTER TABLE kb_workspaces ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE;",
            # Holder account for the shared workspace's own storage pool
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;",
            # Per-user write access to the shared workspace (read stays)
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS can_write_shared BOOLEAN NOT NULL DEFAULT TRUE;",
            # Display names must be distinguishable: in a space everyone shares,
            # two identical uploader names make attribution impossible and
            # impersonation trivial. Created only if the existing rows allow it.
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_lower_name ON kb_users (lower(name)) WHERE name IS NOT NULL;",
            # Public identity handle (lowercase ASCII, unique)
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS username VARCHAR(20);",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON kb_users (lower(username)) WHERE username IS NOT NULL;",
            # Personal folder ownership inside the shared workspace
            "ALTER TABLE kb_folders ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES kb_users(id) ON DELETE SET NULL;",
            "CREATE INDEX IF NOT EXISTS ix_kb_folders_owner_user ON kb_folders (owner_user_id);",
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
            # A board task carries a period, not a single deadline: work that
            # runs from one day to another is the normal case, and only the end
            # of it was recordable.
            "ALTER TABLE kb_board_tasks ADD COLUMN IF NOT EXISTS start_date DATE;",
            # A photo the person uploaded here, which wins over the one the
            # identity provider supplied.
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS avatar_s3_key VARCHAR(1024);",
            # The language a person reads in, taken from their browser at sign-up.
            # Added with 'ko' so everyone who was already here — all of them
            # Korean readers — keeps reading in Korean.
            # The personal workspace made at signup is gone (see auth.py), and
            # with it the flag that marked one workspace per owner as undeletable.
            # The shared workspace is protected by is_shared, which is what it
            # actually is.
            "ALTER TABLE kb_workspaces DROP COLUMN IF EXISTS is_default;",
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'ko';",
            # From here on the fallback is English: 'ko' was right for the
            # people already here, not for a stranger whose browser asks for
            # something this app has no translation for.
            "ALTER TABLE kb_users ALTER COLUMN language SET DEFAULT 'en';",
            # `is_admin` sat next to a workspace's own "admin" role and read as
            # the same thing. This one is service-wide, so it says so.
            "ALTER TABLE kb_users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;",
            "ALTER TABLE kb_board_tasks ADD COLUMN IF NOT EXISTS document_id UUID "
            "REFERENCES kb_files(id) ON DELETE SET NULL;",
            # 일정 rebuilt: every 할 일 now owns a document, so a board saved
            # under the old shape has rows pointing at nothing and is cleared
            # out rather than half-migrated. Only those: this list runs on
            # every start, and an unguarded DELETE here threw away every board
            # anyone had made since — each restart, silently.
            "DELETE FROM kb_files f WHERE f.file_type = 'board' AND EXISTS ("
            "  SELECT 1 FROM kb_board_tasks t"
            "  WHERE t.file_id = f.id AND t.document_id IS NULL);",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_board_task_document "
            "ON kb_board_tasks (document_id) WHERE document_id IS NOT NULL;",
            # The notes moved into that document, which keeps its own history.
            "ALTER TABLE kb_board_tasks DROP COLUMN IF EXISTS detail;",
            "DROP TABLE IF EXISTS kb_board_task_versions;",
            # Left over from features this app no longer has: sharing links and
            # user groups, both empty and unreferenced since. A column or a
            # table nothing reads is a question every future reader has to ask
            # and answer for themselves.
            "DROP TABLE IF EXISTS kb_shares;",
            "DROP TABLE IF EXISTS kb_group_members;",
            "DROP TABLE IF EXISTS kb_groups;",
            # Superseded by workspace ownership (kb_workspaces.owner_id) and, for
            # personal folders, kb_folders.owner_user_id. Never populated.
            "ALTER TABLE kb_files DROP COLUMN IF EXISTS owner_id;",
            "ALTER TABLE kb_folders DROP COLUMN IF EXISTS owner_id;",
            # Carry the old values over once, then drop the column so nothing
            # can keep writing to a flag nobody reads. Inside a DO block
            # because a plain UPDATE naming `is_admin` fails to parse once the
            # column is gone — the guard in its WHERE clause never gets to run,
            # and the failure took the whole migration transaction with it.
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'kb_users' AND column_name = 'is_admin'
                ) THEN
                    EXECUTE 'UPDATE kb_users SET is_superadmin = is_admin';
                    EXECUTE 'ALTER TABLE kb_users DROP COLUMN is_admin';
                END IF;
            END $$;
            """,
            # History is now kept one entry per half hour (see files.py's
            # _record_version). The session model it replaces is gone with it:
            # nothing opens a version any more, so every row that was still
            # open becomes an ordinary entry and the flag itself goes.
            "ALTER TABLE kb_file_versions ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;",
            "CREATE INDEX IF NOT EXISTS ix_kb_file_versions_period_start ON kb_file_versions (period_start);",
            "DROP INDEX IF EXISTS ux_file_versions_one_open_per_file;",
            # A default first, so that if the drop below is ever refused the
            # column left behind cannot break an insert that no longer names
            # it: each statement here stands on its own, and a NOT NULL column
            # nothing writes to would fail every save. Guarded, because once
            # the drop has succeeded this would print a warning on every
            # startup for a column that is gone on purpose.
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'kb_file_versions' AND column_name = 'is_open'
                ) THEN
                    EXECUTE 'ALTER TABLE kb_file_versions ALTER COLUMN is_open SET DEFAULT FALSE';
                END IF;
            END $$;
            """,
            "ALTER TABLE kb_file_versions DROP COLUMN IF EXISTS is_open;",
            # One row per file per half hour. Two tabs saving at the same
            # moment both see "no row for this window yet"; this is what turns
            # that race into the retry in update_markdown_note rather than two
            # rows for one window. Partial, because the one-off snapshots
            # (period_start IS NULL) are allowed to repeat.
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_file_versions_one_per_period "
            "ON kb_file_versions (file_id, period_start) WHERE period_start IS NOT NULL;",
            # When a file last changed in a way a *listing* shows: added,
            # renamed, moved, thrown away or restored. Distinct from
            # updated_at, which also moves every time a document's body is
            # autosaved — and a document being written in is not a reason to
            # tell everyone looking at the folder that they are out of date.
            "ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS listing_updated_at TIMESTAMPTZ;",
            "UPDATE kb_files SET listing_updated_at = updated_at WHERE listing_updated_at IS NULL;",
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

        # Each statement in a savepoint of its own. They all shared one
        # transaction before, so the first failure aborted it and every
        # migration after it — and the CREATE TABLE for any new model — was
        # silently rolled back.
        for sql in migrations:
            try:
                async with conn.begin_nested():
                    await conn.execute(text(sql))
            except Exception as e:
                print(f"[DB Migration Warning] {e}")

        # What each document has attached, read out of the document itself.
        # Runs every start: it only ever adds what the content already says,
        # so it also repairs anything an older save path never recorded.
        # Written with capturing groups rather than (?:…) because a colon in a
        # text() statement is read as a bind parameter.
        for attachment_pattern, group in (
            ("/api/storage/(preview|download|presigned-download)/"
             "([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})", 2),
            ("/api/files/"
             "([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/download", 1),
        ):
            try:
                async with conn.begin_nested():
                    await conn.execute(
                        text("""
                            INSERT INTO kb_file_links (id, document_id, target_file_id, created_at)
                            SELECT uuid_generate_v4(), f.id, t.id, NOW()
                            FROM kb_files f
                            CROSS JOIN LATERAL (
                                SELECT DISTINCT (regexp_matches(f.content, :pattern, 'g'))[:group] AS ref
                            ) m
                            JOIN kb_files t ON t.id = m.ref::uuid
                            WHERE f.is_markdown = TRUE AND f.content IS NOT NULL AND t.id <> f.id
                            ON CONFLICT (document_id, target_file_id) DO NOTHING;
                        """.replace(":group", str(group))),
                        {"pattern": attachment_pattern},
                    )
            except Exception as e:
                print(f"[DB Migration Warning] Could not backfill document attachments: {e}")

        # Every handle an account has held. The accounts that predate the
        # table get one row for the handle they are using now, dated from when
        # they signed up — which is when they took it.
        try:
            async with conn.begin_nested():
                await conn.execute(text("""
                    INSERT INTO kb_username_history (id, user_id, username, taken_at, released_at)
                    SELECT uuid_generate_v4(), u.id, u.username, u.created_at, NULL
                    FROM kb_users u
                    WHERE u.username IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM kb_username_history h WHERE h.user_id = u.id
                      );
                """))
        except Exception as e:
            print(f"[DB Migration Warning] Could not backfill username history: {e}")

        # Create HNSW index on embeddings if not exists
        try:
            async with conn.begin_nested():
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
            async with conn.begin_nested():
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

        # Backfill last_edited_by for files that predate that column — nobody
        # has edited them since upload/creation, so the uploader/creator is
        # the correct initial "last edited by".
        try:
            async with conn.begin_nested():
                await conn.execute(text(
                    "UPDATE kb_files SET last_edited_by = created_by WHERE last_edited_by IS NULL AND created_by IS NOT NULL;"
                ))
        except Exception as e:
            print(f"[DB Migration Warning] Could not backfill last_edited_by: {e}")

