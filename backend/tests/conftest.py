import os
import pytest
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
from app.core.config import settings
from app.core.database import Base, init_pgvector_and_schema_sync
from app.models import Folder, FileItem, DocumentChunk


@pytest.fixture(autouse=True)
def enable_debug_for_tests():
    old_debug = settings.DEBUG
    settings.DEBUG = True
    yield
    settings.DEBUG = old_debug


def test_database_url() -> str:
    """
    The database the tests are allowed to write to.

    They used to run against `settings.DATABASE_URL` — the live one, which
    this app also shares with another production service. Every run left
    accounts, workspaces and files behind in it, and a name collision with a
    leftover row was enough to fail a test for reasons that had nothing to do
    with the code. Nothing here is written to a database that somebody is
    using.

    Set KB_TEST_DATABASE_URL to point somewhere scratch. With nothing set, the
    same server's `kb_finder_test` database is used, which is what
    `CREATE DATABASE kb_finder_test` gives you; if the name does not look like
    a test database, the whole suite stops rather than guessing.
    """
    url = os.getenv("KB_TEST_DATABASE_URL")
    if not url:
        base, _, current = settings.DATABASE_URL.rpartition("/")
        url = f"{base}/kb_finder_test" + ("?" + current.split("?", 1)[1] if "?" in current else "")
    name = url.rsplit("/", 1)[-1].split("?")[0]
    if "test" not in name.lower():
        pytest.exit(
            f"refusing to run tests against the database {name!r}: "
            "set KB_TEST_DATABASE_URL to a scratch database.",
            returncode=2,
        )
    return url


@pytest.fixture
async def test_engine():
    engine = create_async_engine(
        test_database_url(),
        poolclass=NullPool,
        echo=False
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()

@pytest.fixture
async def db_session(test_engine):
    async_session = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False
    )
    async with async_session() as session:
        yield session
        await session.close()
