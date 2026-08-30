import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, delete, func, inspect as sql_inspect

from app.core.database import get_db
from app.models import Folder, FileItem, User, WorkspaceMember
from app.models.board import BOARD_FILE_TYPE
from app.core.security import get_current_approved_user
from app.services.access_service import access_service
from app.services import favorite_service
from app.services import board_service
from app.services import link_service
from app.services.s3_service import s3_service
from app.services.quota_service import quota_service
from app.services.deletion_service import deletion_service

router = APIRouter(prefix="/api/trash", tags=["Trash / Recycle Bin"])


class TrashFolderItem(BaseModel):
    id: uuid.UUID
    name: str
    parent_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    created_by: Optional[uuid.UUID] = None
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
    created_by: Optional[uuid.UUID] = None
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
    """Enqueue file for background deletion, reclaim quota, and remove DB record
    immediately. This is the actual permanent-delete choke point every real
    deletion path (manual purge from trash, the 30-day auto-purge) goes
    through — a note's own delete button only soft-trashes it first.
    Files attached to a document are not touched by deleting the document:
    they can be attached to several, and each one is deleted from the folder
    it lives in like any other file."""
    # A board's 할 일 documents are owned by rows that cascade away with it,
    # so they are purged here rather than left behind unreachable.
    for document in await board_service.board_task_documents(db, file_item.id):
        await deletion_service.enqueue_file(db, document)
        await quota_service.record_storage_freed(
            db=db,
            workspace_id=document.workspace_id,
            creator_id=document.created_by,
            bytes_freed=document.size_bytes or 0,
        )
        await favorite_service.drop_favorites(db, favorite_service.FILE, [document.id])
        await db.delete(document)
    await deletion_service.enqueue_file(db, file_item)
    await quota_service.record_storage_freed(
        db=db,
        workspace_id=file_item.workspace_id,
        creator_id=file_item.created_by,
        bytes_freed=file_item.size_bytes or 0
    )
    await favorite_service.drop_favorites(db, favorite_service.FILE, [file_item.id])
    await db.delete(file_item)


async def _purge_folder_recursive(db: AsyncSession, folder: Folder):
    """Recursively enqueue folder contents for background deletion and remove DB records immediately."""
    await deletion_service.enqueue_folder_recursive(db, folder)


async def _auto_purge_expired(db: AsyncSession):
    """Automatically purge trashed items older than 30 days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    
    # Purge expired files
    expired_files_res = await db.execute(
        select(FileItem).where(and_(FileItem.is_trashed == True, FileItem.trashed_at < cutoff))
    )
    expired_files = list(expired_files_res.scalars().all())
    expired_files.sort(key=lambda f: 0 if f.file_type == BOARD_FILE_TYPE else 1)
    for f in expired_files:
        if sql_inspect(f).deleted:
            continue
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

    now = datetime.now(timezone.utc)
    
    # 1. Query trashed folders
    folder_conditions = [Folder.is_trashed == True]
    file_conditions = [FileItem.is_trashed == True]

    # In the shared workspace the trash is per-person. Something in there is
    # often there precisely because it should not have been shared — taken down
    # by an administrator, or by the uploader thinking better of it — so
    # listing it to every member would turn the trash into a gallery of exactly
    # the material that was removed.
    #
    # Only the shared workspace. A private or team workspace has a chosen set
    # of members who already see each other's work, and hiding a teammate's
    # deleted file would break recovering it.
    if not current_user.is_superadmin:
        shared_ids = list(await access_service.get_shared_workspace_ids(db))
        if shared_ids:
            folder_conditions.append(or_(
                Folder.workspace_id.is_(None),
                Folder.workspace_id.notin_(shared_ids),
                Folder.created_by == current_user.id,
            ))
            file_conditions.append(or_(
                FileItem.workspace_id.is_(None),
                FileItem.workspace_id.notin_(shared_ids),
                FileItem.created_by == current_user.id,
            ))

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        folder_conditions.append(Folder.workspace_id == workspace_id)
        file_conditions.append(FileItem.workspace_id == workspace_id)
    elif not current_user.is_superadmin:
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
        
        # Counted the way every other file count is: 할 일 documents are not
        # listed, so they are not part of "how many files are in here".
        count_res = await db.execute(select(func.count(FileItem.id)).where(
            FileItem.folder_id == f.id, link_service.not_task_document(),
        ))
        count = count_res.scalar_one_or_none() or 0

        folder_items.append(TrashFolderItem(
            id=f.id,
            name=f.name,
            parent_id=f.parent_id,
            workspace_id=f.workspace_id,
            created_by=f.created_by,
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

        is_img = f.file_type == 'image' or any(f.name.lower().endswith(ext) for ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.ico'))
        thumb_url = f"/api/storage/thumbnail/{f.id}" if f.thumbnail_s3_key else (f"/api/storage/preview/{f.id}" if is_img else None)

        file_items.append(TrashFileItem(
            id=f.id,
            name=f.name,
            folder_id=f.folder_id,
            folder_name=folder_name,
            workspace_id=f.workspace_id,
            created_by=f.created_by,
            file_type=f.file_type,
            size_bytes=f.size_bytes,
            thumbnail_url=thumb_url,
            is_markdown=f.is_markdown,
            trashed_at=f.trashed_at,
            days_remaining=days_rem
        ))

    return TrashResponse(
        folders=folder_items,
        files=file_items,
        total_count=len(folder_items) + len(file_items)
    )


async def _refuse_if_task_document(db: AsyncSession, file_item: FileItem) -> None:
    """
    A 할 일's document is not separable from the 할 일.

    It reaches the trash only by being carried there by its board, and it
    leaves the same way. Purging or restoring it on its own would leave the
    board holding a row whose document is gone, or a document showing outside
    the board that is still in the trash.
    """
    if await link_service.owning_task(db, file_item.id) is None:
        return
    raise HTTPException(
        status_code=400,
        detail=(
            f"'{file_item.name}'은(는) 일정의 할 일에 연결된 문서입니다. "
            "일정을 복구하거나 영구 삭제하면 함께 처리됩니다."
        ),
    )


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_file_item(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Permanently delete a file from trash (author, workspace owner/admin, or superadmin)."""
    file_item = await db.get(FileItem, file_id)
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")

    is_creator = file_item.created_by == current_user.id
    is_owner_or_admin = False
    if file_item.workspace_id:
        is_owner_or_admin = await access_service.is_workspace_admin_or_owner(db, current_user, file_item.workspace_id)

    if not (is_creator or is_owner_or_admin or current_user.is_superadmin):
        raise HTTPException(
            status_code=403, 
            detail="휴지통의 파일을 영구 삭제할 권한이 없습니다. (작성자 본인 또는 워크스페이스 소유자/관리자만 가능)"
        )

    # Losing write in the shared workspace means losing it over your own
    # uploads too — otherwise a withdrawn account can still empty out the
    # material it left behind.
    await access_service.require_write(db, current_user, file_item.workspace_id)
    await _refuse_if_task_document(db, file_item)
    await _purge_file(db, file_item)
    await db.commit()
    return None


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_folder_item(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Permanently delete a folder and all its contents from trash (author, workspace owner/admin, or superadmin)."""
    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    is_creator = folder.created_by == current_user.id
    is_owner_or_admin = False
    if folder.workspace_id:
        is_owner_or_admin = await access_service.is_workspace_admin_or_owner(db, current_user, folder.workspace_id)

    if not (is_creator or is_owner_or_admin or current_user.is_superadmin):
        raise HTTPException(
            status_code=403, 
            detail="휴지통의 폴더를 영구 삭제할 권한이 없습니다. (작성자 본인 또는 워크스페이스 소유자/관리자만 가능)"
        )

    await access_service.require_write(db, current_user, folder.workspace_id)
    await _purge_folder_recursive(db, folder)
    await db.commit()
    return None


@router.post("/empty", status_code=status.HTTP_200_OK)
async def empty_trash(
    workspace_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Permanently delete all accessible trashed files and folders (workspace owner/admin or superadmin only)."""
    # Find accessible trashed folders & files
    folder_conditions = [Folder.is_trashed == True]
    file_conditions = [FileItem.is_trashed == True]

    if workspace_id:
        if not await access_service.is_workspace_admin_or_owner(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="휴지통 비우기 권한이 없습니다. (워크스페이스 소유자 및 관리자만 비울 수 있습니다)")
        folder_conditions.append(Folder.workspace_id == workspace_id)
        file_conditions.append(FileItem.workspace_id == workspace_id)
    elif not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="휴지통 비우기는 특정 워크스페이스의 소유자/관리자 또는 최고 관리자만 수행할 수 있습니다.")

    # 1. Purge files. Boards first, so each one takes its 할 일 documents with
    #    it; the rest of the sweep then skips anything already gone.
    files_res = await db.execute(select(FileItem).where(and_(*file_conditions)))
    trashed_files = list(files_res.scalars().all())
    trashed_files.sort(key=lambda f: 0 if f.file_type == BOARD_FILE_TYPE else 1)
    for f in trashed_files:
        if sql_inspect(f).deleted:
            continue
        await _purge_file(db, f)

    # 2. Purge folders
    folders_res = await db.execute(select(Folder).where(and_(*folder_conditions)))
    for folder in folders_res.scalars().all():
        await _purge_folder_recursive(db, folder)

    await db.commit()
    return {"message": "휴지통이 성공적으로 비워졌습니다."}
