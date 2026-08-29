import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import User, Workspace

logger = logging.getLogger(__name__)

# The account that holds the shared workspace's storage pool. It is not a
# person: it cannot log in (no password, not approved) and is filtered out of
# the admin user list. It exists so the shared space has a quota of its own —
# the whole point of that space is to serve users the administrator has not
# granted personal storage to, so charging it to any individual would defeat it.
SYSTEM_ACCOUNT_EMAIL = "shared-workspace@system.local"
SYSTEM_ACCOUNT_NAME = "공용 워크스페이스 저장소"

SHARED_WORKSPACE_NAME = "공용 워크스페이스"
SHARED_WORKSPACE_SLUG = "shared"
SHARED_WORKSPACE_DESCRIPTION = "가입한 모든 이용자가 함께 사용하는 공간입니다."

# 20 GB to start with. Administrators change this from the dashboard; it is a
# starting point, not a policy.
DEFAULT_SHARED_QUOTA_BYTES = 20 * 1024 * 1024 * 1024


async def get_shared_workspace(db: AsyncSession):
    return (await db.execute(
        select(Workspace).where(Workspace.is_shared == True)  # noqa: E712
    )).scalars().first()


async def get_quota_account(db: AsyncSession):
    return (await db.execute(
        select(User).where(User.email == SYSTEM_ACCOUNT_EMAIL)
    )).scalar_one_or_none()


async def ensure_shared_workspace(db: AsyncSession) -> Workspace:
    """
    Create the shared workspace and its quota account if they do not exist yet.

    Idempotent, so it can run on every startup. Returns the workspace.
    """
    account = await get_quota_account(db)
    if account is None:
        account = User(
            email=SYSTEM_ACCOUNT_EMAIL,
            name=SYSTEM_ACCOUNT_NAME,
            is_approved=False,   # can never sign in
            is_superadmin=False,
            is_system=True,
            storage_quota_bytes=DEFAULT_SHARED_QUOTA_BYTES,
            storage_used_bytes=0,
        )
        db.add(account)
        await db.flush()
        logger.info("[SharedWorkspace] quota account created")
    elif not account.is_system:
        # An older deployment may have created it before is_system existed.
        account.is_system = True

    workspace = await get_shared_workspace(db)
    if workspace is None:
        # A workspace may already exist under the reserved slug from an earlier
        # attempt; adopt it rather than colliding on the unique index.
        existing = (await db.execute(
            select(Workspace).where(Workspace.slug == SHARED_WORKSPACE_SLUG)
        )).scalar_one_or_none()
        if existing is not None:
            existing.is_shared = True
            workspace = existing
        else:
            workspace = Workspace(
                name=SHARED_WORKSPACE_NAME,
                slug=SHARED_WORKSPACE_SLUG,
                description=SHARED_WORKSPACE_DESCRIPTION,
                owner_id=account.id,
                icon="users",
                is_shared=True,
                is_default=False,
            )
            db.add(workspace)
        logger.info("[SharedWorkspace] shared workspace created")

    await db.commit()
    await db.refresh(workspace)
    return workspace


async def ensure_on_startup() -> None:
    """Startup hook. Never fatal: the app is still usable without it, and a
    failure here must not stop the server from coming up."""
    try:
        async with AsyncSessionLocal() as db:
            await ensure_shared_workspace(db)
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"[SharedWorkspace] could not ensure shared workspace: {e}")
