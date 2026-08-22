import pytest
import uuid
from datetime import datetime, timedelta
from app.models import Folder, FileItem, User
from app.routers.trash import _auto_purge_expired

@pytest.mark.asyncio
async def test_file_trash_and_restore(db_session):
    # 1. Create folder and file
    folder = Folder(name="테스트 폴더")
    db_session.add(folder)
    await db_session.commit()
    await db_session.refresh(folder)

    file_item = FileItem(
        folder_id=folder.id,
        name="테스트_문서.md",
        file_type="note",
        content="내용",
        is_markdown=True,
        is_trashed=False
    )
    db_session.add(file_item)
    await db_session.commit()
    await db_session.refresh(file_item)

    # 2. Soft delete file (move to trash)
    file_item.is_trashed = True
    file_item.trashed_at = datetime.utcnow()
    await db_session.commit()
    await db_session.refresh(file_item)

    assert file_item.is_trashed is True
    assert file_item.trashed_at is not None

    # 3. Restore file
    file_item.is_trashed = False
    file_item.trashed_at = None
    await db_session.commit()
    await db_session.refresh(file_item)

    assert file_item.is_trashed is False
    assert file_item.trashed_at is None

    # Clean up
    await db_session.delete(file_item)
    await db_session.delete(folder)
    await db_session.commit()


@pytest.mark.asyncio
async def test_folder_recursive_trash_and_restore(db_session):
    # 1. Create parent folder, child folder, and child file
    parent = Folder(name="부모 폴더", is_trashed=False)
    db_session.add(parent)
    await db_session.commit()
    await db_session.refresh(parent)

    child = Folder(name="자식 폴더", parent_id=parent.id, is_trashed=False)
    db_session.add(child)
    await db_session.commit()
    await db_session.refresh(child)

    child_file = FileItem(
        folder_id=child.id,
        name="자식_문서.md",
        file_type="note",
        content="자식 내용",
        is_markdown=True,
        is_trashed=False
    )
    db_session.add(child_file)
    await db_session.commit()
    await db_session.refresh(child_file)

    # 2. Recursive trash helper test
    from app.routers.folders import _set_folder_trash_recursive
    await _set_folder_trash_recursive(db_session, parent, is_trashed=True, trashed_at=datetime.utcnow())
    await db_session.commit()
    await db_session.refresh(parent)
    await db_session.refresh(child)
    await db_session.refresh(child_file)

    assert parent.is_trashed is True
    assert child.is_trashed is True
    assert child_file.is_trashed is True

    # 3. Recursive restore
    await _set_folder_trash_recursive(db_session, parent, is_trashed=False, trashed_at=None)
    await db_session.commit()
    await db_session.refresh(parent)
    await db_session.refresh(child)
    await db_session.refresh(child_file)

    assert parent.is_trashed is False
    assert child.is_trashed is False
    assert child_file.is_trashed is False

    # Clean up
    await db_session.delete(child_file)
    await db_session.delete(child)
    await db_session.delete(parent)
    await db_session.commit()


@pytest.mark.asyncio
async def test_30_day_auto_purge(db_session):
    # 1. Create an expired trashed file (> 30 days old)
    old_trashed_time = datetime.utcnow() - timedelta(days=31)
    old_file = FileItem(
        name="31일_전_삭제된_문서.md",
        file_type="note",
        content="오래된 문서 내용",
        is_markdown=True,
        is_trashed=True,
        trashed_at=old_trashed_time
    )
    # 2. Create a recent trashed file (< 30 days old)
    recent_file = FileItem(
        name="최근_삭제된_문서.md",
        file_type="note",
        content="최근 삭제 문서",
        is_markdown=True,
        is_trashed=True,
        trashed_at=datetime.utcnow() - timedelta(days=5)
    )
    db_session.add(old_file)
    db_session.add(recent_file)
    await db_session.commit()
    await db_session.refresh(old_file)
    await db_session.refresh(recent_file)

    old_id = old_file.id
    recent_id = recent_file.id

    # 3. Run auto-purge
    await _auto_purge_expired(db_session)

    # 4. Check results: old file should be purged, recent file should remain
    purged_check = await db_session.get(FileItem, old_id)
    assert purged_check is None

    kept_check = await db_session.get(FileItem, recent_id)
    assert kept_check is not None
    assert kept_check.is_trashed is True

    # Clean up remaining
    await db_session.delete(kept_check)
    await db_session.commit()
