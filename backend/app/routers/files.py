import uuid
import math
from datetime import datetime
from typing import List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, desc, asc, func
import io
import zipfile
import urllib.parse
from fastapi.responses import StreamingResponse
from app.core.database import get_db
from app.models import FileItem, Folder, User, WorkspaceMember
from app.core.security import get_current_approved_user
from app.schemas.file import (
    NoteCreate, NoteUpdate, FileMetadataCreate, FileMoveRequest,
    FileRenameRequest, FileResponse, FileDetailResponse, PagedFileResponse,
    BatchDownloadRequest, BatchMoveRequest
)
from app.routers.folders import _collect_folder_files_recursive
from app.services.s3_service import s3_service, sanitize_filename
from app.services.document_service import document_service
from app.services.access_service import access_service
from app.services.quota_service import quota_service
from app.services.deletion_service import deletion_service

router = APIRouter(prefix="/api/files", tags=["Files & Notes"])

def _to_file_response(f: FileItem) -> FileResponse:
    resp = FileResponse.model_validate(f)
    if f.thumbnail_s3_key:
        resp.thumbnail_url = f"/api/storage/thumbnail/{f.id}"
    return resp

def _to_file_detail_response(f: FileItem, folder_name: Optional[str] = None, download_url: Optional[str] = None) -> FileDetailResponse:
    resp = FileDetailResponse.model_validate(f)
    if f.thumbnail_s3_key:
        resp.thumbnail_url = f"/api/storage/thumbnail/{f.id}"
    resp.folder_name = folder_name
    resp.download_url = download_url
    return resp

@router.get("", response_model=Union[PagedFileResponse, List[FileResponse]])
async def list_files(
    workspace_id: Optional[uuid.UUID] = None,
    folder_id: Optional[uuid.UUID] = None,
    root_only: Optional[bool] = Query(False, description="Filter only files located directly in workspace root"),
    file_type: Optional[str] = None,
    is_favorite: Optional[bool] = None,
    tag: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: Optional[str] = Query("updated_at", description="Sort field: name, file_type, updated_at, created_at, size_bytes"),
    sort_order: Optional[str] = Query("desc", description="Sort order: asc or desc"),
    page: Optional[int] = Query(None, ge=1, description="Page number (1-indexed)"),
    page_size: Optional[int] = Query(None, ge=1, le=200, description="Items per page"),
    paged: Optional[bool] = Query(None, description="Force paged response envelope"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """List accessible non-trashed files in a workspace with flexible sorting and pagination."""
    conditions = [FileItem.is_trashed == False]

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        conditions.append(FileItem.workspace_id == workspace_id)
    else:
        ws_ids = await access_service.get_user_workspace_ids(db, current_user.id)
        if ws_ids:
            conditions.append(or_(
                FileItem.workspace_id.in_(list(ws_ids)),
                and_(FileItem.workspace_id.is_(None), FileItem.created_by == current_user.id)
            ))
        else:
            conditions.append(and_(FileItem.workspace_id.is_(None), FileItem.created_by == current_user.id))

    if root_only:
        conditions.append(FileItem.folder_id.is_(None))
    elif folder_id is not None:
        conditions.append(FileItem.folder_id == folder_id)
    if file_type is not None:
        conditions.append(FileItem.file_type == file_type)
    if is_favorite is not None:
        conditions.append(FileItem.is_favorite == is_favorite)
    if search:
        conditions.append(FileItem.name.ilike(f"%{search}%"))

    # Sorting resolution
    sort_column_map = {
        "name": FileItem.name,
        "file_type": FileItem.file_type,
        "updated_at": FileItem.updated_at,
        "created_at": FileItem.created_at,
        "size_bytes": FileItem.size_bytes
    }
    sort_by_str = sort_by if isinstance(sort_by, str) else "updated_at"
    sort_order_str = sort_order if isinstance(sort_order, str) else "desc"
    col = sort_column_map.get(sort_by_str, FileItem.updated_at)
    order_expr = col.asc() if sort_order_str.lower() == "asc" else col.desc()

    # Base select statement
    stmt = select(FileItem).where(and_(*conditions)).order_by(order_expr)

    # Count total matching items
    count_stmt = select(func.count(FileItem.id)).where(and_(*conditions))
    total_count = (await db.execute(count_stmt)).scalar_one()

    page_val = page if isinstance(page, int) else None
    page_size_val = page_size if isinstance(page_size, int) else None
    paged_val = paged if isinstance(paged, bool) else False
    is_paged = (page_val is not None) or paged_val

    if is_paged:
        current_page = page_val if page_val is not None else 1
        current_size = page_size_val if page_size_val is not None else 20
        stmt = stmt.offset((current_page - 1) * current_size).limit(current_size)
        res = await db.execute(stmt)
        files = res.scalars().all()
        if tag:
            files = [f for f in files if tag in (f.tags or [])]

        total_pages = math.ceil(total_count / current_size) if current_size > 0 else 1
        return PagedFileResponse(
            items=[_to_file_response(f) for f in files],
            total_count=total_count,
            page=current_page,
            page_size=current_size,
            total_pages=total_pages
        )
    else:
        if page_size_val:
            stmt = stmt.limit(page_size_val)
        res = await db.execute(stmt)
        files = res.scalars().all()
        if tag:
            files = [f for f in files if tag in (f.tags or [])]
        return [_to_file_response(f) for f in files]


@router.get("/{file_id}", response_model=FileDetailResponse)
async def get_file_detail(
    file_id: uuid.UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Get single file/note details including content and presigned download URL."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일에 접근할 수 있는 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")

    folder_name = None
    if file_item.folder_id:
        folder = await db.get(Folder, file_item.folder_id)
        if folder:
            folder_name = folder.name

    download_url = None
    if file_item.s3_key:
        try:
            download_url = s3_service.generate_presigned_get_url(file_item.s3_key, file_item.name)
        except Exception as e:
            print(f"[Presigned URL Warning] Could not generate download url: {e}")

    return _to_file_detail_response(file_item, folder_name=folder_name, download_url=download_url)

@router.post("/notes", response_model=FileDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_markdown_note(
    req: NoteCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Create a new Markdown note in a workspace."""
    workspace_id = req.workspace_id

    if req.folder_id:
        if not await access_service.can_access_folder(db, current_user, req.folder_id):
            raise HTTPException(status_code=403, detail="폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, req.folder_id)
        if folder:
            if workspace_id and folder.workspace_id and workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")
            if not workspace_id:
                workspace_id = folder.workspace_id

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    name = req.name.strip()
    display_name = name
    content_bytes = len(req.content.encode("utf-8"))

    # Quota check on workspace owner
    await quota_service.check_quota(db, workspace_id, current_user, content_bytes)

    file_item = FileItem(
        folder_id=req.folder_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        name=display_name,
        file_type="markdown",
        mime_type="text/markdown",
        size_bytes=content_bytes,
        content=req.content,
        is_markdown=True,
        tags=req.tags or []
    )
    db.add(file_item)
    await db.commit()
    await db.refresh(file_item)

    # Record storage added to workspace owner
    await quota_service.record_storage_added(db, workspace_id, current_user, file_item.size_bytes)

    try:
        s3_key = f"notes/{file_item.id}/{sanitize_filename(display_name)}"
        s3_service.put_object(s3_key, req.content.encode("utf-8"), "text/markdown; charset=utf-8")
        file_item.s3_key = s3_key
        await db.commit()
        await db.refresh(file_item)
    except Exception as e:
        print(f"[MinIO Backup Warning] Could not backup note to MinIO: {e}")

    try:
        await document_service.index_file_chunks(db, file_item)
    except Exception as e:
        print(f"[Embedding Warning] Indexing failed for note {file_item.id}: {e}")

    return _to_file_detail_response(file_item)

@router.put("/notes/{file_id}", response_model=FileDetailResponse)
async def update_markdown_note(
    file_id: uuid.UUID, 
    req: NoteUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Update markdown note content/name and re-index vector embeddings."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일을 수정할 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="Note not found")

    target_ws_id = req.workspace_id if req.workspace_id is not None else file_item.workspace_id
    if req.workspace_id is not None and req.workspace_id != file_item.workspace_id:
        if not await access_service.is_workspace_member(db, current_user, req.workspace_id):
            raise HTTPException(status_code=403, detail="이동할 워크스페이스에 접근할 권한이 없습니다.")

    if req.folder_id is not None:
        if not await access_service.can_access_folder(db, current_user, req.folder_id):
            raise HTTPException(status_code=403, detail="이동할 폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, req.folder_id)
        if folder and target_ws_id and folder.workspace_id and target_ws_id != folder.workspace_id:
            raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")

    old_size = file_item.size_bytes or 0
    content_changed = False
    if req.name is not None:
        file_item.name = req.name
    if req.folder_id is not None:
        file_item.folder_id = req.folder_id
    if req.workspace_id is not None:
        file_item.workspace_id = req.workspace_id
    if req.content is not None:
        new_size = len(req.content.encode("utf-8"))
        size_delta = new_size - old_size
        if size_delta > 0:
            await quota_service.check_quota(db, target_ws_id, current_user, size_delta)
        file_item.content = req.content
        file_item.size_bytes = new_size
        content_changed = True
    if req.tags is not None:
        file_item.tags = req.tags
    if req.is_favorite is not None:
        file_item.is_favorite = req.is_favorite

    await db.commit()
    await db.refresh(file_item)

    if content_changed:
        size_delta = file_item.size_bytes - old_size
        await quota_service.record_storage_added(db, target_ws_id, current_user, size_delta)

    if content_changed and file_item.s3_key:
        try:
            s3_service.put_object(file_item.s3_key, file_item.content.encode("utf-8"), "text/markdown; charset=utf-8")
        except Exception as e:
            print(f"[MinIO Backup Warning] Could not update MinIO note: {e}")

    if content_changed:
        try:
            await document_service.index_file_chunks(db, file_item)
        except Exception as e:
            print(f"[Embedding Warning] Re-indexing failed for note {file_item.id}: {e}")

    return _to_file_detail_response(file_item)

@router.post("/metadata", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def create_file_metadata(
    req: FileMetadataCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Save file metadata after successful MinIO upload and trigger auto-indexing."""
    workspace_id = req.workspace_id

    if req.folder_id:
        if not await access_service.can_access_folder(db, current_user, req.folder_id):
            raise HTTPException(status_code=403, detail="폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, req.folder_id)
        if folder:
            if workspace_id and folder.workspace_id and workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")
            if not workspace_id:
                workspace_id = folder.workspace_id

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    file_item = FileItem(
        folder_id=req.folder_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        name=req.name,
        file_type=req.file_type,
        mime_type=req.mime_type,
        size_bytes=req.size_bytes,
        s3_key=req.s3_key,
        content=req.content,
        is_markdown=req.is_markdown,
        tags=req.tags or []
    )
    db.add(file_item)
    await db.commit()
    await db.refresh(file_item)

    # Record storage added
    await quota_service.record_storage_added(db, workspace_id, current_user, file_item.size_bytes or 0)

    try:
        await document_service.index_file_chunks(db, file_item)
    except Exception as e:
        print(f"[Embedding Warning] Indexing failed for uploaded file {file_item.id}: {e}")

    return _to_file_response(file_item)

@router.put("/{file_id}/move", response_model=FileResponse)
async def move_file(
    file_id: uuid.UUID, 
    req: FileMoveRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Move file to another folder."""
    if not await access_service.can_access_file(db, current_user, file_id):
        raise HTTPException(status_code=403, detail="파일을 이동할 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")

    if req.folder_id:
        if not await access_service.can_access_folder(db, current_user, req.folder_id):
            raise HTTPException(status_code=403, detail="대상 폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, req.folder_id)
        if not folder:
            raise HTTPException(status_code=404, detail="Target folder not found")
        # Ensure target folder is in same workspace or user has access
        if folder.workspace_id and file_item.workspace_id and folder.workspace_id != file_item.workspace_id:
            raise HTTPException(status_code=400, detail="다른 워크스페이스의 폴더로 파일을 이동할 수 없습니다.")
        if folder.workspace_id:
            file_item.workspace_id = folder.workspace_id

    file_item.folder_id = req.folder_id
    await db.commit()
    await db.refresh(file_item)
    return _to_file_response(file_item)

@router.put("/{file_id}/rename", response_model=FileResponse)
async def rename_file(
    file_id: uuid.UUID, 
    req: FileRenameRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Rename a file."""
    if not await access_service.can_access_file(db, current_user, file_id):
        raise HTTPException(status_code=403, detail="파일명을 변경할 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")

    file_item.name = req.name.strip()
    await db.commit()
    await db.refresh(file_item)
    return _to_file_response(file_item)

@router.put("/{file_id}/trash", response_model=FileResponse)
async def trash_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Move file to trash."""
    if not await access_service.can_access_file(db, current_user, file_id):
        raise HTTPException(status_code=403, detail="파일을 삭제할 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")

    file_item.is_trashed = True
    file_item.trashed_at = datetime.utcnow()
    await db.commit()
    await db.refresh(file_item)
    return _to_file_response(file_item)

@router.put("/{file_id}/restore", response_model=FileResponse)
async def restore_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Restore file from trash."""
    if not await access_service.can_access_file(db, current_user, file_id):
        raise HTTPException(status_code=403, detail="파일을 복구할 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")

    # If parent folder is still trashed, restore file to root
    if file_item.folder_id:
        folder = await db.get(Folder, file_item.folder_id)
        if folder and folder.is_trashed:
            file_item.folder_id = None

    file_item.is_trashed = False
    file_item.trashed_at = None
    await db.commit()
    await db.refresh(file_item)
    return _to_file_response(file_item)

@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: uuid.UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Permanently delete file via asynchronous deletion queue."""
    if not await access_service.can_access_file(db, current_user, file_id):
        raise HTTPException(status_code=403, detail="파일을 삭제할 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")

    await deletion_service.enqueue_file(db, file_item)

    # Reclaim storage quota from workspace owner immediately
    await quota_service.record_storage_freed(
        db=db,
        workspace_id=file_item.workspace_id,
        creator_id=file_item.created_by,
        bytes_freed=file_item.size_bytes or 0
    )

    await db.delete(file_item)
    await db.commit()
    return None


@router.post("/batch-download")
async def batch_download_files(
    req: BatchDownloadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Download multiple files and/or folders as a single ZIP archive.
    """
    if not await access_service.is_workspace_member(db, current_user, req.workspace_id):
        raise HTTPException(status_code=403, detail="워크스페이스에 접근할 권한이 없습니다.")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        # 1. Direct files
        if req.file_ids:
            files_q = select(FileItem).where(
                and_(
                    FileItem.id.in_(req.file_ids),
                    FileItem.workspace_id == req.workspace_id,
                    FileItem.is_trashed == False
                )
            )
            files_res = await db.execute(files_q)
            for f in files_res.scalars().all():
                file_bytes = None
                if f.is_markdown and f.content:
                    file_bytes = f.content.encode("utf-8")
                elif f.s3_key:
                    file_bytes = s3_service.get_object_content(f.s3_key)
                if file_bytes is not None:
                    zip_file.writestr(f.name, file_bytes)

        # 2. Folders
        if req.folder_ids:
            for fid in req.folder_ids:
                folder = await db.get(Folder, fid)
                if folder and folder.workspace_id == req.workspace_id and not folder.is_trashed:
                    files_with_paths = await _collect_folder_files_recursive(db, folder.id, "")
                    if not files_with_paths:
                        zip_file.writestr(f"{folder.name}/.keep", b"")
                    for file_item, rel_path in files_with_paths:
                        full_rel_path = f"{folder.name}/{rel_path}"
                        file_bytes = None
                        if file_item.is_markdown and file_item.content:
                            file_bytes = file_item.content.encode("utf-8")
                        elif file_item.s3_key:
                            file_bytes = s3_service.get_object_content(file_item.s3_key)
                        if file_bytes is not None:
                            zip_file.writestr(full_rel_path, file_bytes)

    zip_buffer.seek(0)
    zip_size = zip_buffer.getbuffer().nbytes
    archive_name = req.archive_name or "download_archive.zip"
    if not archive_name.lower().endswith(".zip"):
        archive_name += ".zip"
    safe_filename = urllib.parse.quote(archive_name)

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}",
        "Content-Length": str(zip_size),
        "Access-Control-Expose-Headers": "Content-Disposition, Content-Length"
    }

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers=headers
    )


@router.post("/batch-move")
async def batch_move_files(
    req: BatchMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Move multiple files at once to a target folder (or root if folder_id is None).
    """
    if not await access_service.is_workspace_member(db, current_user, req.workspace_id):
        raise HTTPException(status_code=403, detail="워크스페이스에 접근할 권한이 없습니다.")

    if req.folder_id:
        target_folder = await db.get(Folder, req.folder_id)
        if not target_folder or target_folder.workspace_id != req.workspace_id or target_folder.is_trashed:
            raise HTTPException(status_code=404, detail="대상 폴더를 찾을 수 없거나 이동할 수 없습니다.")

    if not req.file_ids:
        return {"moved_count": 0, "folder_id": req.folder_id}

    files_q = select(FileItem).where(
        and_(
            FileItem.id.in_(req.file_ids),
            FileItem.workspace_id == req.workspace_id,
            FileItem.is_trashed == False
        )
    )
    files_res = await db.execute(files_q)
    files_to_move = files_res.scalars().all()

    moved_count = 0
    for f in files_to_move:
        if await access_service.can_access_file(db, current_user, f.id):
            f.folder_id = req.folder_id
            moved_count += 1

    await db.commit()
    return {"moved_count": moved_count, "folder_id": req.folder_id}


