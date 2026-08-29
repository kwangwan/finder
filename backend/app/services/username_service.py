import re
import uuid
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User

# Why ASCII only, and why lowercase.
#
# The attack being prevented is visual, not logical: Cyrillic "а", Greek "ο",
# fullwidth "ａ", zero-width joiners, combining marks and right-to-left
# overrides all let one person render a handle that looks exactly like
# someone else's. Case-insensitive uniqueness catches none of that, and
# normalising Unicode properly needs a confusables table that is never
# complete.
#
# Restricting the identity string to lowercase ASCII makes a visual collision
# impossible by construction — there is exactly one way to write any handle.
# The cost is that a handle cannot be Korean; that is why the display name
# stays free-form and this is a separate field rather than a restriction on it.
USERNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$")
MIN_LEN = 3
MAX_LEN = 20

RESERVED = {
    "root", "system", "shared", "help", "api", "null", "undefined",
    "me", "self", "owner", "finder", "projectrun", "test", "guest",
}

# Words that make an account look like it speaks for the service. Matched
# anywhere in the handle, not just as the whole of it: "admin_kim",
# "the_admin" and "admin2" all read as official at a glance, which is the
# entire point of claiming one.
AUTHORITY_TOKENS = {
    "admin", "administrator", "sysadmin", "webmaster", "moderator",
    "operator", "supervisor", "manager", "official", "staff",
    "helpdesk", "support", "security", "master", "owner", "system",
    "관리자",  # cannot be typed in a handle, but kept so the intent is explicit
}

# Folded before the check so digits and symbols standing in for letters do not
# get around it: "4dm1n", "@dmin" and "a_d_m_i_n" all reduce to "admin".
_LEET = str.maketrans({
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
    "@": "a", "$": "s", "_": "", "-": "", ".": "",
})


def _fold_for_reserved(username: str) -> str:
    return (username or "").lower().translate(_LEET)

# Characters that still look alike within plain ASCII. Two handles whose
# skeletons match are treated as the same handle, so "b0b" cannot be
# registered next to "bob". Deliberately conservative: it only merges the
# pairs people actually confuse at a glance.
_SKELETON = str.maketrans({"0": "o", "1": "l", "i": "l", "_": ""})


def skeleton(username: str) -> str:
    return (username or "").lower().translate(_SKELETON)


def validate(username: str) -> str:
    """Return the cleaned handle, or raise ValueError with a reason."""
    candidate = (username or "").strip().lower()
    if not candidate:
        raise ValueError("아이디를 입력해 주세요.")
    if len(candidate) < MIN_LEN or len(candidate) > MAX_LEN:
        raise ValueError(f"아이디는 {MIN_LEN}~{MAX_LEN}자로 입력해 주세요.")
    if not USERNAME_RE.match(candidate):
        raise ValueError("아이디는 영문 소문자, 숫자, 밑줄(_)만 쓸 수 있고 밑줄로 시작하거나 끝날 수 없습니다.")
    if candidate in RESERVED:
        raise ValueError("사용할 수 없는 아이디입니다.")

    folded = _fold_for_reserved(candidate)
    for token in AUTHORITY_TOKENS:
        if token in folded:
            raise ValueError("관리자를 연상시키는 아이디는 사용할 수 없습니다.")

    return candidate


async def is_available(db: AsyncSession, candidate: str, exclude_user_id=None) -> bool:
    """Free only if no existing handle looks the same, not merely if none is
    byte-identical."""
    target = skeleton(candidate)
    stmt = select(User.id, User.username).where(User.username.isnot(None))
    if exclude_user_id:
        stmt = stmt.where(User.id != exclude_user_id)
    for _id, existing in (await db.execute(stmt)).all():
        if skeleton(existing) == target:
            return False
    return True


def suggest_from_email(email: str) -> str:
    """A starting handle derived from an email's local part. Only ever a
    suggestion — the account still has to accept or change it."""
    local = (email or "").split("@")[0].lower()
    cleaned = re.sub(r"[^a-z0-9_]", "", local).strip("_")
    if len(cleaned) < MIN_LEN:
        cleaned = f"user{uuid.uuid4().hex[:6]}"
    return cleaned[:MAX_LEN].rstrip("_") or f"user{uuid.uuid4().hex[:6]}"


async def allocate(db: AsyncSession, base: str, exclude_user_id=None) -> str:
    """A free handle near `base`, for backfilling accounts that predate the field."""
    candidate = base[:MAX_LEN]
    try:
        candidate = validate(candidate)
    except ValueError:
        candidate = f"user{uuid.uuid4().hex[:6]}"
    if await is_available(db, candidate, exclude_user_id):
        return candidate
    for n in range(2, 200):
        suffix = str(n)
        trimmed = candidate[: MAX_LEN - len(suffix)].rstrip("_")
        attempt = f"{trimmed}{suffix}"
        if await is_available(db, attempt, exclude_user_id):
            return attempt
    return f"user{uuid.uuid4().hex[:10]}"


async def backfill_all(db: AsyncSession) -> int:
    """
    Give every existing account a handle.

    Runs at startup and is idempotent. Derived from the email's local part so
    the temporary handle is at least recognisable to its owner, who can change
    it afterwards.
    """
    users = (await db.execute(select(User).where(User.username.is_(None)))).scalars().all()
    assigned = 0
    for u in users:
        if getattr(u, "is_system", False):
            u.username = f"system_{str(u.id)[:8]}"
        else:
            u.username = await allocate(db, suggest_from_email(u.email), exclude_user_id=u.id)
        assigned += 1
        await db.flush()
    if assigned:
        await db.commit()

    # Personal folders created before handles existed still carry a display
    # name. Bring them in line, so the folder list is a list of handles rather
    # than a mix of the two.
    from app.models import Folder
    from app.services.personal_folder_service import folder_name_for

    owned = (await db.execute(select(Folder).where(Folder.owner_user_id.isnot(None)))).scalars().all()
    renamed = 0
    for f in owned:
        owner = await db.get(User, f.owner_user_id)
        if not owner:
            continue
        expected = folder_name_for(owner)
        if f.name != expected:
            f.name = expected
            renamed += 1
    if renamed:
        await db.commit()

    return assigned
