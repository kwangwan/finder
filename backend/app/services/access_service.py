import uuid
from typing import Set, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.models import User, Folder, FileItem, Workspace, WorkspaceMember


class AccessService:
    async def get_shared_workspace_ids(self, db: AsyncSession) -> Set[uuid.UUID]:
        """
        The organisation-wide workspace(s) every approved user may use.

        Membership there is implicit — a row per user would have to be written
        at signup and backfilled for everyone who joined earlier, and any miss
        would silently lock someone out of the one space they are meant to
        have. Deriving it from the flag cannot drift.
        """
        res = await db.execute(select(Workspace.id).where(Workspace.is_shared == True))  # noqa: E712
        return {r[0] for r in res.fetchall()}

    async def get_user_workspace_ids(self, db: AsyncSession, user_id: uuid.UUID) -> Set[uuid.UUID]:
        """Get all workspace IDs the user can reach (membership + shared)."""
        res = await db.execute(
            select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user_id)
        )
        ids = {r[0] for r in res.fetchall()}
        ids |= await self.get_shared_workspace_ids(db)
        return ids

    async def is_workspace_member(self, db: AsyncSession, user: User, workspace_id: uuid.UUID) -> bool:
        """Check if user is a member of the workspace."""
        if user.is_admin:
            return True
        ws = await db.get(Workspace, workspace_id)
        if ws is not None and ws.is_shared:
            return True
        res = await db.execute(
            select(WorkspaceMember.id).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user.id
            )
        )
        return res.scalar_one_or_none() is not None

    async def get_workspace_role(self, db: AsyncSession, user: User, workspace_id: uuid.UUID) -> Optional[str]:
        """Get user's role in the workspace, or None if not a member."""
        if user.is_admin:
            return "admin"
        res = await db.execute(
            select(WorkspaceMember.role).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user.id
            )
        )
        row = res.first()
        if row:
            return row[0]
        # Everyone is a plain member of the shared workspace — deliberately not
        # an admin of it, so managing it stays with administrators.
        ws = await db.get(Workspace, workspace_id)
        if ws is not None and ws.is_shared:
            return "member"
        return None

    async def can_write_workspace(self, db: AsyncSession, user: User, workspace_id: Optional[uuid.UUID]) -> bool:
        """
        Whether the user may change anything in this workspace.

        Only the shared workspace distinguishes reading from writing. Access
        there is managed by taking write away, not by removing the person:
        for a user with no storage of their own it is the only space they
        have, so ejecting them would take away their whole account.
        """
        if user.is_admin:
            return True
        if not workspace_id:
            return True
        ws = await db.get(Workspace, workspace_id)
        if ws is not None and ws.is_shared:
            return bool(getattr(user, "can_write_shared", True))
        return True

    async def require_write(self, db: AsyncSession, user: User, workspace_id: Optional[uuid.UUID]) -> None:
        """Raise 403 when the user may read this workspace but not change it."""
        if not await self.can_write_workspace(db, user, workspace_id):
            from fastapi import HTTPException
            raise HTTPException(
                status_code=403,
                detail="공용 워크스페이스에 대한 쓰기 권한이 없습니다. 관리자에게 문의하세요."
            )

    async def is_workspace_admin_or_owner(self, db: AsyncSession, user: User, workspace_id: uuid.UUID) -> bool:
        """Check if user is a workspace owner or admin (or superadmin)."""
        if user.is_admin:
            return True
        ws = await db.get(Workspace, workspace_id)
        if ws and ws.owner_id == user.id:
            return True
        role = await self.get_workspace_role(db, user, workspace_id)
        return role in ("owner", "admin")

    async def can_access_file(self, db: AsyncSession, user: User, file_id: uuid.UUID) -> bool:
        """Check if user can access the file via workspace membership."""
        if user.is_admin:
            return True
        file_item = await db.get(FileItem, file_id)
        if not file_item:
            return False
        if not file_item.workspace_id:
            # Legacy file without workspace — allow if user created it
            return file_item.created_by == user.id
        return await self.is_workspace_member(db, user, file_item.workspace_id)

    async def can_access_folder(self, db: AsyncSession, user: User, folder_id: uuid.UUID) -> bool:
        """Check if user can access the folder via workspace membership."""
        if user.is_admin:
            return True
        folder = await db.get(Folder, folder_id)
        if not folder:
            return False
        if not folder.workspace_id:
            return folder.created_by == user.id
        return await self.is_workspace_member(db, user, folder.workspace_id)


access_service = AccessService()
