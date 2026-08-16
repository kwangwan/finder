import uuid
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, delete, func

from app.core.database import get_db
from app.models import Folder, FileItem, User, WorkspaceMember
from app.core.security import get_current_approved_user
from app.services.access_service import access_service
from app.services.s3_service import s3_service
from app.services.quota_service import quota_service

router = APIRouter(prefix="/api/trash", tags=["Trash / Recycle Bin"])


class TrashFolderItem(BaseModel):
    id: uuid.UUID
    name: str
    parent_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    color: Optional[str] = None
    trashed_at: Optional[datetime] = None
    days_remaining: int = 30
    file_count: int = 0


class TrashFileItem(BaseModel):
    id: uuid.UUID
    name: str
    folder_id: Optional[uuid.UUID] = None
    folder_name: Optional[str] = None
    workspace_id: Optional[uuid.UUID] = None
    file_type: str
    size_bytes: int
    thumbnail_url: Optional[str] = None
    is_markdown: bool = False
    trashed_at: Optional[datetime] = None
    days_remaining: int = 30


class TrashResponse(BaseModel):
    folders: List[TrashFolderItem]
    files: List[TrashFileItem]
    total_count: int


async def _purge_file(db: AsyncSession, file_item: FileItem):
    """Helper to permanently delete S3 objects and database record for a file."""
    if file_item.s3_key:
        try:
            s3_service.delete_object(file_item.s3_key)
        except Exception as e:
            print(f"[MinIO Warning] Could not delete S3 object {file_item.s3_key}: {e}")

    if file_item.thumbnail_s3_key:
        try:
            s3_service.delete_object(file_item.thumbnail_s3_key)
        except Exception as e:
            print(f"[MinIO Warning] Could not delete thumbnail S3 object {file_item.thumbnail_s3_key}: {e}")

    # Reclaim quota from workspace owner
    await quota_service.record_storage_freed(
        db=db,
        workspace_id=file_item.workspace_id,
        creator_id=file_item.created_by,
        bytes_freed=file_item.size_bytes or 0
    )

    await db.delete(file_item)


async def _purge_folder_recursive(db: AsyncSession, folder: Folder):
    """Helper to permanently delete a folder and all contents recursively."""
    # 1. Purge all files in this folder
    files_res = await db.execute(select(FileItem).where(FileItem.folder_id == folder.id))
    for f in files_res.scalars().all():
        await _purge_file(db, f)

    # 2. Purge child folders
    children_res = await db.execute(select(Folder).where(Folder.parent_id == folder.id))
    for child in children_res.scalars().all():
        await _purge_folder_recursive(db, child)

    await db.delete(folder)


async def _auto_purge_expired(db: AsyncSession):
    """Automatically purge trashed items older than 30 days."""
    cutoff = datetime.utcnow() - timedelta(days=30)
    
    # Purge expired files
    expired_files_res = await db.execute(
        select(FileItem).where(and_(FileItem.is_trashed == True, FileItem.trashed_at < cutoff))
    )
    for f in expired_files_res.scalars().all():
        await _purge_file(db, f)

    # Purge expired folders
    expired_folders_res = await db.execute(
        select(Folder).where(and_(Folder.is_trashed == True, Folder.trashed_at < cutoff))
    )
    for folder in expired_folders_res.scalars().all():
        await _purge_folder_recursive(db, folder)

    await db.commit()


@router.get("", response_model=TrashResponse)
async def get_trash(
    workspace_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Get all trashed items and automatically purge items older than 30 days."""
    # Run 30-day auto-purge
    try:
        await _auto_purge_expired(db)
    except Exception as e:
        print(f"[Trash Auto-Purge Warning] {e}")

    now = datetime.utcnow()
    
    # 1. Query trashed folders
    folder_conditions = [Folder.is_trashed == True]
    file_conditions = [FileItem.is_trashed == True]

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        folder_conditions.append(Folder.workspace_id == workspace_id)
        file_conditions.append(FileItem.workspace_id == workspace_id)
    elif not current_user.is_admin:
        ws_ids = await access_service.get_user_workspace_ids(db, current_user.id)
        if ws_ids:
            folder_conditions.append(or_(
                Folder.workspace_id.in_(list(ws_ids)),
                and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id)
            ))
            file_conditions.append(or_(
                FileItem.workspace_id.in_(list(ws_ids)),
                and_(FileItem.workspace_id.is_(None), FileItem.created_by == current_user.id)
            ))
        else:
            folder_conditions.append(and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id))
            file_conditions.append(and_(FileItem.workspace_id.is_(None), FileItem.created_by == current_user.id))

    # Folders query
    folders_res = await db.execute(
        select(Folder).where(and_(*folder_conditions)).order_by(Folder.trashed_at.desc())
    )
    trashed_folders_raw = folders_res.scalars().all()

    # Only show top-level trashed folders (whose parent is not also trashed in this list)
    trashed_folder_ids = {f.id for f in trashed_folders_raw}
    top_trashed_folders = [f for f in trashed_folders_raw if not (f.parent_id and f.parent_id in trashed_folder_ids)]

    folder_items = []
    for f in top_trashed_folders:
        trashed_time = f.trashed_at or f.updated_at or now
        days_passed = (now - trashed_time).days
        days_rem = max(0, 30 - days_passed)
        
        count_res = await db.execute(select(func.count(FileItem.id)).where(FileItem.folder_id == f.id))
        count = count_res.scalar_one_or_none() or 0

        folder_items.append(TrashFolderItem(
            id=f.id,
            name=f.name,
            parent_id=f.parent_id,
            workspace_id=f.workspace_id,
            color=f.color,
            trashed_at=f.trashed_at,
            days_remaining=days_rem,
            file_count=count
        ))

    # Files query (only show files whose containing folder is NOT in the trashed folders list, to avoid duplicates)
    files_res = await db.execute(
        select(FileItem).where(and_(*file_conditions)).order_by(FileItem.trashed_at.desc())
    )
    trashed_files_raw = files_res.scalars().all()
    top_trashed_files = [f for f in trashed_files_raw if not (f.folder_id and f.folder_id in trashed_folder_ids)]

    file_items = []
    for f in top_trashed_files:
        trashed_time = f.trashed_at or f.updated_at or now
        days_passed = (now - trashed_time).days
        days_rem = max(0, 30 - days_passed)

        folder_name = None
        if f.folder_id:
            folder = await db.get(Folder, f.folder_id)
            if folder:
                folder_name = folder.name

        file_items.append(TrashFileItem(
            id=f.id,
            name=f.name,
            folder_id=f.folder_id,
            folder_name=folder_name,
            workspace_id=f.workspace_id,
            file_type=f.file_type,
            size_bytes=f.size_bytes,
            thumbnail_url=f"/api/storage/thumbnail/{f.id}" if f.thumbnail_s3_key else None,
            is_markdown=f.is_markdown,
            trashed_at=f.trashed_at,
            days_remaining=days_rem
        ))

    return TrashResponse(
        folders=folder_items,
        files=file_items,
        total_count=len(folder_items) + len(file_items)
    )


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_file_item(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Permanently delete a file from trash."""
    if not await access_service.can_access_file(db, current_user, file_id):
        raise HTTPException(status_code=403, detail="파일을 삭제할 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")

    await _purge_file(db, file_item)
    await db.commit()
    return None


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_folder_item(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Permanently delete a folder and all its contents from trash."""
    if not await access_service.can_access_folder(db, current_user, folder_id):
        raise HTTPException(status_code=403, detail="폴더를 삭제할 권한이 없습니다.")

    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    await _purge_folder_recursive(db, folder)
    await db.commit()
    return None


@router.post("/empty", status_code=status.HTTP_200_OK)
async def empty_trash(
    workspace_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Permanently delete all accessible trashed files and folders."""
    # Find accessible trashed folders & files
    folder_conditions = [Folder.is_trashed == True]
    file_conditions = [FileItem.is_trashed == True]

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        folder_conditions.append(Folder.workspace_id == workspace_id)
        file_conditions.append(FileItem.workspace_id == workspace_id)
    elif not current_user.is_admin:
        ws_ids = await access_service.get_user_workspace_ids(db, current_user.id)
        if ws_ids:
            folder_conditions.append(or_(
                Folder.workspace_id.in_(list(ws_ids)),
                and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id)
            ))
            file_conditions.append(or_(
                FileItem.workspace_id.in_(list(ws_ids)),
                and_(FileItem.workspace_id.is_(None), FileItem.created_by == current_user.id)
            ))
        else:
            folder_conditions.append(and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id))
            file_conditions.append(and_(FileItem.workspace_id.is_(None), FileItem.created_by == current_user.id))

    # 1. Purge files
    files_res = await db.execute(select(FileItem).where(and_(*file_conditions)))
    for f in files_res.scalars().all():
        await _purge_file(db, f)

    # 2. Purge folders
    folders_res = await db.execute(select(Folder).where(and_(*folder_conditions)))
    for folder in folders_res.scalars().all():
        await _purge_folder_recursive(db, folder)

    await db.commit()
    return {"message": "휴지통이 성공적으로 비워졌습니다."}
