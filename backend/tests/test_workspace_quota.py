import pytest
import uuid
from fastapi import HTTPException
from app.models import User, Workspace, WorkspaceMember, Folder, FileItem
from app.routers.files import create_markdown_note, delete_file
from app.schemas.file import NoteCreate
from app.services.quota_service import quota_service

@pytest.mark.asyncio
async def test_workspace_quota_owner_aggregation_and_isolation(db_session):
    """
    Test workspace-centric quota policy:
    - Files uploaded by member B into workspace A count toward Owner A's quota.
    - Member B leaving workspace A does not affect B's quota.
    - Deleting the file reclaims storage from Owner A.
    - Owner A running out of quota prevents Member B from uploading to Workspace A.
    """
    uid = str(uuid.uuid4())[:8]

    # 1. Create User A (Owner) and User B (Member)
    user_a = User(
        email=f"owner_a_{uid}@test.com",
        name="Owner A",
        is_admin=False,
        is_approved=True,
        storage_quota_bytes=1000,  # 1000 bytes limit
        storage_used_bytes=0
    )
    user_b = User(
        email=f"member_b_{uid}@test.com",
        name="Member B",
        is_admin=False,
        is_approved=True,
        storage_quota_bytes=10000, # 10000 bytes limit
        storage_used_bytes=0
    )
    db_session.add_all([user_a, user_b])
    await db_session.commit()
    await db_session.refresh(user_a)
    await db_session.refresh(user_b)

    # 2. User A creates Workspace A
    ws_a = Workspace(name=f"Workspace A {uid}", slug=f"ws-a-{uid}", owner_id=user_a.id)
    db_session.add(ws_a)
    await db_session.commit()
    await db_session.refresh(ws_a)

    # 3. Add User A as owner, User B as member
    member_a = WorkspaceMember(workspace_id=ws_a.id, user_id=user_a.id, role="owner")
    member_b = WorkspaceMember(workspace_id=ws_a.id, user_id=user_b.id, role="member")
    db_session.add_all([member_a, member_b])
    await db_session.commit()

    # 4. User B creates a 300-byte note in Workspace A
    content_300 = "A" * 300
    note_resp = await create_markdown_note(
        req=NoteCreate(name="NoteByB.md", content=content_300, workspace_id=ws_a.id),
        db=db_session,
        current_user=user_b
    )

    # Refresh users
    await db_session.refresh(user_a)
    await db_session.refresh(user_b)

    # User A (Owner) must have 300 bytes used
    assert user_a.storage_used_bytes == 300
    # User B (Uploader) must have 0 bytes used in B's personal quota
    assert user_b.storage_used_bytes == 0

    # 5. User B leaves Workspace A
    await db_session.delete(member_b)
    await db_session.commit()

    # Verify sync and integrity
    await quota_service.sync_all_users_storage(db_session)
    await db_session.refresh(user_a)
    await db_session.refresh(user_b)
    assert user_a.storage_used_bytes == 300
    assert user_b.storage_used_bytes == 0

    # 6. Re-add member B to test quota limit on workspace owner
    member_b_again = WorkspaceMember(workspace_id=ws_a.id, user_id=user_b.id, role="member")
    db_session.add(member_b_again)
    await db_session.commit()

    # User B tries to upload 800 bytes into Workspace A (User A has 1000 - 300 = 700 bytes remaining)
    # Even though User B has 10,000 bytes available in B's personal account, Workspace A is full!
    content_800 = "B" * 800
    with pytest.raises(HTTPException) as exc_info:
        await create_markdown_note(
            req=NoteCreate(name="TooLarge.md", content=content_800, workspace_id=ws_a.id),
            db=db_session,
            current_user=user_b
        )
    assert exc_info.value.status_code == 413
    assert "워크스페이스 저장 용량을 초과" in exc_info.value.detail

    # 7. Delete the 300-byte note and verify storage is reclaimed from Owner A
    note_id = uuid.UUID(str(note_resp.id))
    await delete_file(file_id=note_id, db=db_session, current_user=user_a)
    await db_session.refresh(user_a)
    await db_session.refresh(user_b)
    assert user_a.storage_used_bytes == 0
    assert user_b.storage_used_bytes == 0
