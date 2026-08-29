import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_, func

from app.core.database import get_db
from app.models.user import User
from app.models import CopyJob
from app.schemas.auth import UserResponse, UserApproveRequest, UserAdminRequest, UserQuotaRequest
from app.core.security import get_current_admin_user
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/admin", tags=["Admin User Management"])

@router.get("/users", response_model=List[UserResponse])
async def list_all_users(
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """List all registered users (Admin only). The shared workspace's storage
    account is not a person and is excluded."""
    res = await db.execute(
        select(User).where(User.is_system == False).order_by(desc(User.created_at))  # noqa: E712
    )
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

    # Clean up MinIO S3 objects for files in workspaces owned by this user.
    # (Deleting the user below cascades to owned workspaces/files at the DB level,
    # so their S3 objects must be cleaned up here first or they're orphaned forever.)
    owned_ws_res = await db.execute(select(Workspace.id).where(Workspace.owner_id == user_id))
    owned_ws_ids = owned_ws_res.scalars().all()
    if owned_ws_ids:
        files_res = await db.execute(select(FileItem).where(FileItem.workspace_id.in_(owned_ws_ids)))
        for f in files_res.scalars().all():
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


@router.get("/copy-jobs")
async def list_all_copy_jobs(
    limit: int = 100,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Every user's copy/move jobs, newest first.

    The per-user banner only surfaces what is running or just finished, which
    is the right scope while working but no help afterwards — after a large
    migration between workspaces someone has to be able to confirm what
    actually ran, by whom, and whether any of it failed.
    """
    limit = max(1, min(limit, 500))
    jobs = (await db.execute(
        select(CopyJob).order_by(desc(CopyJob.created_at)).limit(limit)
    )).scalars().all()

    user_ids = {j.user_id for j in jobs if j.user_id}
    ws_ids = {j.source_workspace_id for j in jobs} | {j.target_workspace_id for j in jobs}
    ws_ids.discard(None)

    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()} if user_ids else {}
    spaces = {w.id: w.name for w in (await db.execute(select(Workspace).where(Workspace.id.in_(ws_ids)))).scalars().all()} if ws_ids else {}

    def row(j):
        u = users.get(j.user_id)
        return {
            "id": str(j.id),
            "status": j.status,
            "summary": j.summary,
            "is_move": bool(j.trash_source),
            "user_email": u.email if u else None,
            "user_name": (u.name or u.email.split("@")[0]) if u else None,
            "source_workspace": spaces.get(j.source_workspace_id),
            "target_workspace": spaces.get(j.target_workspace_id),
            "cross_workspace": j.source_workspace_id != j.target_workspace_id,
            "total_files": j.total_files,
            "copied_files": j.copied_files,
            "copied_folders": j.copied_folders,
            "copied_bytes": j.copied_bytes,
            "skipped": j.skipped,
            "trashed_files": j.trashed_files,
            "error_message": j.error_message,
            "created_at": j.created_at,
            "finished_at": j.finished_at,
        }

    return {"jobs": [row(j) for j in jobs]}


@router.get("/shared-workspace")
async def get_shared_workspace_info(
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """
    The shared workspace and the storage pool behind it.

    That pool is deliberately not any person's: the space exists precisely for
    users the administrator has not granted personal storage to, so charging it
    to an individual would defeat the purpose. It is held by a system account
    that cannot log in and is hidden from the user list.
    """
    from app.services.shared_workspace_service import ensure_shared_workspace, get_quota_account
    ws = await ensure_shared_workspace(db)
    account = await get_quota_account(db)

    from app.models import FileItem
    file_count = (await db.execute(
        select(func.count(FileItem.id)).where(
            FileItem.workspace_id == ws.id, FileItem.is_trashed == False  # noqa: E712
        )
    )).scalar_one() or 0

    return {
        "workspace": {"id": str(ws.id), "name": ws.name, "description": ws.description},
        "file_count": file_count,
        "storage_used_bytes": account.storage_used_bytes if account else 0,
        "storage_quota_bytes": account.storage_quota_bytes if account else 0,
        "storage_reserved_bytes": account.storage_reserved_bytes if account else 0,
    }


class SharedQuotaRequest(BaseModel):
    storage_quota_bytes: int = Field(..., ge=0)


@router.put("/shared-workspace/quota")
async def set_shared_workspace_quota(
    req: SharedQuotaRequest,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """Resize the shared workspace's storage pool."""
    from app.services.shared_workspace_service import ensure_shared_workspace, get_quota_account
    await ensure_shared_workspace(db)
    account = await get_quota_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="공용 워크스페이스 저장소 계정을 찾을 수 없습니다.")
    account.storage_quota_bytes = req.storage_quota_bytes
    await db.commit()
    return {"storage_quota_bytes": account.storage_quota_bytes}


class SharedWriteRequest(BaseModel):
    can_write_shared: bool


@router.put("/users/{user_id}/shared-write")
async def set_user_shared_write(
    user_id: uuid.UUID,
    req: SharedWriteRequest,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Grant or withdraw a user's write access to the shared workspace.

    Withdrawing leaves them able to open and read everything there. That is the
    intended way to deal with misuse: for a user with no storage of their own
    the shared space is their whole account, so removing them from it would
    remove their access to the product entirely.
    """
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    if target.is_system:
        raise HTTPException(status_code=400, detail="시스템 계정은 변경할 수 없습니다.")
    target.can_write_shared = req.can_write_shared
    await db.commit()
    return {"id": str(target.id), "can_write_shared": target.can_write_shared}


@router.get("/shared-policy")
async def get_shared_policy(
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """The shared workspace's rules, with today's usage for context."""
    from app.services import shared_policy_service as policy
    from app.models import SharedDailyUsage
    from datetime import datetime, timezone

    values = await policy.get_all_settings(db)
    today = datetime.now(timezone.utc).date()
    rows = (await db.execute(
        select(SharedDailyUsage, User)
        .join(User, User.id == SharedDailyUsage.user_id)
        .where(SharedDailyUsage.usage_date == today)
        .order_by(desc(SharedDailyUsage.bytes_used))
        .limit(10)
    )).all()
    return {
        "settings": values,
        "today": [
            {"user_name": u.name or u.email, "bytes_used": r.bytes_used}
            for r, u in rows
        ],
    }


class SharedPolicyRequest(BaseModel):
    daily_limit_bytes: Optional[int] = Field(None, ge=0)
    max_file_bytes: Optional[int] = Field(None, ge=0)
    blocked_extensions: Optional[List[str]] = None
    new_account_days: Optional[int] = Field(None, ge=0, le=365)
    new_account_daily_limit_bytes: Optional[int] = Field(None, ge=0)
    alert_threshold_percent: Optional[int] = Field(None, ge=1, le=100)


@router.put("/shared-policy")
async def update_shared_policy(
    req: SharedPolicyRequest,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    from app.services import shared_policy_service as policy
    mapping = {
        "shared.daily_limit_bytes": req.daily_limit_bytes,
        "shared.max_file_bytes": req.max_file_bytes,
        "shared.blocked_extensions": req.blocked_extensions,
        "shared.new_account_days": req.new_account_days,
        "shared.new_account_daily_limit_bytes": req.new_account_daily_limit_bytes,
        "shared.alert_threshold_percent": req.alert_threshold_percent,
    }
    for key, value in mapping.items():
        if value is not None:
            if key == "shared.blocked_extensions":
                value = sorted({str(v).strip().lower().lstrip(".") for v in value if str(v).strip()})
            await policy.set_setting(db, key, value)
    # Raising the threshold should let a pool that is already above the old one
    # warn again, rather than staying silent because it once did.
    await policy.set_setting(db, "shared.alert_last_level", 0)
    return await policy.get_all_settings(db)
