import pytest
import uuid
from app.models import User, Workspace, WorkspaceMember, Folder, FileItem
from app.routers.files import list_files
from app.routers.folders import list_folders
from app.schemas.file import PagedFileResponse
from app.schemas.folder import PagedFolderResponse

@pytest.mark.asyncio
async def test_files_sorting_and_pagination(db_session):
    uid = str(uuid.uuid4())[:8]
    user = User(email=f"sort_user_{uid}@test.com", name="Sorter", is_admin=False, is_approved=True)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    ws = Workspace(name=f"WS Sort {uid}", slug=f"ws-sort-{uid}", owner_id=user.id)
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    member = WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner")
    db_session.add(member)

    # Add 5 files with different names, sizes, and file_types
    f1 = FileItem(name="Banana.md", workspace_id=ws.id, created_by=user.id, file_type="note", size_bytes=100, is_markdown=True)
    f2 = FileItem(name="Apple.pdf", workspace_id=ws.id, created_by=user.id, file_type="pdf", size_bytes=500, is_markdown=False)
    f3 = FileItem(name="Cherry.docx", workspace_id=ws.id, created_by=user.id, file_type="docx", size_bytes=200, is_markdown=False)
    f4 = FileItem(name="Date.png", workspace_id=ws.id, created_by=user.id, file_type="image", size_bytes=900, is_markdown=False)
    f5 = FileItem(name="Elderberry.txt", workspace_id=ws.id, created_by=user.id, file_type="text", size_bytes=50, is_markdown=False)
    db_session.add_all([f1, f2, f3, f4, f5])
    await db_session.commit()

    # 1. Sort by name asc
    res_name_asc = await list_files(
        workspace_id=ws.id,
        sort_by="name",
        sort_order="asc",
        db=db_session,
        current_user=user
    )
    names_asc = [f.name for f in res_name_asc]
    assert names_asc == ["Apple.pdf", "Banana.md", "Cherry.docx", "Date.png", "Elderberry.txt"]

    # 2. Sort by name desc
    res_name_desc = await list_files(
        workspace_id=ws.id,
        sort_by="name",
        sort_order="desc",
        db=db_session,
        current_user=user
    )
    names_desc = [f.name for f in res_name_desc]
    assert names_desc == ["Elderberry.txt", "Date.png", "Cherry.docx", "Banana.md", "Apple.pdf"]

    # 3. Sort by size_bytes desc
    res_size_desc = await list_files(
        workspace_id=ws.id,
        sort_by="size_bytes",
        sort_order="desc",
        db=db_session,
        current_user=user
    )
    sizes_desc = [f.size_bytes for f in res_size_desc]
    assert sizes_desc == [900, 500, 200, 100, 50]

    # 4. Pagination: page=1, page_size=2
    paged_1 = await list_files(
        workspace_id=ws.id,
        sort_by="name",
        sort_order="asc",
        page=1,
        page_size=2,
        db=db_session,
        current_user=user
    )
    assert isinstance(paged_1, PagedFileResponse)
    assert paged_1.total_count == 5
    assert paged_1.page == 1
    assert paged_1.page_size == 2
    assert paged_1.total_pages == 3
    assert len(paged_1.items) == 2
    assert [f.name for f in paged_1.items] == ["Apple.pdf", "Banana.md"]

    # 5. Pagination: page=2, page_size=2
    paged_2 = await list_files(
        workspace_id=ws.id,
        sort_by="name",
        sort_order="asc",
        page=2,
        page_size=2,
        db=db_session,
        current_user=user
    )
    assert len(paged_2.items) == 2
    assert [f.name for f in paged_2.items] == ["Cherry.docx", "Date.png"]

    # 6. Pagination: page=3, page_size=2 (last item)
    paged_3 = await list_files(
        workspace_id=ws.id,
        sort_by="name",
        sort_order="asc",
        page=3,
        page_size=2,
        db=db_session,
        current_user=user
    )
    assert len(paged_3.items) == 1
    assert [f.name for f in paged_3.items] == ["Elderberry.txt"]


@pytest.mark.asyncio
async def test_folders_sorting_and_pagination(db_session):
    uid = str(uuid.uuid4())[:8]
    user = User(email=f"fold_user_{uid}@test.com", name="FolderSorter", is_admin=False, is_approved=True)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    ws = Workspace(name=f"WS Fold {uid}", slug=f"ws-fold-{uid}", owner_id=user.id)
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    member = WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner")
    db_session.add(member)

    fol1 = Folder(name="ZetaFolder", workspace_id=ws.id, created_by=user.id)
    fol2 = Folder(name="AlphaFolder", workspace_id=ws.id, created_by=user.id)
    fol3 = Folder(name="BetaFolder", workspace_id=ws.id, created_by=user.id)
    db_session.add_all([fol1, fol2, fol3])
    await db_session.commit()

    # Sort name asc
    res_asc = await list_folders(workspace_id=ws.id, sort_by="name", sort_order="asc", db=db_session, current_user=user)
    assert [f.name for f in res_asc] == ["AlphaFolder", "BetaFolder", "ZetaFolder"]

    # Sort name desc
    res_desc = await list_folders(workspace_id=ws.id, sort_by="name", sort_order="desc", db=db_session, current_user=user)
    assert [f.name for f in res_desc] == ["ZetaFolder", "BetaFolder", "AlphaFolder"]

    # Pagination
    paged = await list_folders(workspace_id=ws.id, sort_by="name", sort_order="asc", page=1, page_size=2, db=db_session, current_user=user)
    assert isinstance(paged, PagedFolderResponse)
    assert paged.total_count == 3
    assert paged.total_pages == 2
    assert len(paged.items) == 2
    assert [f.name for f in paged.items] == ["AlphaFolder", "BetaFolder"]
