import uuid
import secrets
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import User, Workspace, WorkspaceMember, Invitation
from app.schemas.invitation import CreateInvitationRequest, AcceptInvitationRequest, InvitationResponse
from app.schemas.auth import TokenResponse
from app.core.security import get_current_approved_user, get_current_user, create_access_token, hash_password
from app.services.email_service import email_service
from app.routers.auth import ensure_user_default_workspace

router = APIRouter(prefix="/api/invitations", tags=["Invitations"])


@router.get("", response_model=List[InvitationResponse])
async def list_invitations(
    workspace_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    List invitations.
    - Super admins see all or filtered invitations.
    - Workspace owners/admins see their workspace invitations.
    - Regular users see invitations they created.
    """
    stmt = select(Invitation).options(
        selectinload(Invitation.inviter),
        selectinload(Invitation.workspace)
    ).order_by(desc(Invitation.created_at))

    if workspace_id:
        # Check permission for workspace
        if not current_user.is_admin:
            m_res = await db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.user_id == current_user.id
                )
            )
            member = m_res.scalar_one_or_none()
            if not member or member.role not in ("owner", "admin"):
                raise HTTPException(status_code=403, detail="워크스페이스 초대 목록을 볼 권한이 없습니다.")
        stmt = stmt.where(Invitation.workspace_id == workspace_id)
    elif not current_user.is_admin:
        # User only sees invitations they sent
        stmt = stmt.where(Invitation.invited_by == current_user.id)

    res = await db.execute(stmt)
    invitations = res.scalars().all()
    return [inv.to_dict() for inv in invitations]


@router.post("", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    req: CreateInvitationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Create and send a 7-day invitation.
    - If created by super admin -> `is_admin_invite = True` (auto approved upon acceptance).
    - If workspace_id provided -> user is added to workspace upon acceptance.
    """
    email = req.email.strip().lower()
    workspace_name = None

    if req.workspace_id:
        # Verify inviter has admin/owner rights in workspace
        ws_res = await db.execute(select(Workspace).where(Workspace.id == req.workspace_id))
        workspace = ws_res.scalar_one_or_none()
        if not workspace:
            raise HTTPException(status_code=404, detail="워크스페이스를 찾을 수 없습니다.")
        workspace_name = workspace.name

        is_owner = current_user.is_admin or (workspace.owner_id == current_user.id)
        if not is_owner:
            m_res = await db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == req.workspace_id,
                    WorkspaceMember.user_id == current_user.id
                )
            )
            member = m_res.scalar_one_or_none()
            if not member or member.role not in ("owner", "admin"):
                raise HTTPException(status_code=403, detail="이 워크스페이스에 멤버를 초대할 권한이 없습니다. (소유자 및 관리자만 초대 가능)")
        
        # Rule: Only Workspace Owner or Super Admin can grant 'admin' role
        if req.role == "admin" and not is_owner:
            raise HTTPException(status_code=403, detail="워크스페이스 관리자 권한은 워크스페이스 소유자만 부여할 수 있습니다.")
    else:
        # Service-wide invitation only allowed by Super Admin
        if not current_user.is_admin:
            raise HTTPException(status_code=403, detail="서비스 전체 초대는 최고 관리자만 가능합니다.")

    # Check for active pending invitation
    existing_inv = await db.execute(
        select(Invitation).where(
            Invitation.email == email,
            Invitation.workspace_id == req.workspace_id,
            Invitation.status == "pending",
            Invitation.expires_at > datetime.utcnow()
        )
    )
    if existing_inv.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{email}' 주소로 이미 유효한 초대장이 발송되어 있습니다."
        )

    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(days=7)  # 7 days expiration

    invitation = Invitation(
        email=email,
        token=token,
        workspace_id=req.workspace_id,
        role=req.role if req.role in ("admin", "member") else "member",
        invited_by=current_user.id,
        is_admin_invite=current_user.is_admin,
        expires_at=expires_at,
        status="pending"
    )
    db.add(invitation)
    await db.commit()

    # Send invitation email via AWS SES (or console fallback)
    try:
        email_service.send_invitation_email(
            to_email=email,
            invite_token=token,
            inviter_name=current_user.name or current_user.email.split("@")[0],
            workspace_name=workspace_name,
            is_admin_invite=current_user.is_admin
        )
    except Exception as e:
        print(f"[Email Warning] Could not send invite email: {e}")

    # Re-fetch with relationships
    refreshed = await db.execute(
        select(Invitation).options(
            selectinload(Invitation.inviter),
            selectinload(Invitation.workspace)
        ).where(Invitation.id == invitation.id)
    )
    return refreshed.scalar_one().to_dict()


@router.delete("/{invitation_id}")
async def cancel_invitation(
    invitation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Cancel / revoke a pending invitation."""
    inv = await db.get(Invitation, invitation_id)
    if not inv:
        raise HTTPException(status_code=404, detail="초대장을 찾을 수 없습니다.")

    # Permissions: inviter, workspace owner, or super admin
    if not current_user.is_admin and inv.invited_by != current_user.id:
        if inv.workspace_id:
            ws = await db.get(Workspace, inv.workspace_id)
            if not ws or ws.owner_id != current_user.id:
                raise HTTPException(status_code=403, detail="초대장을 취소할 권한이 없습니다.")
        else:
            raise HTTPException(status_code=403, detail="초대장을 취소할 권한이 없습니다.")

    inv.status = "cancelled"
    await db.commit()
    return {"status": "success", "message": "초대가 취소되었습니다."}


@router.get("/verify/{token}", response_model=InvitationResponse)
async def verify_invitation_token(token: str, db: AsyncSession = Depends(get_db)):
    """Public endpoint to verify invitation token before signup/login."""
    res = await db.execute(
        select(Invitation).options(
            selectinload(Invitation.inviter),
            selectinload(Invitation.workspace)
        ).where(Invitation.token == token)
    )
    inv = res.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="유효하지 않은 초대 링크입니다.")

    if inv.status == "cancelled":
        raise HTTPException(status_code=400, detail="취소된 초대 링크입니다.")
    if inv.status == "accepted":
        raise HTTPException(status_code=400, detail="이미 수락된 초대 링크입니다.")
    if inv.is_expired:
        inv.status = "expired"
        await db.commit()
        raise HTTPException(status_code=400, detail="초대 링크의 유효 기간(7일)이 만료되었습니다. 관리자에게 재발송을 요청하세요.")

    return inv.to_dict()


@router.post("/accept", response_model=TokenResponse)
async def accept_invitation(req: AcceptInvitationRequest, db: AsyncSession = Depends(get_db)):
    """Accept invitation and complete user signup/login."""
    res = await db.execute(
        select(Invitation).options(
            selectinload(Invitation.workspace)
        ).where(Invitation.token == req.token)
    )
    inv = res.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="유효하지 않은 초대 링크입니다.")

    if inv.status != "pending" or inv.is_expired:
        raise HTTPException(status_code=400, detail="만료되었거나 이미 사용된 초대 링크입니다.")

    email = inv.email.lower().strip()

    # Find or create user
    u_res = await db.execute(select(User).where(User.email == email))
    user = u_res.scalar_one_or_none()

    if not user:
        if not req.password:
            raise HTTPException(status_code=400, detail="비밀번호를 입력하여 가입을 완료해주세요.")
        
        user = User(
            email=email,
            name=req.name or email.split("@")[0],
            hashed_password=hash_password(req.password),
            picture=f"https://api.dicebear.com/7.x/bottts/svg?seed={email}",
            is_admin=False,
            is_approved=inv.is_admin_invite,  # If admin invited -> auto approve!
            is_active=True,
            last_login_at=datetime.utcnow()
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        # If existing user, auto-approve if invited by admin
        if inv.is_admin_invite:
            user.is_approved = True
        user.last_login_at = datetime.utcnow()
        await db.commit()
        await db.refresh(user)

    # Add to workspace if specified
    if inv.workspace_id:
        m_res = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == inv.workspace_id,
                WorkspaceMember.user_id == user.id
            )
        )
        if not m_res.scalar_one_or_none():
            new_member = WorkspaceMember(
                workspace_id=inv.workspace_id,
                user_id=user.id,
                role=inv.role or "member"
            )
            db.add(new_member)

    # Mark invitation accepted
    inv.status = "accepted"
    await db.commit()

    # Ensure default workspace
    await ensure_user_default_workspace(db, user)

    token_payload = {
        "sub": str(user.id),
        "email": user.email,
        "is_admin": user.is_admin,
        "is_approved": user.is_approved
    }
    access_token = create_access_token(token_payload)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=user.to_dict()
    )
