import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import UserResponse, UserApproveRequest, UserAdminRequest, UserQuotaRequest
from app.core.security import get_current_admin_user

router = APIRouter(prefix="/api/admin", tags=["Admin User Management"])

@router.get("/users", response_model=List[UserResponse])
async def list_all_users(
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """List all registered users (Admin only)."""
    res = await db.execute(select(User).order_by(desc(User.created_at)))
    users = res.scalars().all()
    return users

@router.put("/users/{user_id}/approve", response_model=UserResponse)
async def update_user_approval(
    user_id: uuid.UUID,
    req: UserApproveRequest,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """Approve or revoke user access (Admin only)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_approved = req.is_approved
    await db.commit()
    await db.refresh(user)
    return user

@router.put("/users/{user_id}/admin", response_model=UserResponse)
async def update_user_admin_status(
    user_id: uuid.UUID,
    req: UserAdminRequest,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """Grant or revoke admin privileges (Admin only)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == admin_user.id and not req.is_admin:
        raise HTTPException(status_code=400, detail="Cannot revoke your own admin rights")

    user.is_admin = req.is_admin
    # If made admin, also ensure is_approved is True
    if req.is_admin:
        user.is_approved = True

    await db.commit()
    await db.refresh(user)
    return user

from app.models.workspace import Workspace
from app.models.file import FileItem
from app.services.s3_service import s3_service

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete a user account (Admin only). Cascades DB records and purges MinIO files in user's owned workspaces."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    # Clean up MinIO S3 objects for files in workspaces owned by this user
    owned_ws_res = await db.execute(select(Workspace.id).where(Workspace.owner_id == user_id))
    owned_ws_ids = owned_ws_res.scalars().all()
    if owned_ws_ids:
        files_res = await db.execute(select(FileItem).where(FileItem.workspace_id.in_(owned_ws_ids)))
        for f in files_res.scalars().all():
            if f.s3_key:
                s3_service.delete_file(f.s3_key)
            if f.thumbnail_s3_key:
                s3_service.delete_file(f.thumbnail_s3_key)

    await db.delete(user)
    await db.commit()
    return None

@router.put("/users/{user_id}/quota", response_model=UserResponse)
async def update_user_storage_quota(
    user_id: uuid.UUID,
    req: UserQuotaRequest,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """Set storage quota for a specific user (Admin only). Value is in bytes."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.storage_quota_bytes = req.storage_quota_bytes
    await db.commit()
    await db.refresh(user)
    return user
