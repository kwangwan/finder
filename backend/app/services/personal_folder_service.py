import logging
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Folder, FolderWriteGrant, User

logger = logging.getLogger(__name__)


def folder_name_for(user: User) -> str:
    """
    The folder is named by the account's handle, not its display name.

    A display name can be Korean, can be changed freely, and can be made to
    look like someone else's; the handle cannot. Since this folder is how
    everyone finds and attributes a person's material in a space they all
    share, it has to carry the identity that cannot be imitated.
    """
    handle = (getattr(user, "username", None) or "").strip()
    if handle:
        return handle
    return f"user-{str(user.id)[:8]}"


async def ensure_personal_folder(db: AsyncSession, user: User, workspace_id) -> Optional[Folder]:
    """
    The one folder in the shared workspace this user may write in.

    Created on demand and named after the account's handle, which is unique
    and unimitable — that is what makes a folder list readable and a file's
    location attributable at a glance.
    """
    if not workspace_id or getattr(user, "is_system", False):
        return None

    existing = (await db.execute(
        select(Folder).where(
            Folder.workspace_id == workspace_id,
            Folder.owner_user_id == user.id,
            Folder.is_trashed == False,  # noqa: E712
        )
    )).scalars().first()
    if existing:
        return existing

    desired = folder_name_for(user)
    folder = Folder(
        name=desired,
        parent_id=None,
        workspace_id=workspace_id,
        created_by=user.id,
        owner_user_id=user.id,
        icon="user",
    )
    db.add(folder)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return (await db.execute(
            select(Folder).where(
                Folder.workspace_id == workspace_id,
                Folder.owner_user_id == user.id,
            )
        )).scalars().first()
    await db.refresh(folder)
    logger.info(f"[PersonalFolder] created '{folder.name}' for {user.email}")
    return folder


async def rename_personal_folder(db: AsyncSession, user: User, new_name: str) -> None:
    """
    Keep the folder's name in step with the account's handle.

    The folder is how other people find someone's material, so changing the
    handle without moving the folder would leave it labelled with an identity
    that no longer belongs to anyone.
    """
    folders = (await db.execute(
        select(Folder).where(Folder.owner_user_id == user.id)
    )).scalars().all()
    for f in folders:
        f.name = new_name
    if folders:
        await db.commit()


async def get_owning_personal_folder(db: AsyncSession, folder_id) -> Optional[Folder]:
    """
    Walk up from a folder to the personal folder that contains it.

    Permission belongs to the top of the tree, not to each folder in it: a user
    creating sub-folders inside their own space must not have to be granted
    anything again, and a grant given at the top has to reach all the way down.
    """
    seen = set()
    current_id = folder_id
    while current_id and current_id not in seen:
        seen.add(current_id)
        folder = await db.get(Folder, current_id)
        if folder is None:
            return None
        if folder.owner_user_id is not None:
            return folder
        current_id = folder.parent_id
    return None


async def can_write_in_folder(db: AsyncSession, user: User, folder_id) -> bool:
    """
    Whether this user may change things at this location in the shared space.

    The workspace root is nobody's: a flat pile that anyone can add to and
    delete from is exactly what stops being manageable once there are more
    than a handful of people. Everything lives inside somebody's folder.
    """
    if user.is_admin:
        return True
    if folder_id is None:
        return False

    personal = await get_owning_personal_folder(db, folder_id)
    if personal is None:
        return False
    if personal.owner_user_id == user.id:
        return True

    grant = (await db.execute(
        select(FolderWriteGrant.id).where(
            FolderWriteGrant.folder_id == personal.id,
            FolderWriteGrant.user_id == user.id,
        )
    )).scalar_one_or_none()
    return grant is not None


async def list_grants(db: AsyncSession, folder_id):
    rows = (await db.execute(
        select(FolderWriteGrant, User)
        .join(User, User.id == FolderWriteGrant.user_id)
        .where(FolderWriteGrant.folder_id == folder_id)
    )).all()
    return [
        {
            "id": str(g.id),
            "user_id": str(u.id),
            "name": u.name or u.email,
            "email": u.email,
            "created_at": g.created_at,
        }
        for g, u in rows
    ]
