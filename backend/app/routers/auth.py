from datetime import datetime
import uuid
import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.models.folder import Folder
from app.models.file import FileItem
from app.models.invitation import Invitation
from app.schemas.auth import (
    GoogleLoginRequest, PasswordRegisterRequest, PasswordLoginRequest,
    DevLoginRequest, TokenResponse, UserResponse
)
from app.core.security import (
    create_access_token, verify_google_token, get_current_user,
    hash_password, verify_password
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

async def ensure_user_default_workspace(db: AsyncSession, user: User):
    """Ensure user has at least one workspace. If not, create a default workspace and migrate legacy items."""
    ws_res = await db.execute(
        select(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
    )
    if ws_res.first() is None:
        user_display = user.name or user.email.split("@")[0]
        ws_name = f"{user_display}의 워크스페이스"
        slug_base = re.sub(r'[^\w\s-]', '', ws_name.lower().strip())
        slug_base = re.sub(r'[\s_]+', '-', slug_base)[:50] or "workspace"
        slug = f"{slug_base}-{str(user.id)[:8]}"
        
        ex = await db.execute(select(Workspace).where(Workspace.slug == slug))
        if ex.scalar_one_or_none():
            slug = f"{slug}-{uuid.uuid4().hex[:6]}"
            
        workspace = Workspace(
            name=ws_name,
            description="개인 기본 워크스페이스",
            slug=slug,
            owner_id=user.id,
            icon="briefcase"
        )
        db.add(workspace)
        await db.commit()
        await db.refresh(workspace)
        
        member = WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user.id,
            role="owner"
        )
        db.add(member)

        # If this is admin or first user, assign unassigned folders & files to this workspace
        if user.is_admin:
            await db.execute(
                update(Folder).where(Folder.workspace_id.is_(None)).values(workspace_id=workspace.id, created_by=user.id)
            )
            await db.execute(
                update(FileItem).where(FileItem.workspace_id.is_(None)).values(workspace_id=workspace.id, created_by=user.id)
            )
        await db.commit()

async def process_invite_token_if_any(db: AsyncSession, user: User, invite_token: str | None = None):
    """If a valid invitation token is provided OR if there are pending invitations for this user's email,
    apply workspace membership, mark invitation accepted, and auto-approve if invited by admin."""
    invitations_to_process = []
    
    if invite_token:
        inv_res = await db.execute(select(Invitation).where(Invitation.token == invite_token))
        inv = inv_res.scalar_one_or_none()
        if inv and inv.status == "pending" and not inv.is_expired:
            invitations_to_process.append(inv)
    
    # Also find any pending valid invitations matching user's email
    email_inv_res = await db.execute(
        select(Invitation).where(
            func.lower(Invitation.email) == user.email.lower().strip(),
            Invitation.status == "pending"
        )
    )
    for inv in email_inv_res.scalars().all():
        if not inv.is_expired and inv not in invitations_to_process:
            invitations_to_process.append(inv)
            
    for inv in invitations_to_process:
        # 1. If invited by super admin -> auto approve user
        if inv.is_admin_invite:
            user.is_approved = True
            print(f"[Invitation] User {user.email} auto-approved via admin invite")

        # 2. If assigned to a workspace -> add membership
        if inv.workspace_id:
            existing_m = await db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == inv.workspace_id,
                    WorkspaceMember.user_id == user.id
                )
            )
            if not existing_m.scalar_one_or_none():
                new_m = WorkspaceMember(
                    workspace_id=inv.workspace_id,
                    user_id=user.id,
                    role=inv.role or "member"
                )
                db.add(new_m)
        
        # Mark accepted
        inv.status = "accepted"
    
    if invitations_to_process:
        await db.commit()
        await db.refresh(user)

@router.get("/config")
async def get_auth_config():
    """Return public auth config (e.g. Google Client ID) to frontend."""
    return {
        "google_client_id": settings.GOOGLE_CLIENT_ID
    }

@router.post("/register-password", response_model=TokenResponse)
async def register_with_password(req: PasswordRegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new test account with Email & Password."""
    email = req.email.lower().strip()

    # Check if user already exists
    res = await db.execute(select(User).where(User.email == email))
    existing_user = res.scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 등록된 이메일 주소입니다. 로그인해주세요."
        )

    # First user check
    user_count_res = await db.execute(select(func.count(User.id)))
    user_count = user_count_res.scalar_one_or_none() or 0
    is_first_user = (user_count == 0)

    user = User(
        email=email,
        name=req.name or email.split("@")[0],
        hashed_password=hash_password(req.password),
        picture=f"https://api.dicebear.com/7.x/bottts/svg?seed={email}",
        is_admin=is_first_user,
        is_approved=True,
        is_active=True,
        storage_quota_bytes=100 * 1024 * 1024 * 1024 if is_first_user else 0,
        last_login_at=datetime.utcnow()
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Process invitation token if any
    await process_invite_token_if_any(db, user, req.invite_token)

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

@router.post("/login-password", response_model=TokenResponse)
async def login_with_password(req: PasswordLoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate test account with Email & Password."""
    email = req.email.lower().strip()

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()

    if not user or not user.hashed_password or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이메일 또는 비밀번호가 일치하지 않습니다."
        )

    user.last_login_at = datetime.utcnow()
    await db.commit()
    await db.refresh(user)

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

@router.post("/google", response_model=TokenResponse)
async def login_with_google(req: GoogleLoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate or register user using Google OAuth ID Token."""
    google_profile = verify_google_token(req.id_token)
    if not google_profile or not google_profile.get("email"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 구글 인증 토큰입니다."
        )

    email = google_profile["email"].lower().strip()
    
    # Check if user already exists
    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()

    if not user:
        user_count_res = await db.execute(select(func.count(User.id)))
        user_count = user_count_res.scalar_one_or_none() or 0
        is_first_user = (user_count == 0)

        user = User(
            email=email,
            name=google_profile.get("name") or email.split("@")[0],
            picture=google_profile.get("picture"),
            google_id=google_profile.get("google_id"),
            is_admin=is_first_user,
            is_approved=True,
            is_active=True,
            storage_quota_bytes=100 * 1024 * 1024 * 1024 if is_first_user else 0,
            last_login_at=datetime.utcnow()
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        user.last_login_at = datetime.utcnow()
        if google_profile.get("picture"):
            user.picture = google_profile["picture"]
        if google_profile.get("name"):
            user.name = google_profile["name"]
        await db.commit()
        await db.refresh(user)

    # Process invitation token if any
    await process_invite_token_if_any(db, user, req.invite_token)

    # Ensure default workspace
    await ensure_user_default_workspace(db, user)

    # Generate JWT
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

@router.post("/dev-login", response_model=TokenResponse)
async def dev_login(req: DevLoginRequest, db: AsyncSession = Depends(get_db)):
    """Development / Testing login route (disabled in production)."""
    if not settings.DEBUG:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="개발 및 테스트용 로그인 엔드포인트는 프로덕션 모드에서 비활성화되어 있습니다."
        )
    email = req.email.lower().strip()

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()

    if not user:
        user = User(
            email=email,
            name=req.name or email.split("@")[0],
            picture=req.picture or f"https://api.dicebear.com/7.x/bottts/svg?seed={email}",
            is_admin=False,
            is_approved=False,
            is_active=True,
            last_login_at=datetime.utcnow()
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        user.last_login_at = datetime.utcnow()
        if req.name:
            user.name = req.name
        await db.commit()
        await db.refresh(user)

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

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return currently authenticated user and approval status."""
    return current_user
