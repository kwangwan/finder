import uuid
from typing import Set, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.models import User, Folder, FileItem, Workspace, WorkspaceMember


class AccessService:
    async def get_user_workspace_ids(self, db: AsyncSession, user_id: uuid.UUID) -> Set[uuid.UUID]:
        """Get all workspace IDs where the user is a member (any role)."""
        res = await db.execute(
            select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user_id)
        )
        return {r[0] for r in res.fetchall()}

    async def is_workspace_member(self, db: AsyncSession, user: User, workspace_id: uuid.UUID) -> bool:
        """Check if user is a member of the workspace."""
        if user.is_admin:
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
        return row[0] if row else None

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
