import pytest
import uuid
from app.models import User, Workspace, WorkspaceMember, Folder, FileItem, DocumentChunk
from app.services.access_service import access_service
from app.services.search_service import search_service
from app.schemas.search import SearchRequest
from app.routers.system import get_system_stats
from app.routers.search import reindex_all_files
from app.routers.folders import create_folder, update_folder
from app.routers.files import create_markdown_note, move_file
from app.schemas.folder import FolderCreate, FolderUpdate
from app.schemas.file import NoteCreate, FileMoveRequest
from fastapi import HTTPException

@pytest.mark.asyncio
async def test_system_stats_security_isolation(db_session):
    """Test get_system_stats enforces strict workspace isolation."""
    uid = str(uuid.uuid4())[:8]
    user_a = User(email=f"user_a_{uid}@test.com", name="User A", is_admin=False, is_approved=True)
    user_b = User(email=f"user_b_{uid}@test.com", name="User B", is_admin=False, is_approved=True)
    admin = User(email=f"admin_{uid}@test.com", name="Admin", is_admin=True, is_approved=True)
    db_session.add_all([user_a, user_b, admin])
    await db_session.commit()
    for u in [user_a, user_b, admin]:
        await db_session.refresh(u)

    ws_a = Workspace(name=f"WS A {uid}", slug=f"ws-a-{uid}", owner_id=user_a.id)
    ws_b = Workspace(name=f"WS B {uid}", slug=f"ws-b-{uid}", owner_id=user_b.id)
    db_session.add_all([ws_a, ws_b])
    await db_session.commit()
    for w in [ws_a, ws_b]:
        await db_session.refresh(w)

    db_session.add_all([
        WorkspaceMember(workspace_id=ws_a.id, user_id=user_a.id, role="owner"),
        WorkspaceMember(workspace_id=ws_b.id, user_id=user_b.id, role="owner")
    ])
    
    # Add files to WS A and WS B
    f_a1 = FileItem(name="A1.md", workspace_id=ws_a.id, created_by=user_a.id, is_markdown=True, size_bytes=100)
    f_a2 = FileItem(name="A2.md", workspace_id=ws_a.id, created_by=user_a.id, is_markdown=True, size_bytes=200)
    f_b1 = FileItem(name="B1.md", workspace_id=ws_b.id, created_by=user_b.id, is_markdown=True, size_bytes=300)
    db_session.add_all([f_a1, f_a2, f_b1])
    await db_session.commit()

    # 1. User B querying User A's workspace stats must raise 403 HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await get_system_stats(workspace_id=ws_a.id, db=db_session, current_user=user_b)
    assert exc_info.value.status_code == 403

    # 2. User A querying User A's workspace stats -> only gets 2 files, 2 notes
    data_a = await get_system_stats(workspace_id=ws_a.id, db=db_session, current_user=user_a)
    assert data_a["total_files"] == 2
    assert data_a["note_count"] == 2
    assert data_a["total_size_bytes"] == 300

    # 3. User B querying without workspace_id -> only aggregates WS B (1 file, 1 note)
    data_b = await get_system_stats(workspace_id=None, db=db_session, current_user=user_b)
    assert data_b["total_files"] == 1
    assert data_b["note_count"] == 1
    assert data_b["total_size_bytes"] == 300

    # 4. Admin querying without workspace_id -> sees global stats
    data_admin = await get_system_stats(workspace_id=None, db=db_session, current_user=admin)
    assert data_admin["total_files"] >= 3


@pytest.mark.asyncio
async def test_reindex_admin_only_protection(db_session):
    """Test reindex_all_files is strictly restricted to admins."""
    uid = str(uuid.uuid4())[:8]
    normal_user = User(email=f"normal_{uid}@test.com", name="Normal", is_admin=False, is_approved=True)
    admin_user = User(email=f"admin_{uid}@test.com", name="Admin", is_admin=True, is_approved=True)
    db_session.add_all([normal_user, admin_user])
    await db_session.commit()

    # Non-admin attempt -> 403 Forbidden
    with pytest.raises(HTTPException) as exc_info:
        await reindex_all_files(db=db_session, current_user=normal_user)
    assert exc_info.value.status_code == 403

    # Admin attempt -> 200 OK
    res_admin = await reindex_all_files(db=db_session, current_user=admin_user)
    assert res_admin["status"] == "success"


@pytest.mark.asyncio
async def test_cross_workspace_folder_and_file_operation_prevention(db_session):
    """Test preventing cross-workspace file injection, moving, and folder reparenting."""
    uid = str(uuid.uuid4())[:8]
    user_a = User(email=f"ua_{uid}@test.com", name="UA", is_admin=False, is_approved=True)
    user_b = User(email=f"ub_{uid}@test.com", name="UB", is_admin=False, is_approved=True)
    db_session.add_all([user_a, user_b])
    await db_session.commit()
    for u in [user_a, user_b]:
        await db_session.refresh(u)

    ws_a = Workspace(name=f"WSA_{uid}", slug=f"wsa-{uid}", owner_id=user_a.id)
    ws_b = Workspace(name=f"WSB_{uid}", slug=f"wsb-{uid}", owner_id=user_b.id)
    db_session.add_all([ws_a, ws_b])
    await db_session.commit()
    for w in [ws_a, ws_b]:
        await db_session.refresh(w)

    db_session.add_all([
        WorkspaceMember(workspace_id=ws_a.id, user_id=user_a.id, role="owner"),
        WorkspaceMember(workspace_id=ws_b.id, user_id=user_b.id, role="owner")
    ])

    folder_a = Folder(name="Folder A", workspace_id=ws_a.id, created_by=user_a.id)
    folder_b = Folder(name="Folder B", workspace_id=ws_b.id, created_by=user_b.id)
    db_session.add_all([folder_a, folder_b])
    await db_session.commit()
    for f in [folder_a, folder_b]:
        await db_session.refresh(f)

    file_a = FileItem(name="FileA.md", workspace_id=ws_a.id, folder_id=folder_a.id, created_by=user_a.id, is_markdown=True)
    file_b = FileItem(name="FileB.md", workspace_id=ws_b.id, folder_id=folder_b.id, created_by=user_b.id, is_markdown=True)
    db_session.add_all([file_a, file_b])
    await db_session.commit()
    for fl in [file_a, file_b]:
        await db_session.refresh(fl)

    # 1. User B tries to create a note inside WS A -> 403
    with pytest.raises(HTTPException) as exc1:
        await create_markdown_note(
            req=NoteCreate(name="AttackerNote.md", content="Hacked", workspace_id=ws_a.id),
            db=db_session,
            current_user=user_b
        )
    assert exc1.value.status_code == 403

    # 2. User B tries to move their file_b into folder_a (which is in WS A) -> 400 or 403
    with pytest.raises(HTTPException) as exc2:
        await move_file(
            file_id=file_b.id,
            req=FileMoveRequest(folder_id=folder_a.id),
            db=db_session,
            current_user=user_b
        )
    assert exc2.value.status_code in (400, 403)

    # 3. User B tries to update folder_b to make folder_a its parent -> 400 or 403
    with pytest.raises(HTTPException) as exc3:
        await update_folder(
            folder_id=folder_b.id,
            req=FolderUpdate(parent_id=folder_a.id),
            db=db_session,
            current_user=user_b
        )
    assert exc3.value.status_code in (400, 403)


@pytest.mark.asyncio
async def test_search_tenant_isolation(db_session):
    """Test search service never returns documents from unauthorized workspaces."""
    uid = str(uuid.uuid4())[:8]
    user_a = User(email=f"sa_a_{uid}@test.com", name="Alice", is_admin=False, is_approved=True)
    user_b = User(email=f"sa_b_{uid}@test.com", name="Bob", is_admin=False, is_approved=True)
    db_session.add_all([user_a, user_b])
    await db_session.commit()
    for u in [user_a, user_b]:
        await db_session.refresh(u)

    ws_a = Workspace(name=f"Secret Corp {uid}", slug=f"secret-{uid}", owner_id=user_a.id)
    ws_b = Workspace(name=f"Public Corp {uid}", slug=f"public-{uid}", owner_id=user_b.id)
    db_session.add_all([ws_a, ws_b])
    await db_session.commit()
    for w in [ws_a, ws_b]:
        await db_session.refresh(w)

    db_session.add_all([
        WorkspaceMember(workspace_id=ws_a.id, user_id=user_a.id, role="owner"),
        WorkspaceMember(workspace_id=ws_b.id, user_id=user_b.id, role="owner")
    ])

    secret_file = FileItem(
        name="TopSecretQuantumFormula.md",
        content="The secret formula is alpha-gamma-omega-99",
        workspace_id=ws_a.id,
        created_by=user_a.id,
        is_markdown=True
    )
    db_session.add(secret_file)
    await db_session.commit()
    await db_session.refresh(secret_file)

    # Index chunks
    chunk = DocumentChunk(
        file_id=secret_file.id,
        chunk_index=0,
        content="The secret formula is alpha-gamma-omega-99"
    )
    db_session.add(chunk)
    await db_session.commit()

    # User B searches for "QuantumFormula" across system
    search_req = SearchRequest(query="QuantumFormula", include_keyword_match=True)
    res_b = await search_service.search(db_session, search_req, current_user=user_b)
    
    # Must NOT find Alice's secret file!
    assert res_b.total_results == 0
    assert len(res_b.results) == 0

    # User A searches for "QuantumFormula" -> finds the file
    res_a = await search_service.search(db_session, search_req, current_user=user_a)
    assert res_a.total_results == 1
    assert res_a.results[0].file_id == secret_file.id
