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


# The same claim made in a display name. Names are free-form and Korean, so
# the Korean words matter here in a way they cannot in a handle.
DISPLAY_AUTHORITY_TOKENS = AUTHORITY_TOKENS | {
    "관리자", "운영자", "운영팀", "관리팀", "운영진", "매니저", "매니져",
    "스태프", "고객센터", "고객지원", "지원팀", "헬프데스크", "공식", "본사",
    "시스템", "총괄", "책임자", "담당자공식",
}


def validate_display_name(name: str) -> str:
    """
    A display name that does not claim to speak for the service.

    A name is not unique-by-construction the way a handle is — two people may
    share one — but "운영자" beside a message is a claim about authority, and
    it is just as effective in the free-form field as in the handle.
    """
    candidate = " ".join((name or "").split())
    if not candidate:
        raise ValueError("이름을 입력해 주세요.")
    if len(candidate) > 60:
        raise ValueError("이름은 60자 이하로 입력해 주세요.")

    lowered = candidate.lower()
    folded = _fold_for_reserved(lowered)
    compact = re.sub(r"[\s._-]+", "", lowered)
    for token in DISPLAY_AUTHORITY_TOKENS:
        if token in folded or token in compact:
            raise ValueError("관리자·운영자를 연상시키는 이름은 사용할 수 없습니다.")
    return candidate


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


# How long a handle somebody has given up stays theirs to take back.
#
# Not forever: handles are a small, finite pool, and holding every one anybody
# ever tried would exhaust the good ones for no living reason. Not immediately
# either: work attributed to "@jhkim" months ago must not start reading as a
# different person the moment they rename. Half a year is long enough for the
# old attributions to stop being current business.
RELEASED_HANDLE_RESERVED_DAYS = 180

# How often a person may change their own handle. Attribution is only as
# stable as the name it is written in.
HANDLE_CHANGE_COOLDOWN_DAYS = 30


async def is_available(db: AsyncSession, candidate: str, exclude_user_id=None) -> bool:
    """
    Free only if no existing handle looks the same, not merely if none is
    byte-identical — and only if nobody else recently gave it up.
    """
    from datetime import datetime, timedelta, timezone
    from app.models import UsernameHistory

    target = skeleton(candidate)
    stmt = select(User.id, User.username).where(User.username.isnot(None))
    if exclude_user_id:
        stmt = stmt.where(User.id != exclude_user_id)
    for _id, existing in (await db.execute(stmt)).all():
        if skeleton(existing) == target:
            return False

    # Recently released by somebody else: still theirs for now.
    cutoff = datetime.now(timezone.utc) - timedelta(days=RELEASED_HANDLE_RESERVED_DAYS)
    held = select(UsernameHistory.user_id, UsernameHistory.username).where(
        UsernameHistory.released_at.isnot(None),
        UsernameHistory.released_at >= cutoff,
    )
    if exclude_user_id:
        held = held.where(UsernameHistory.user_id != exclude_user_id)
    for _uid, past in (await db.execute(held)).all():
        if skeleton(past) == target:
            return False
    return True


async def record_taken(db: AsyncSession, user_id, username: str) -> None:
    """Write down that this account now holds this handle."""
    from app.models import UsernameHistory
    db.add(UsernameHistory(user_id=user_id, username=username))


async def release_current(db: AsyncSession, user_id) -> None:
    """Close whichever handle row this account is still holding."""
    from datetime import datetime, timezone
    from app.models import UsernameHistory

    rows = (await db.execute(
        select(UsernameHistory).where(
            UsernameHistory.user_id == user_id,
            UsernameHistory.released_at.is_(None),
        )
    )).scalars().all()
    now = datetime.now(timezone.utc)
    for row in rows:
        row.released_at = now


async def change_allowed_at(db: AsyncSession, user_id):
    """
    When this account may next change its handle, or None if it may now.

    Read from the history rather than a column: the answer is "a while after
    the last time", and the history already says when that was.
    """
    from datetime import timedelta, timezone
    from app.models import UsernameHistory

    current = (await db.execute(
        select(UsernameHistory)
        .where(UsernameHistory.user_id == user_id, UsernameHistory.released_at.is_(None))
        .order_by(UsernameHistory.taken_at.desc())
        .limit(1)
    )).scalars().first()
    if current is None:
        return None
    previous = (await db.execute(
        select(UsernameHistory.id)
        .where(UsernameHistory.user_id == user_id, UsernameHistory.released_at.isnot(None))
        .limit(1)
    )).scalars().first()
    # The handle chosen at sign-up is not a change, so the first one is free.
    if previous is None:
        return None
    taken = current.taken_at
    if taken is not None and taken.tzinfo is None:
        taken = taken.replace(tzinfo=timezone.utc)
    return taken + timedelta(days=HANDLE_CHANGE_COOLDOWN_DAYS)


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
    Name the accounts that cannot be asked.

    Only the system accounts. A handle made from an email's local part
    publishes whatever that address says about a person — an address holding
    somebody's real name became the handle printed on every file they upload —
    so a real account without one is asked to choose (ChooseHandleScreen)
    rather than named after their address behind their back.
    """
    users = (await db.execute(select(User).where(User.username.is_(None)))).scalars().all()
    assigned = 0
    for u in users:
        if not getattr(u, "is_system", False):
            continue
        u.username = f"system_{str(u.id)[:8]}"
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


async def display_name_available(db: AsyncSession, candidate: str, exclude_user_id=None) -> bool:
    """Whether this display name is free. Names are unique, one person to one."""
    stmt = select(User.id).where(func.lower(User.name) == (candidate or "").lower())
    if exclude_user_id:
        stmt = stmt.where(User.id != exclude_user_id)
    return (await db.execute(stmt)).first() is None


async def allocate_display_name(db: AsyncSession, base: str) -> str:
    """
    A free display name near `base`, for a signup that cannot be asked.

    Google hands over whatever name the account carries, and two people really
    can be called the same thing. Refusing the signup would leave them unable
    to get in at all over a name they never chose, so the clash is settled by
    numbering it and letting them rename themselves afterwards.
    """
    candidate = " ".join((base or "").split()) or "사용자"
    try:
        candidate = validate_display_name(candidate)
    except ValueError:
        candidate = "사용자"
    if await display_name_available(db, candidate):
        return candidate
    for n in range(2, 100):
        attempt = f"{candidate[:52]} ({n})"
        if await display_name_available(db, attempt):
            return attempt
    return f"{candidate[:44]} ({uuid.uuid4().hex[:6]})"
