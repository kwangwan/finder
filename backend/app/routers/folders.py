import uuid
import math
import asyncio
from datetime import datetime, timezone
from typing import List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, and_, or_, desc, asc

import re
import urllib.parse
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.core.database import get_db
from app.models import Folder, FileItem, User, WorkspaceMember
from app.core.security import get_current_approved_user
from app.schemas.folder import (
    FolderCreate, FolderUpdate, FolderResponse, FolderTreeNode, PagedFolderResponse,
    EnsurePathRequest, EnsurePathResponse
)
from app.schemas.file import FileRenameRequest
from app.services.access_service import access_service
from app.services.s3_service import s3_service
from app.services.quota_service import quota_service
from app.services.zip_stream_service import stream_zip, dedupe_archive_paths
from app.core.config import settings

router = APIRouter(prefix="/api/folders", tags=["Folders"])


async def _set_folder_trash_recursive(db: AsyncSession, folder: Folder, is_trashed: bool, trashed_at: Optional[datetime]):
    """Recursively set trash status for a folder, its child folders, and files."""
    folder.is_trashed = is_trashed
    folder.trashed_at = trashed_at
    
    # 1. Update all files in this folder
    files_res = await db.execute(select(FileItem).where(FileItem.folder_id == folder.id))
    for f in files_res.scalars().all():
        f.is_trashed = is_trashed
        f.trashed_at = trashed_at
        
    # 2. Recurse into child folders
    children_res = await db.execute(select(Folder).where(Folder.parent_id == folder.id))
    for child in children_res.scalars().all():
        await _set_folder_trash_recursive(db, child, is_trashed, trashed_at)


async def reconcile_orphaned_trashed_files(db: AsyncSession) -> int:
    """
    Fix FileItem rows with is_trashed=False sitting under an is_trashed=True
    folder — invisible in the normal folder view (parent is trashed), absent
    from the trash view (their own flag says not trashed), yet still counted
    in stats. This happens when a file is still mid-upload (a large
    background batch) at the exact moment its target folder gets trashed —
    the recursive trash cascade only catches rows that existed at that
    instant. Upload endpoints now reject writing into an already-trashed
    folder, but this repairs anything created in that race before the fix,
    or by any other path that doesn't go through the same check. Inherits
    the parent folder's trashed_at so these files enter the normal 30-day
    trash-purge cycle like everything else, instead of staying stuck.
    """
    stmt = (
        select(FileItem)
        .join(Folder, FileItem.folder_id == Folder.id)
        .where(FileItem.is_trashed == False, Folder.is_trashed == True)
    )
    res = await db.execute(stmt)
    files = res.scalars().all()
    for f in files:
        folder = await db.get(Folder, f.folder_id)
        f.is_trashed = True
        f.trashed_at = folder.trashed_at or datetime.now(timezone.utc)
    if files:
        await db.commit()
    return len(files)


@router.get("", response_model=Union[PagedFolderResponse, List[FolderResponse]])
async def list_folders(
    workspace_id: Optional[uuid.UUID] = None,
    parent_id: Optional[uuid.UUID] = None, 
    search: Optional[str] = Query(None, description="Filter by folder name"),
    root_only: Optional[bool] = Query(False, description="Only folders at the workspace root"),
    sort_by: Optional[str] = Query("name", description="Sort field: name, updated_at, created_at, file_count"),
    sort_order: Optional[str] = Query("asc", description="Sort order: asc or desc"),
    page: Optional[int] = Query(None, ge=1, description="Page number (1-indexed)"),
    page_size: Optional[int] = Query(None, ge=1, le=200, description="Items per page"),
    paged: Optional[bool] = Query(None, description="Force paged response envelope"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """List non-trashed folders in a workspace with file count, sorting and pagination."""
    file_count_expr = func.count(FileItem.id).filter(FileItem.is_trashed == False).label("file_count")
    
    sort_column_map = {
        "name": Folder.name,
        "updated_at": Folder.updated_at,
        "created_at": Folder.created_at,
        "file_count": file_count_expr
    }
    sort_by_str = sort_by if isinstance(sort_by, str) else "name"
    sort_order_str = sort_order if isinstance(sort_order, str) else "asc"
    col = sort_column_map.get(sort_by_str, Folder.name)
    is_asc = sort_order_str.lower() == "asc"
    order_expr = col.asc() if is_asc else col.desc()

    # Same non-unique-sort + OFFSET pagination hazard as list_files (see the
    # long note there): without a unique final tiebreaker, tied rows have no
    # defined order and each page slices that undefined order on its own, so
    # a folder can repeat across pages while another never appears.
    tiebreakers = []
    if col is not Folder.name:
        tiebreakers.append(Folder.name.asc() if is_asc else Folder.name.desc())
    tiebreakers.append(Folder.id.asc() if is_asc else Folder.id.desc())

    stmt = select(
        Folder,
        file_count_expr
    ).outerjoin(FileItem, FileItem.folder_id == Folder.id).group_by(Folder.id).order_by(order_expr, *tiebreakers)
    
    conditions = [Folder.is_trashed == False]

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        conditions.append(Folder.workspace_id == workspace_id)
    else:
        ws_ids = await access_service.get_user_workspace_ids(db, current_user.id)
        if ws_ids:
            conditions.append(or_(
                Folder.workspace_id.in_(list(ws_ids)),
                and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id)
            ))
        else:
            conditions.append(and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id))

    if root_only:
        # The shared workspace's root holds one folder per person, so it is
        # paged and searchable rather than listed whole.
        conditions.append(Folder.parent_id.is_(None))
    elif parent_id is not None:
        conditions.append(Folder.parent_id == parent_id)
    if search and search.strip():
        conditions.append(Folder.name.ilike(f"%{search.strip()}%"))

    stmt = stmt.where(and_(*conditions))

    # Count total folders
    count_stmt = select(func.count(Folder.id)).where(and_(*conditions))
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
        rows = res.all()

        results = []
        for folder, count in rows:
            resp = FolderResponse.model_validate(folder)
            resp.file_count = count
            results.append(resp)

        total_pages = math.ceil(total_count / current_size) if current_size > 0 else 1
        return PagedFolderResponse(
            items=results,
            total_count=total_count,
            page=current_page,
            page_size=current_size,
            total_pages=total_pages
        )
    else:
        if page_size_val:
            stmt = stmt.limit(page_size_val)
        res = await db.execute(stmt)
        rows = res.all()
        
        results = []
        for folder, count in rows:
            resp = FolderResponse.model_validate(folder)
            resp.file_count = count
            results.append(resp)
        return results


@router.get("/tree", response_model=List[FolderTreeNode])
async def get_folder_tree(
    workspace_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Get the full non-trashed nested recursive folder tree for a workspace."""
    stmt = select(
        Folder,
        func.count(FileItem.id).filter(FileItem.is_trashed == False).label("file_count")
    ).outerjoin(FileItem, FileItem.folder_id == Folder.id).group_by(Folder.id).order_by(Folder.name.asc())
    
    conditions = [Folder.is_trashed == False]
    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        conditions.append(Folder.workspace_id == workspace_id)
    else:
        ws_ids = await access_service.get_user_workspace_ids(db, current_user.id)
        if ws_ids:
            conditions.append(or_(
                Folder.workspace_id.in_(list(ws_ids)),
                and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id)
            ))
        else:
            conditions.append(and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id))

    stmt = stmt.where(and_(*conditions))

    res = await db.execute(stmt)
    rows = res.all()

    nodes_by_id = {}
    for folder, count in rows:
        node = FolderTreeNode(
            id=folder.id,
            name=folder.name,
            parent_id=folder.parent_id,
            icon=folder.icon,
            color=folder.color,
            is_trashed=folder.is_trashed,
            trashed_at=folder.trashed_at,
            created_at=folder.created_at,
            updated_at=folder.updated_at,
            file_count=count,
            children=[]
        )
        nodes_by_id[folder.id] = node

    roots = []
    for node in nodes_by_id.values():
        if node.parent_id and node.parent_id in nodes_by_id:
            nodes_by_id[node.parent_id].children.append(node)
        else:
            roots.append(node)

    return roots


@router.post("", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    req: FolderCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Create a new folder in a workspace."""
    workspace_id = getattr(req, 'workspace_id', None)

    if workspace_id:
        role = await access_service.get_workspace_role(db, current_user, workspace_id)
        if not role:
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        await access_service.require_write_at(db, current_user, workspace_id, req.parent_id)

    if req.parent_id:
        if not await access_service.can_access_folder(db, current_user, req.parent_id):
            raise HTTPException(status_code=403, detail="상위 폴더에 접근할 권한이 없습니다.")
        parent = await db.get(Folder, req.parent_id)
        if not parent or parent.is_trashed:
            raise HTTPException(status_code=404, detail="Parent folder not found or trashed")
        if workspace_id and parent.workspace_id and workspace_id != parent.workspace_id:
            raise HTTPException(status_code=400, detail="상위 폴더와 워크스페이스가 일치하지 않습니다.")
        if not workspace_id and parent.workspace_id:
            workspace_id = parent.workspace_id

    folder = Folder(
        name=req.name,
        parent_id=req.parent_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        icon=req.icon or "folder",
        color=req.color,
        is_trashed=False
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    
    resp = FolderResponse.model_validate(folder)
    resp.file_count = 0
    return resp


@router.put("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: uuid.UUID, 
    req: FolderUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Update or rename/move a folder."""
    folder = await db.get(Folder, folder_id)
    if not folder or folder.is_trashed:
        raise HTTPException(status_code=404, detail="Folder not found")
    await access_service.require_write_at(db, current_user, folder.workspace_id, folder.parent_id or folder.id)

    if not await access_service.can_access_folder(db, current_user, folder_id):
        raise HTTPException(status_code=403, detail="폴더를 수정할 권한이 없습니다.")

    if req.name is not None:
        folder.name = req.name.strip()

    # `parent_id: null` is a meaningful value here — it means "move to the
    # workspace root" — and is indistinguishable from "field omitted" by
    # value alone, so ask Pydantic which fields the caller actually sent.
    # Without this, drag-and-dropping a folder onto 홈 could never move it
    # back out to the root.
    if "parent_id" in req.model_fields_set:
        if req.parent_id is None:
            await access_service.require_write_at(db, current_user, folder.workspace_id, None)
            folder.parent_id = None
        else:
            if req.parent_id == folder_id:
                raise HTTPException(status_code=400, detail="Folder cannot be parent of itself")
            if not await access_service.can_access_folder(db, current_user, req.parent_id):
                raise HTTPException(status_code=403, detail="상위 폴더에 접근할 권한이 없습니다.")
            parent = await db.get(Folder, req.parent_id)
            if not parent or parent.is_trashed:
                raise HTTPException(status_code=404, detail="Parent folder not found or trashed")
            if parent.workspace_id and folder.workspace_id and parent.workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="다른 워크스페이스의 폴더 하위로 이동할 수 없습니다.")

            # Reject moving a folder underneath its own descendant. That would
            # detach the whole subtree from the root — it would still exist,
            # but with a parent chain that loops, so it can never be reached
            # by the tree walk and the folder list would silently lose it.
            ancestor_id = parent.parent_id
            seen = {folder_id, req.parent_id}
            while ancestor_id is not None:
                if ancestor_id == folder_id:
                    raise HTTPException(status_code=400, detail="폴더를 자기 하위 폴더로 이동할 수 없습니다.")
                if ancestor_id in seen:
                    break  # pre-existing cycle; don't spin on it
                seen.add(ancestor_id)
                ancestor = await db.get(Folder, ancestor_id)
                if not ancestor:
                    break
                ancestor_id = ancestor.parent_id

            # The destination has to accept it as well; the check above only
            # covered taking it out of where it was.
            await access_service.require_write_at(db, current_user, folder.workspace_id, req.parent_id)
            folder.parent_id = req.parent_id
    if req.icon is not None:
        folder.icon = req.icon
    if req.color is not None:
        folder.color = req.color

    await db.commit()
    await db.refresh(folder)

    count_res = await db.execute(select(func.count(FileItem.id)).where(and_(FileItem.folder_id == folder.id, FileItem.is_trashed == False)))
    file_count = count_res.scalar_one_or_none() or 0

    resp = FolderResponse.model_validate(folder)
    resp.file_count = file_count
    return resp


@router.put("/{folder_id}/rename", response_model=FolderResponse)
async def rename_folder(
    folder_id: uuid.UUID,
    req: FileRenameRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Rename a folder."""
    folder = await db.get(Folder, folder_id)
    if not folder or folder.is_trashed:
        raise HTTPException(status_code=404, detail="Folder not found")
    await access_service.require_write_at(db, current_user, folder.workspace_id, folder.parent_id or folder.id)

    if not await access_service.can_access_folder(db, current_user, folder_id):
        raise HTTPException(status_code=403, detail="폴더명을 변경할 권한이 없습니다.")

    folder.name = req.name.strip()
    await db.commit()
    await db.refresh(folder)

    count_res = await db.execute(select(func.count(FileItem.id)).where(and_(FileItem.folder_id == folder.id, FileItem.is_trashed == False)))
    file_count = count_res.scalar_one_or_none() or 0

    resp = FolderResponse.model_validate(folder)
    resp.file_count = file_count
    return resp


@router.put("/{folder_id}/trash", response_model=FolderResponse)
async def trash_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Move folder and all its contents recursively to trash."""
    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await access_service.require_write_at(db, current_user, folder.workspace_id, folder.parent_id or folder.id)

    if not await access_service.can_access_folder(db, current_user, folder_id):
        raise HTTPException(status_code=403, detail="폴더를 삭제할 권한이 없습니다.")

    await _set_folder_trash_recursive(db, folder, is_trashed=True, trashed_at=datetime.now(timezone.utc))
    await db.commit()
    await db.refresh(folder)

    resp = FolderResponse.model_validate(folder)
    resp.file_count = 0
    return resp


@router.put("/{folder_id}/restore", response_model=FolderResponse)
async def restore_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Restore folder and all its contents recursively from trash."""
    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await access_service.require_write_at(db, current_user, folder.workspace_id, folder.parent_id or folder.id)

    if not await access_service.can_access_folder(db, current_user, folder_id):
        raise HTTPException(status_code=403, detail="폴더를 복구할 권한이 없습니다.")

    # If parent folder is still trashed, detach parent_id to restore to root
    if folder.parent_id:
        parent = await db.get(Folder, folder.parent_id)
        if parent and parent.is_trashed:
            folder.parent_id = None

    await _set_folder_trash_recursive(db, folder, is_trashed=False, trashed_at=None)
    await db.commit()
    await db.refresh(folder)

    count_res = await db.execute(select(func.count(FileItem.id)).where(and_(FileItem.folder_id == folder.id, FileItem.is_trashed == False)))
    file_count = count_res.scalar_one_or_none() or 0

    resp = FolderResponse.model_validate(folder)
    resp.file_count = file_count
    return resp


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: uuid.UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Permanent delete: Delete a folder, its subfolders, and all associated MinIO files and thumbnails."""
    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await access_service.require_write_at(db, current_user, folder.workspace_id, folder.parent_id or folder.id)

    if not await access_service.can_access_folder(db, current_user, folder_id):
        raise HTTPException(status_code=403, detail="폴더를 삭제할 권한이 없습니다.")

    # Find all files in this folder and clean up S3 objects and thumbnails
    files_res = await db.execute(select(FileItem).where(FileItem.folder_id == folder_id))
    files_to_delete = files_res.scalars().all()
    for f in files_to_delete:
        if f.s3_key:
            try:
                await run_in_threadpool(s3_service.delete_object, f.s3_key)
            except Exception as e:
                print(f"[MinIO Warning] Could not delete S3 object {f.s3_key}: {e}")
        if f.thumbnail_s3_key:
            try:
                await run_in_threadpool(s3_service.delete_object, f.thumbnail_s3_key)
            except Exception as e:
                print(f"[MinIO Warning] Could not delete thumbnail S3 object {f.thumbnail_s3_key}: {e}")

        # Reclaim quota from workspace owner
        await quota_service.record_storage_freed(
            db=db,
            workspace_id=f.workspace_id,
            creator_id=f.created_by,
            bytes_freed=f.size_bytes or 0
        )

    await db.delete(folder)
    await db.commit()
    return None


folder_creation_lock = asyncio.Lock()

@router.post("/ensure-path", response_model=EnsurePathResponse)
async def ensure_folder_path(
    req: EnsurePathRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Ensure all folders along relative_path exist in workspace.
    Creates missing parent/child folders recursively and returns the target folder ID.
    Thread-safe and atomic with asyncio lock to prevent race conditions during parallel uploads.
    """
    if not await access_service.is_workspace_member(db, current_user, req.workspace_id):
        raise HTTPException(status_code=403, detail="워크스페이스에 접근할 권한이 없습니다.")

    clean_path = req.relative_path.strip().replace('\\', '/')
    await access_service.require_write_at(db, current_user, req.workspace_id, req.parent_id)
    parts = [p.strip() for p in clean_path.split('/') if p.strip()]

    if not parts:
        folder_name = ""
        if req.parent_id:
            parent_folder = await db.get(Folder, req.parent_id)
            if parent_folder:
                folder_name = parent_folder.name
        return EnsurePathResponse(
            folder_id=req.parent_id,
            folder_name=folder_name,
            relative_path=""
        )

    async with folder_creation_lock:
        current_parent_id = req.parent_id
        last_folder = None

        for part in parts:
            # Check if folder exists under current_parent_id
            q = select(Folder).where(
                and_(
                    Folder.workspace_id == req.workspace_id,
                    Folder.name == part,
                    Folder.parent_id == current_parent_id,
                    Folder.is_trashed == False
                )
            ).order_by(Folder.created_at.asc())
            res = await db.execute(q)
            existing = res.scalars().first()

            if existing:
                current_parent_id = existing.id
                last_folder = existing
            else:
                # Create new folder
                new_folder = Folder(
                    name=part,
                    workspace_id=req.workspace_id,
                    parent_id=current_parent_id,
                    created_by=current_user.id
                )
                db.add(new_folder)
                await db.commit()
                await db.refresh(new_folder)
                current_parent_id = new_folder.id
                last_folder = new_folder

        return EnsurePathResponse(
            folder_id=last_folder.id if last_folder else None,
            folder_name=last_folder.name if last_folder else parts[-1],
            relative_path=clean_path
        )


async def _collect_folder_files_recursive(
    db: AsyncSession,
    folder_id: uuid.UUID,
    current_path: str = ""
) -> List[tuple[FileItem, str]]:
    """Recursively collect (FileItem, relative_archive_path) for all files in folder and subfolders."""
    items = []
    
    # 1. Direct files in this folder
    files_res = await db.execute(
        select(FileItem).where(
            and_(FileItem.folder_id == folder_id, FileItem.is_trashed == False)
        )
    )
    for f in files_res.scalars().all():
        archive_path = f"{current_path}/{f.name}" if current_path else f.name
        items.append((f, archive_path))
    
    # 2. Subfolders
    folders_res = await db.execute(
        select(Folder).where(
            and_(Folder.parent_id == folder_id, Folder.is_trashed == False)
        )
    )
    for sub in folders_res.scalars().all():
        sub_path = f"{current_path}/{sub.name}" if current_path else sub.name
        sub_items = await _collect_folder_files_recursive(db, sub.id, sub_path)
        items.extend(sub_items)
        
    return items


@router.get("/{folder_id}/download")
async def download_folder_zip(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Download an entire folder as a ZIP archive with recursive hierarchy.
    """
    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다.")

    if not await access_service.can_access_folder(db, current_user, folder_id):
        raise HTTPException(status_code=403, detail="폴더를 다운로드할 권한이 없습니다.")

    # Collect all files recursively
    files_with_paths = await _collect_folder_files_recursive(db, folder.id, "")

    total_bytes = sum(f.size_bytes or 0 for f, _ in files_with_paths)
    if total_bytes > settings.MAX_ZIP_DOWNLOAD_BYTES:
        limit_gb = round(settings.MAX_ZIP_DOWNLOAD_BYTES / (1024 ** 3), 1)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"폴더 용량이 ZIP 다운로드 제한({limit_gb}GB)을 초과합니다. 파일을 나눠서 다운로드해주세요."
        )

    # Same-named files are allowed side by side in this app, but a ZIP can't
    # hold two entries at the same path — disambiguate before writing.
    archive_paths = dedupe_archive_paths([f"{folder.name}/{rel_path}" for _, rel_path in files_with_paths])

    entries = []
    if not files_with_paths:
        entries.append((f"{folder.name}/.keep", b"", None))
    for (file_item, _), archive_path in zip(files_with_paths, archive_paths):
        if file_item.is_markdown and file_item.content:
            entries.append((archive_path, file_item.content.encode("utf-8"), None))
        elif file_item.s3_key:
            entries.append((archive_path, None, file_item.s3_key))

    safe_filename = urllib.parse.quote(f"{folder.name}.zip")
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}",
        "Access-Control-Expose-Headers": "Content-Disposition"
    }

    return StreamingResponse(
        stream_zip(entries),
        media_type="application/zip",
        headers=headers
    )





# ---------------------------------------------------------------------------
# Sharing a personal folder
# ---------------------------------------------------------------------------

class GrantRequest(BaseModel):
    email: str


@router.get("/{folder_id}/grants")
async def list_folder_grants(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Who the owner has given write access to inside this folder."""
    from app.services.personal_folder_service import get_owning_personal_folder, list_grants
    personal = await get_owning_personal_folder(db, folder_id)
    if not personal:
        raise HTTPException(status_code=404, detail="개인 폴더를 찾을 수 없습니다.")
    if personal.owner_user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="본인 폴더의 공유 설정만 볼 수 있습니다.")
    return {"folder_id": str(personal.id), "folder_name": personal.name, "grants": await list_grants(db, personal.id)}


@router.post("/{folder_id}/grants")
async def add_folder_grant(
    folder_id: uuid.UUID,
    req: GrantRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Let someone else write inside your folder.

    Granted by the owner rather than by an administrator: the owner is the one
    who knows who should be working on their material, and routing it through
    an administrator would turn collaboration into a request queue.
    """
    from app.models import FolderWriteGrant
    from app.services.personal_folder_service import get_owning_personal_folder

    personal = await get_owning_personal_folder(db, folder_id)
    if not personal:
        raise HTTPException(status_code=404, detail="개인 폴더를 찾을 수 없습니다.")
    if personal.owner_user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="본인 폴더만 공유할 수 있습니다.")

    target = (await db.execute(
        select(User).where(func.lower(User.email) == req.email.strip().lower())
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail=f"'{req.email}' 사용자를 찾을 수 없습니다.")
    if target.is_system:
        raise HTTPException(status_code=400, detail="시스템 계정에는 권한을 줄 수 없습니다.")
    if target.id == personal.owner_user_id:
        raise HTTPException(status_code=400, detail="본인은 이미 이 폴더의 소유자입니다.")

    existing = (await db.execute(
        select(FolderWriteGrant).where(
            FolderWriteGrant.folder_id == personal.id,
            FolderWriteGrant.user_id == target.id,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="이미 권한이 부여된 사용자입니다.")

    db.add(FolderWriteGrant(folder_id=personal.id, user_id=target.id, granted_by=current_user.id))
    await db.commit()
    return {"ok": True, "user": {"id": str(target.id), "name": target.name or target.email}}


@router.delete("/{folder_id}/grants/{user_id}")
async def remove_folder_grant(
    folder_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Withdraw someone's write access to your folder."""
    from app.models import FolderWriteGrant
    from app.services.personal_folder_service import get_owning_personal_folder

    personal = await get_owning_personal_folder(db, folder_id)
    if not personal:
        raise HTTPException(status_code=404, detail="개인 폴더를 찾을 수 없습니다.")
    if personal.owner_user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="본인 폴더만 관리할 수 있습니다.")

    grant = (await db.execute(
        select(FolderWriteGrant).where(
            FolderWriteGrant.folder_id == personal.id,
            FolderWriteGrant.user_id == user_id,
        )
    )).scalar_one_or_none()
    if grant:
        await db.delete(grant)
        await db.commit()
    return {"ok": True}
