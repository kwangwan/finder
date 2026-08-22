import pytest
import io
import zipfile
import uuid
from app.models import User, Workspace, WorkspaceMember, Folder, FileItem
from app.routers.folders import ensure_folder_path, download_folder_zip, list_folders
from app.routers.files import batch_download_files
from app.schemas.folder import EnsurePathRequest
from app.schemas.file import BatchDownloadRequest

@pytest.mark.asyncio
async def test_ensure_folder_path_and_zip_download(db_session):
    # 1. Create test user and workspace
    user = User(
        email=f"transfer_{uuid.uuid4().hex[:8]}@test.com",
        name="Transfer Tester",
        is_active=True,
        is_approved=True
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    ws = Workspace(
        name="Transfer Workspace",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        owner_id=user.id
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    member = WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner")
    db_session.add(member)
    await db_session.commit()

    # 2. Test ensure_folder_path for "photos/2026/summer"
    req = EnsurePathRequest(
        workspace_id=ws.id,
        relative_path="photos/2026/summer",
        parent_id=None
    )
    resp = await ensure_folder_path(req, db=db_session, current_user=user)
    assert resp.folder_name == "summer"
    assert resp.folder_id is not None
    summer_folder_id = resp.folder_id

    # Add a markdown note inside summer folder
    file1 = FileItem(
        name="trip_note.md",
        folder_id=summer_folder_id,
        workspace_id=ws.id,
        file_type="note",
        is_markdown=True,
        content="# Summer Vacation in 2026\nWonderful memories.",
        size_bytes=45,
        created_by=user.id
    )
    db_session.add(file1)

    # Add another file in root "photos" folder
    photos_folder_q = await db_session.get(Folder, summer_folder_id)
    year_folder = await db_session.get(Folder, photos_folder_q.parent_id)
    root_photos_folder = await db_session.get(Folder, year_folder.parent_id)
    assert root_photos_folder.name == "photos"

    file2 = FileItem(
        name="cover.md",
        folder_id=root_photos_folder.id,
        workspace_id=ws.id,
        file_type="note",
        is_markdown=True,
        content="Photos album cover",
        size_bytes=18,
        created_by=user.id
    )
    db_session.add(file2)
    await db_session.commit()

    # 3. Test Folder ZIP Download
    stream_resp = await download_folder_zip(root_photos_folder.id, db=db_session, current_user=user)
    assert stream_resp.media_type == "application/zip"
    
    # Read streamed zip bytes
    chunks = []
    async for chunk in stream_resp.body_iterator:
        chunks.append(chunk)
    zip_bytes = b"".join(chunks)

    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as z:
        names = z.namelist()
        print("Zip entries:", names)
        assert "photos/cover.md" in names
        assert "photos/2026/summer/trip_note.md" in names
        assert z.read("photos/2026/summer/trip_note.md").decode("utf-8") == "# Summer Vacation in 2026\nWonderful memories."

    # 4. Test Batch Download
    batch_req = BatchDownloadRequest(
        workspace_id=ws.id,
        file_ids=[file2.id],
        folder_ids=[summer_folder_id],
        archive_name="my_selection.zip"
    )
    batch_resp = await batch_download_files(batch_req, db=db_session, current_user=user)
    assert batch_resp.media_type == "application/zip"
    b_chunks = []
    async for chunk in batch_resp.body_iterator:
        b_chunks.append(chunk)
    batch_zip_bytes = b"".join(b_chunks)

    with zipfile.ZipFile(io.BytesIO(batch_zip_bytes), "r") as z:
        names = z.namelist()
        print("Batch Zip entries:", names)
        assert "cover.md" in names
        assert "summer/trip_note.md" in names

    # 5. Test Batch Move
    from app.routers.files import batch_move_files
    from app.schemas.file import BatchMoveRequest
    
    move_req = BatchMoveRequest(
        workspace_id=ws.id,
        file_ids=[file2.id],
        folder_id=summer_folder_id
    )
    move_res = await batch_move_files(move_req, db=db_session, current_user=user)
    assert move_res["moved_count"] == 1

    await db_session.refresh(file2)
    assert file2.folder_id == summer_folder_id

    # Move back to root (folder_id = None)
    move_req_root = BatchMoveRequest(
        workspace_id=ws.id,
        file_ids=[file2.id],
        folder_id=None
    )
    move_res_root = await batch_move_files(move_req_root, db=db_session, current_user=user)
    assert move_res_root["moved_count"] == 1
    await db_session.refresh(file2)
    assert file2.folder_id is None

