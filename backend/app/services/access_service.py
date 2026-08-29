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

    async def can_write_at(
        self,
        db: AsyncSession,
        user: User,
        workspace_id: Optional[uuid.UUID],
        folder_id: Optional[uuid.UUID],
    ) -> bool:
        """Boolean form of require_write_at, for loops that skip rather than fail."""
        try:
            await self.require_write_at(db, user, workspace_id, folder_id)
            return True
        except Exception:
            return False

    async def require_write_at(
        self,
        db: AsyncSession,
        user: User,
        workspace_id: Optional[uuid.UUID],
        folder_id: Optional[uuid.UUID],
    ) -> None:
        """
        The location-aware check for the shared workspace.

        Beyond "may this user write here at all", it asks "may they write *at
        this spot*": the root belongs to nobody and everything else belongs to
        one person's folder. Outside the shared workspace this is exactly the
        old workspace-level check.
        """
        await self.require_write(db, user, workspace_id)
        if user.is_admin or not workspace_id:
            return

        ws = await db.get(Workspace, workspace_id)
        if ws is None or not ws.is_shared:
            return

        from fastapi import HTTPException
        from app.services.personal_folder_service import can_write_in_folder

        if folder_id is None:
            raise HTTPException(
                status_code=403,
                detail="공용 워크스페이스의 홈에는 파일이나 폴더를 둘 수 없습니다. 본인 폴더 안에서 작업해 주세요."
            )
        if not await can_write_in_folder(db, user, folder_id):
            raise HTTPException(
                status_code=403,
                detail="이 폴더에 대한 쓰기 권한이 없습니다. 본인 폴더이거나 권한을 받은 폴더에서만 작업할 수 있습니다."
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

    async def _is_shared_workspace(self, db: AsyncSession, workspace_id) -> bool:
        if not workspace_id:
            return False
        ws = await db.get(Workspace, workspace_id)
        return bool(ws and ws.is_shared)

    async def can_access_file(self, db: AsyncSession, user: User, file_id: uuid.UUID) -> bool:
        """Check if user can access the file via workspace membership."""
        if user.is_admin:
            return True
        file_item = await db.get(FileItem, file_id)
        if not file_item:
            return False

        # In the shared workspace, something in the trash is often there
        # precisely because it should not have been shared — removed by an
        # administrator, or by the uploader thinking better of it. Membership
        # is enough to reach a live file there, but not one that has been taken
        # down: only whoever uploaded it (so they can undo their own mistake)
        # and administrators can still see it.
        #
        # Scoped to the shared workspace on purpose. A private or team
        # workspace has a chosen set of members who already see each other's
        # work, and hiding a teammate's deleted file from them would break
        # recovering it — the exposure this guards against does not exist
        # there.
        if file_item.is_trashed and file_item.created_by != user.id:
            if await self._is_shared_workspace(db, file_item.workspace_id):
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

        # Same rule as a trashed file, and likewise only in the shared
        # workspace: a folder in the trash may hold, or be named, exactly what
        # was taken down.
        if folder.is_trashed and folder.created_by != user.id:
            if await self._is_shared_workspace(db, folder.workspace_id):
                return False

        if not folder.workspace_id:
            return folder.created_by == user.id
        return await self.is_workspace_member(db, user, folder.workspace_id)


access_service = AccessService()
