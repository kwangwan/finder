import uuid
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models import User, Workspace, FileItem


class QuotaService:
    async def get_quota_owner(
        self,
        db: AsyncSession,
        workspace_id: Optional[uuid.UUID],
        default_user: User
    ) -> User:
        """
        Return the User who owns the workspace (and thus provides the storage quota).
        If no workspace is specified, falls back to the default_user (the uploader).
        """
        if workspace_id:
            ws = await db.get(Workspace, workspace_id)
            if ws and ws.owner_id:
                if default_user and default_user.id == ws.owner_id:
                    return default_user
                owner = await db.get(User, ws.owner_id)
                if owner:
                    return owner
        return default_user

    async def check_quota(
        self,
        db: AsyncSession,
        workspace_id: Optional[uuid.UUID],
        user: User,
        additional_bytes: int
    ) -> User:
        """
        Check if the workspace owner has sufficient quota for the incoming upload.
        Raises 413 Payload Too Large if exceeded.
        Returns the workspace owner User.
        """
        owner = await self.get_quota_owner(db, workspace_id, user)
        await db.refresh(owner)

        if additional_bytes > 0 and (owner.storage_used_bytes + additional_bytes > owner.storage_quota_bytes):
            remaining = max(0, owner.storage_quota_bytes - owner.storage_used_bytes)
            remaining_mb = round(remaining / (1024 * 1024), 1)
            ws_str = "워크스페이스" if workspace_id else "개인 저장소"
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"{ws_str} 저장 용량을 초과했습니다. 남은 용량: {remaining_mb}MB. 워크스페이스 관리자에게 용량 증설을 요청하세요."
            )
        return owner

    async def record_storage_added(
        self,
        db: AsyncSession,
        workspace_id: Optional[uuid.UUID],
        user: User,
        bytes_added: int
    ) -> None:
        """Add storage usage to the workspace owner."""
        if bytes_added <= 0:
            return
        owner = await self.get_quota_owner(db, workspace_id, user)
        owner.storage_used_bytes += bytes_added
        await db.commit()

    async def record_storage_freed(
        self,
        db: AsyncSession,
        workspace_id: Optional[uuid.UUID],
        creator_id: Optional[uuid.UUID],
        bytes_freed: int
    ) -> None:
        """Deduct storage usage from the workspace owner (or file creator for legacy files)."""
        if bytes_freed <= 0:
            return
        owner_id = None
        if workspace_id:
            ws = await db.get(Workspace, workspace_id)
            if ws and ws.owner_id:
                owner_id = ws.owner_id
        if not owner_id:
            owner_id = creator_id

        if owner_id:
            owner = await db.get(User, owner_id)
            if owner:
                owner.storage_used_bytes = max(0, owner.storage_used_bytes - bytes_freed)
                await db.commit()

    async def sync_all_users_storage(self, db: AsyncSession) -> None:
        """
        Recalculate exact total storage used for all users based on active files
        in the workspaces they own.
        """
        # Fetch all users
        users_res = await db.execute(select(User))
        users = users_res.scalars().all()

        for u in users:
            # 1. Sum files in workspaces owned by this user
            ws_owned_stmt = (
                select(func.coalesce(func.sum(FileItem.size_bytes), 0))
                .join(Workspace, FileItem.workspace_id == Workspace.id)
                .where(
                    and_(
                        Workspace.owner_id == u.id,
                        FileItem.is_trashed == False
                    )
                )
            )
            ws_bytes = (await db.execute(ws_owned_stmt)).scalar_one()

            # 2. Sum legacy files without workspace created by this user
            legacy_stmt = (
                select(func.coalesce(func.sum(FileItem.size_bytes), 0))
                .where(
                    and_(
                        FileItem.workspace_id.is_(None),
                        FileItem.created_by == u.id,
                        FileItem.is_trashed == False
                    )
                )
            )
            legacy_bytes = (await db.execute(legacy_stmt)).scalar_one()

            u.storage_used_bytes = ws_bytes + legacy_bytes

        await db.commit()


quota_service = QuotaService()
