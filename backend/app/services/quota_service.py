import uuid
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, and_
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
        Counts bytes already reserved by other in-flight uploads (see reserve_quota)
        as spent, so this can't pass while a concurrent large upload is still
        streaming and hasn't hit storage_used_bytes yet.
        Raises 413 Payload Too Large if exceeded.
        Returns the workspace owner User.
        """
        owner = await self.get_quota_owner(db, workspace_id, user)
        await db.refresh(owner)

        committed = owner.storage_used_bytes + owner.storage_reserved_bytes
        if additional_bytes > 0 and (committed + additional_bytes > owner.storage_quota_bytes):
            remaining = max(0, owner.storage_quota_bytes - committed)
            remaining_mb = round(remaining / (1024 * 1024), 1)
            ws_str = "워크스페이스" if workspace_id else "개인 저장소"
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"{ws_str} 저장 용량을 초과했습니다. 남은 용량: {remaining_mb}MB. 워크스페이스 관리자에게 용량 증설을 요청하세요."
            )
        return owner

    async def reserve_quota(
        self,
        db: AsyncSession,
        workspace_id: Optional[uuid.UUID],
        user: User,
        bytes_needed: int
    ) -> User:
        """
        Atomically claim bytes against the workspace owner's quota before a
        long-running upload (e.g. a multipart chunk session) starts streaming.
        Unlike check_quota, this actually reserves the space in the same
        statement it checks it in — via a conditional UPDATE — so two uploads
        starting at nearly the same moment can't both pass the check based on
        the same stale storage_used_bytes and together exceed the quota.
        Raises 413 if there isn't enough headroom. Returns the owner.
        """
        owner = await self.get_quota_owner(db, workspace_id, user)
        if bytes_needed <= 0:
            return owner

        stmt = (
            update(User)
            .where(
                User.id == owner.id,
                (User.storage_used_bytes + User.storage_reserved_bytes + bytes_needed) <= User.storage_quota_bytes,
            )
            .values(storage_reserved_bytes=User.storage_reserved_bytes + bytes_needed)
            .returning(User.id)
        )
        result = await db.execute(stmt)
        claimed = result.first() is not None
        await db.commit()

        if not claimed:
            await db.refresh(owner)
            remaining = max(0, owner.storage_quota_bytes - owner.storage_used_bytes - owner.storage_reserved_bytes)
            remaining_mb = round(remaining / (1024 * 1024), 1)
            ws_str = "워크스페이스" if workspace_id else "개인 저장소"
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"{ws_str} 저장 용량을 초과했습니다. 남은 용량: {remaining_mb}MB. 워크스페이스 관리자에게 용량 증설을 요청하세요."
            )
        return owner

    async def release_reservation(
        self,
        db: AsyncSession,
        owner_id: Optional[uuid.UUID],
        bytes_amount: int
    ) -> None:
        """Give back a reservation made by reserve_quota (upload aborted, failed, or expired)."""
        if not owner_id or bytes_amount <= 0:
            return
        stmt = (
            update(User)
            .where(User.id == owner_id)
            .values(storage_reserved_bytes=func.greatest(0, User.storage_reserved_bytes - bytes_amount))
        )
        await db.execute(stmt)
        await db.commit()

    async def commit_reservation(
        self,
        db: AsyncSession,
        owner_id: Optional[uuid.UUID],
        reserved_bytes: int,
        actual_bytes: int
    ) -> None:
        """Turn a reservation into real usage once the upload has actually
        finished (the object exists in MinIO with a known final size)."""
        if not owner_id:
            return
        stmt = (
            update(User)
            .where(User.id == owner_id)
            .values(
                storage_reserved_bytes=func.greatest(0, User.storage_reserved_bytes - max(0, reserved_bytes)),
                storage_used_bytes=User.storage_used_bytes + max(0, actual_bytes),
            )
        )
        await db.execute(stmt)
        await db.commit()

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

        # Every path that grows storage passes through here, which makes it the
        # one place the shared pool's warning line can be checked without
        # having to remember it at each call site.
        try:
            from app.services.shared_policy_service import is_shared_workspace, check_pool_threshold
            if await is_shared_workspace(db, workspace_id):
                await check_pool_threshold(db)
        except Exception:
            # Alerting must never fail the upload it was watching.
            pass

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
        Recalculate exact total storage used for all users based on files in the
        workspaces they own. Trashed files are included: they still occupy real
        storage until permanently purged, matching record_storage_freed which only
        runs on permanent deletion, not on move-to-trash.
        """
        # Fetch all users
        users_res = await db.execute(select(User))
        users = users_res.scalars().all()

        for u in users:
            # 1. Sum files in workspaces owned by this user
            ws_owned_stmt = (
                select(func.coalesce(func.sum(FileItem.size_bytes), 0))
                .join(Workspace, FileItem.workspace_id == Workspace.id)
                .where(Workspace.owner_id == u.id)
            )
            ws_bytes = (await db.execute(ws_owned_stmt)).scalar_one()

            # 2. Sum legacy files without workspace created by this user
            legacy_stmt = (
                select(func.coalesce(func.sum(FileItem.size_bytes), 0))
                .where(
                    and_(
                        FileItem.workspace_id.is_(None),
                        FileItem.created_by == u.id
                    )
                )
            )
            legacy_bytes = (await db.execute(legacy_stmt)).scalar_one()

            u.storage_used_bytes = ws_bytes + legacy_bytes

        await db.commit()


quota_service = QuotaService()
