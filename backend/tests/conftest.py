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


@pytest.fixture
async def test_engine():
    init_pgvector_and_schema_sync()
    engine = create_async_engine(
        settings.DATABASE_URL,
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
