import uuid
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, delete, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import User, Workspace, WorkspaceMember, FileItem
from app.core.security import get_current_approved_user
from app.services.s3_service import s3_service
from app.services.quota_service import quota_service

router = APIRouter(prefix="/api/workspaces", tags=["Workspaces"])


class CreateWorkspaceRequest(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = "briefcase"


class UpdateWorkspaceRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None


class AddMemberRequest(BaseModel):
    email: str
    role: Optional[str] = "member"


class UpdateMemberRoleRequest(BaseModel):
    role: str  # 'admin' or 'member'


def _slugify(name: str, user_id: str) -> str:
    """Generate a URL-friendly slug from workspace name."""
    slug = re.sub(r'[^\w\s-]', '', name.lower().strip())
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = slug[:60] if slug else "workspace"
    return f"{slug}-{user_id[:8]}"


async def _get_workspace_with_member_check(
    db: AsyncSession, workspace_id: uuid.UUID, user: User,
    require_role: Optional[List[str]] = None
) -> Workspace:
    """Fetch workspace and verify user membership + optional role check."""
    ws_res = await db.execute(
        select(Workspace).options(
            selectinload(Workspace.owner),
            selectinload(Workspace.members)
        ).where(Workspace.id == workspace_id)
    )
    workspace = ws_res.scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="워크스페이스를 찾을 수 없습니다.")

    # System admin can access anything
    if user.is_admin:
        return workspace

    # Check membership
    member_res = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id
        )
    )
    member = member_res.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    if require_role and member.role not in require_role:
        raise HTTPException(status_code=403, detail="이 작업을 수행할 권한이 없습니다.")

    return workspace


# ─── Workspace CRUD ─────────────────────────────────────

@router.get("")
async def list_my_workspaces(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """List all workspaces the current user owns or is a member of."""
    # 1. Auto-resolve any pending invitations matching user email
    from app.models import Invitation
    inv_res = await db.execute(
        select(Invitation).where(
            func.lower(Invitation.email) == current_user.email.lower().strip(),
            Invitation.status == "pending"
        )
    )
    pending_invs = inv_res.scalars().all()
    changed = False
    for inv in pending_invs:
        if not inv.is_expired and inv.workspace_id:
            m_res = await db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == inv.workspace_id,
                    WorkspaceMember.user_id == current_user.id
                )
            )
            if not m_res.scalar_one_or_none():
                new_m = WorkspaceMember(
                    workspace_id=inv.workspace_id,
                    user_id=current_user.id,
                    role=inv.role or "member"
                )
                db.add(new_m)
                changed = True
        inv.status = "accepted"
        changed = True
    
    if changed:
        await db.commit()

    # 2. Query all workspaces user belongs to
    stmt = select(Workspace).options(
        selectinload(Workspace.owner),
        selectinload(Workspace.members)
    ).join(WorkspaceMember, Workspace.id == WorkspaceMember.workspace_id).where(
        WorkspaceMember.user_id == current_user.id
    ).order_by(Workspace.name)

    res = await db.execute(stmt)
    workspaces = res.scalars().unique().all()
    return [ws.to_dict(current_user_id=current_user.id) for ws in workspaces]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    req: CreateWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Create a new workspace with the current user as owner."""
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="워크스페이스 이름을 입력해주세요.")

    slug = _slugify(name, str(current_user.id))

    # Check slug uniqueness; if collision, append random suffix
    existing = await db.execute(select(Workspace).where(Workspace.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    workspace = Workspace(
        name=name,
        description=req.description.strip() if req.description else None,
        slug=slug,
        owner_id=current_user.id,
        icon=req.icon or "briefcase"
    )
    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)

    # Add owner as member
    owner_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=current_user.id,
        role="owner"
    )
    db.add(owner_member)
    await db.commit()

    # Re-fetch with relations
    refreshed = await db.execute(
        select(Workspace).options(
            selectinload(Workspace.owner),
            selectinload(Workspace.members)
        ).where(Workspace.id == workspace.id)
    )
    return refreshed.scalar_one().to_dict()


@router.get("/{workspace_id}")
async def get_workspace(
    workspace_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Get workspace details."""
    workspace = await _get_workspace_with_member_check(db, workspace_id, current_user)
    return workspace.to_dict()


@router.put("/{workspace_id}")
async def update_workspace(
    workspace_id: uuid.UUID,
    req: UpdateWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Update workspace settings (owner/admin only)."""
    workspace = await _get_workspace_with_member_check(
        db, workspace_id, current_user, require_role=["owner", "admin"]
    )

    if req.name is not None:
        workspace.name = req.name.strip()
    if req.description is not None:
        workspace.description = req.description.strip() if req.description else None
    if req.icon is not None:
        workspace.icon = req.icon

    await db.commit()

    # Re-fetch
    refreshed = await db.execute(
        select(Workspace).options(
            selectinload(Workspace.owner),
            selectinload(Workspace.members)
        ).where(Workspace.id == workspace_id)
    )
    return refreshed.scalar_one().to_dict()


@router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Delete a workspace (owner only). Deletes all folders, files, MinIO objects, thumbnails, and members."""
    workspace = await _get_workspace_with_member_check(
        db, workspace_id, current_user, require_role=["owner"]
    )

    # Find all files in this workspace and clean up S3 objects and thumbnails
    files_res = await db.execute(select(FileItem).where(FileItem.workspace_id == workspace_id))
    files_to_delete = files_res.scalars().all()
    for f in files_to_delete:
        if f.s3_key:
            try:
                s3_service.delete_object(f.s3_key)
            except Exception as e:
                print(f"[MinIO Warning] Could not delete S3 object {f.s3_key}: {e}")
        if f.thumbnail_s3_key:
            try:
                s3_service.delete_object(f.thumbnail_s3_key)
            except Exception as e:
                print(f"[MinIO Warning] Could not delete thumbnail S3 object {f.thumbnail_s3_key}: {e}")

        # Reclaim quota from workspace owner
        await quota_service.record_storage_freed(
            db=db,
            workspace_id=f.workspace_id,
            creator_id=f.created_by,
            bytes_freed=f.size_bytes or 0
        )

    await db.delete(workspace)
    await db.commit()
    return {"status": "success", "message": "워크스페이스가 삭제되었습니다."}


# ─── Member Management ─────────────────────────────────────

@router.get("/{workspace_id}/members")
async def list_workspace_members(
    workspace_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """List all members of a workspace."""
    await _get_workspace_with_member_check(db, workspace_id, current_user)

    members_res = await db.execute(
        select(WorkspaceMember).options(
            selectinload(WorkspaceMember.user)
        ).where(WorkspaceMember.workspace_id == workspace_id)
    )
    members = members_res.scalars().all()
    return [m.to_dict() for m in members]


@router.post("/{workspace_id}/members")
async def invite_member(
    workspace_id: uuid.UUID,
    req: AddMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Invite a registered user to the workspace by email (owner/admin only)."""
    await _get_workspace_with_member_check(
        db, workspace_id, current_user, require_role=["owner", "admin"]
    )

    # Find user by email
    u_res = await db.execute(select(User).where(User.email == req.email.strip().lower()))
    target_user = u_res.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail=f"'{req.email}' 사용자를 찾을 수 없습니다.")

    # Check if already a member
    existing = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == target_user.id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="이미 워크스페이스에 속해있는 사용자입니다.")

    role = req.role if req.role in ("admin", "member") else "member"
    if role == "admin" and not current_user.is_admin and workspace.owner_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="워크스페이스 관리자 권한은 워크스페이스 소유자만 부여할 수 있습니다."
        )

    new_member = WorkspaceMember(
        workspace_id=workspace_id,
        user_id=target_user.id,
        role=role
    )
    db.add(new_member)
    await db.commit()

    refreshed = await db.execute(
        select(WorkspaceMember).options(
            selectinload(WorkspaceMember.user)
        ).where(WorkspaceMember.id == new_member.id)
    )
    return refreshed.scalar_one().to_dict()


@router.put("/{workspace_id}/members/{user_id}")
async def update_member_role(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    req: UpdateMemberRoleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Change a member's role (owner only)."""
    workspace = await _get_workspace_with_member_check(
        db, workspace_id, current_user, require_role=["owner"]
    )

    if workspace.owner_id == user_id:
        raise HTTPException(status_code=400, detail="워크스페이스 소유자의 역할은 변경할 수 없습니다.")

    if req.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="역할은 'admin' 또는 'member'만 가능합니다.")

    m_res = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id
        )
    )
    member = m_res.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="해당 멤버를 찾을 수 없습니다.")

    member.role = req.role
    await db.commit()

    refreshed = await db.execute(
        select(WorkspaceMember).options(
            selectinload(WorkspaceMember.user)
        ).where(WorkspaceMember.id == member.id)
    )
    return refreshed.scalar_one().to_dict()


@router.delete("/{workspace_id}/members/{user_id}")
async def remove_member(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Remove a member from workspace or leave workspace."""
    workspace = await _get_workspace_with_member_check(db, workspace_id, current_user)

    is_self = current_user.id == user_id

    # Owner can remove anyone; admin can remove members; users can leave
    if not is_self:
        # Need owner/admin role to remove others
        m_res = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == current_user.id
            )
        )
        actor_member = m_res.scalar_one_or_none()
        if not actor_member or actor_member.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="멤버를 제거할 권한이 없습니다.")

    if workspace.owner_id == user_id:
        raise HTTPException(status_code=400, detail="워크스페이스 소유자는 탈퇴할 수 없습니다. 워크스페이스를 삭제해주세요.")

    await db.execute(
        delete(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id
        )
    )
    await db.commit()
    return {"status": "success", "message": "멤버가 제거되었습니다."}
