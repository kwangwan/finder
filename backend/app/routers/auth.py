from datetime import datetime, timezone
import uuid
import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field

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
    create_access_token, create_media_access_token, verify_google_token, get_current_user,
    hash_password, verify_password,
    get_current_approved_user
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

async def ensure_user_default_workspace(db: AsyncSession, user: User):
    """
    Make sure the user has somewhere to work.

    A new account no longer gets a personal workspace of its own: everyone
    belongs to the shared workspace, which is the space a user has before an
    administrator grants them any storage of their own. Creating a private
    workspace per signup would hand each new user an empty space backed by a
    personal quota they do not have yet, which is the situation this replaces.

    Administrators are the exception, and only for a specific reason: legacy
    folders and files that predate workspaces have to be adopted somewhere, and
    that has always been the first admin's own workspace.
    """
    ws_res = await db.execute(
        select(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
    )
    has_membership = ws_res.first() is not None

    if not user.is_admin:
        # Membership in the shared workspace is implicit (see AccessService),
        # so nothing needs to be written here at all.
        return

    if has_membership:
        return

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
        icon="briefcase",
        is_default=True
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

    # Adopt folders and files that predate workspaces entirely.
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
    """Return public runtime config (Google Client ID, sync server URL) to frontend."""
    return {
        "google_client_id": settings.GOOGLE_CLIENT_ID,
        "sync_url": settings.VITE_SYNC_URL
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

    # The handle is the account's public identity, so it is settled at signup
    # rather than left to be filled in later — everything in the shared space
    # is attributed to it.
    from app.services import username_service
    if req.username:
        try:
            desired = username_service.validate(req.username)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not await username_service.is_available(db, desired):
            raise HTTPException(status_code=409, detail="이미 사용 중이거나 기존 아이디와 혼동되는 아이디입니다.")
    else:
        desired = await username_service.allocate(db, username_service.suggest_from_email(req.email))

    user = User(
        email=email,
        username=desired,
        name=req.name or email.split("@")[0],
        hashed_password=hash_password(req.password),
        picture=f"https://api.dicebear.com/7.x/bottts/svg?seed={email}",
        is_admin=is_first_user,
        is_approved=True,
        is_active=True,
        storage_quota_bytes=100 * 1024 * 1024 * 1024 if is_first_user else 0,
        last_login_at=datetime.now(timezone.utc)
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

    user.last_login_at = datetime.now(timezone.utc)
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

        from app.services import username_service as _uns
        google_handle = await _uns.allocate(db, _uns.suggest_from_email(email))
        user = User(
            email=email,
            username=google_handle,
            name=google_profile.get("name") or email.split("@")[0],
            picture=google_profile.get("picture"),
            google_id=google_profile.get("google_id"),
            is_admin=is_first_user,
            is_approved=True,
            is_active=True,
            storage_quota_bytes=100 * 1024 * 1024 * 1024 if is_first_user else 0,
            last_login_at=datetime.now(timezone.utc)
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        user.last_login_at = datetime.now(timezone.utc)
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
            last_login_at=datetime.now(timezone.utc)
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        user.last_login_at = datetime.now(timezone.utc)
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

@router.post("/media-token")
async def issue_media_token(current_user: User = Depends(get_current_user)):
    """
    Issue a short-lived, media-scoped token for use in URLs that browser tags
    (<img>, <video>, <a>) hit directly and can't attach an Authorization header
    to (preview/thumbnail/download links). Kept separate from the main session
    token so a URL leaking via browser history or server logs only exposes a
    few minutes of media-only access, not the full session.
    """
    from app.core.security import MEDIA_TOKEN_EXPIRE_MINUTES
    return {
        "media_token": create_media_access_token(str(current_user.id)),
        "expires_in": MEDIA_TOKEN_EXPIRE_MINUTES * 60
    }


class UpdateMyNameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


@router.put("/me/name")
async def update_my_name(
    req: UpdateMyNameRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Change your own display name.

    Names must be distinguishable from one another. In a workspace everyone
    shares, the uploader's name is the only thing identifying who put a file
    there — two people showing the same name makes attribution impossible and
    impersonation trivial. Compared case-insensitively so "Kim" and "kim" are
    not treated as different people.
    """
    name = " ".join(req.name.split())          # collapse runs of whitespace
    if not name:
        raise HTTPException(status_code=400, detail="이름을 입력해 주세요.")

    clash = (await db.execute(
        select(User).where(
            func.lower(User.name) == name.lower(),
            User.id != current_user.id,
        )
    )).scalars().first()
    if clash:
        raise HTTPException(status_code=409, detail="이미 사용 중인 이름입니다. 다른 이름을 입력해 주세요.")

    current_user.name = name
    try:
        await db.commit()
    except IntegrityError:
        # Two people submitting the same new name at once: the unique index is
        # what actually decides, and the loser is told rather than silently
        # ending up with a duplicate.
        await db.rollback()
        raise HTTPException(status_code=409, detail="이미 사용 중인 이름입니다. 다른 이름을 입력해 주세요.")

    await db.refresh(current_user)

    return {"id": str(current_user.id), "name": current_user.name}


@router.get("/me/name-available")
async def check_name_available(
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Whether a name is free, so the form can say so before submitting."""
    candidate = " ".join((name or "").split())
    if not candidate:
        return {"available": False, "reason": "empty"}
    clash = (await db.execute(
        select(User).where(
            func.lower(User.name) == candidate.lower(),
            User.id != current_user.id,
        )
    )).scalars().first()
    return {"available": clash is None}


class UpdateUsernameRequest(BaseModel):
    username: str = Field(..., max_length=20)


@router.put("/me/username")
async def update_my_username(
    req: UpdateUsernameRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Change your handle.

    Handles are compared by how they look, not by their bytes: "b0b" is not
    available next to "bob". Without that, uniqueness would be satisfied by
    strings nobody can tell apart, which is the whole problem it exists to
    solve.
    """
    from app.services import username_service

    try:
        desired = username_service.validate(req.username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if desired != (current_user.username or ""):
        if not await username_service.is_available(db, desired, exclude_user_id=current_user.id):
            raise HTTPException(status_code=409, detail="이미 사용 중이거나 기존 아이디와 혼동되는 아이디입니다.")

    current_user.username = desired
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다.")
    await db.refresh(current_user)

    # The personal folder is named by the handle, so it moves with it.
    try:
        from app.services.personal_folder_service import rename_personal_folder
        await rename_personal_folder(db, current_user, desired)
    except Exception:
        pass

    return {"id": str(current_user.id), "username": current_user.username}


@router.get("/username-available")
async def username_available(
    username: str,
    db: AsyncSession = Depends(get_db),
):
    """Open to unauthenticated callers so the signup form can check as you type."""
    from app.services import username_service
    try:
        candidate = username_service.validate(username)
    except ValueError as e:
        return {"available": False, "reason": str(e)}
    ok = await username_service.is_available(db, candidate)
    return {"available": ok, "reason": None if ok else "이미 사용 중이거나 기존 아이디와 혼동되는 아이디입니다."}
