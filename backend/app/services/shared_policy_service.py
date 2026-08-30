import logging
from html import escape
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting, SharedDailyUsage, User, Workspace
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

GB = 1024 ** 3
MB = 1024 ** 2

# Defaults, all changeable from the dashboard.
DEFAULTS = {
    # Per user, per day, into the shared workspace. A total cap would let one
    # person take the whole pool once and keep it; a daily one bounds the
    # damage to a day and recovers on its own.
    "shared.daily_limit_bytes": 50 * MB,
    "shared.max_file_bytes": 50 * MB,
    # Refused outright in a space everyone can download from.
    "shared.blocked_extensions": [
        "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl",
        "jar", "app", "dmg", "pkg", "deb", "rpm",
        "sh", "ps1", "vbs", "js", "jse", "wsf", "hta", "reg",
    ],
    # A brand-new account gets a smaller daily allowance for its first few
    # days, then graduates on its own.
    #
    # This replaces the obvious idea of starting everyone read-only. Approval
    # is already the gate that keeps a spam signup out, so a second manual
    # gate protects against the same thing twice while making an administrator
    # decide, one account at a time, that each new person is allowed to use
    # the product — toil that grows with every signup and that nobody can
    # judge well from a list of email addresses. A smaller opening allowance
    # bounds what a bad account can do on the day it arrives, costs the
    # administrator nothing, and resolves itself for everyone else.
    "shared.new_account_days": 7,
    "shared.new_account_daily_limit_bytes": 5 * MB,
    # Percentage of the shared pool at which administrators are emailed.
    "shared.alert_threshold_percent": 90,
    # Internal: the highest threshold already alerted on, so a pool sitting
    # above the line does not email on every single upload.
    "shared.alert_last_level": 0,
    # Internal: the date the last warning went out, so a pool that stays full
    # is reported again each day rather than once ever.
    "shared.alert_last_sent_date": None,
    # Hour (UTC) the daily reminder goes out.
    "shared.alert_daily_hour_utc": 0,
}


async def get_setting(db: AsyncSession, key: str):
    row = (await db.execute(select(AppSetting).where(AppSetting.key == key))).scalar_one_or_none()
    if row is None or row.value is None:
        return DEFAULTS.get(key)
    return row.value


async def set_setting(db: AsyncSession, key: str, value) -> None:
    row = (await db.execute(select(AppSetting).where(AppSetting.key == key))).scalar_one_or_none()
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)
    await db.commit()


async def get_all_settings(db: AsyncSession) -> dict:
    rows = (await db.execute(select(AppSetting))).scalars().all()
    stored = {r.key: r.value for r in rows if r.value is not None}
    return {**DEFAULTS, **stored}


async def is_shared_workspace(db: AsyncSession, workspace_id) -> bool:
    if not workspace_id:
        return False
    ws = await db.get(Workspace, workspace_id)
    return bool(ws and ws.is_shared)


# --------------------------------------------------------------------------
# Daily allowance
# --------------------------------------------------------------------------

async def get_daily_usage(db: AsyncSession, user_id) -> int:
    today = datetime.now(timezone.utc).date()
    row = (await db.execute(
        select(SharedDailyUsage).where(
            SharedDailyUsage.user_id == user_id,
            SharedDailyUsage.usage_date == today,
        )
    )).scalar_one_or_none()
    return row.bytes_used if row else 0


async def get_effective_daily_limit(db: AsyncSession, user: User) -> int:
    """Today's allowance for this user: the reduced one while the account is
    still new, the normal one afterwards. No administrator decides this."""
    normal = int(await get_setting(db, "shared.daily_limit_bytes") or 0)
    new_days = int(await get_setting(db, "shared.new_account_days") or 0)
    new_limit = int(await get_setting(db, "shared.new_account_daily_limit_bytes") or 0)
    if not new_days or not new_limit or not user.created_at:
        return normal
    created = user.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - created).days
    if age_days < new_days:
        # Never larger than the normal allowance, whatever the settings say.
        return min(new_limit, normal) if normal else new_limit
    return normal


async def get_daily_remaining(db: AsyncSession, user: User) -> tuple:
    limit = await get_effective_daily_limit(db, user)
    used = await get_daily_usage(db, user.id)
    return max(0, limit - used), limit, used


async def record_daily_usage(db: AsyncSession, user_id, size_bytes: int) -> None:
    """Charge bytes against today's allowance. Counts what was uploaded, not
    what is still there — deleting afterwards must not refund the allowance,
    or the limit can be walked around with an upload/delete loop."""
    if size_bytes <= 0:
        return
    today = datetime.now(timezone.utc).date()
    row = (await db.execute(
        select(SharedDailyUsage).where(
            SharedDailyUsage.user_id == user_id,
            SharedDailyUsage.usage_date == today,
        )
    )).scalar_one_or_none()
    if row is None:
        db.add(SharedDailyUsage(user_id=user_id, usage_date=today, bytes_used=size_bytes))
    else:
        row.bytes_used = (row.bytes_used or 0) + size_bytes
    await db.commit()


# --------------------------------------------------------------------------
# Upload rules
# --------------------------------------------------------------------------

def _extension(filename: Optional[str]) -> str:
    if not filename:
        return ""
    name = PurePosixPath(str(filename).replace("\\", "/")).name
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


async def enforce_upload_rules(
    db: AsyncSession,
    user: User,
    workspace_id,
    size_bytes: int,
    filename: Optional[str] = None,
) -> None:
    """
    Apply the shared workspace's own rules to something about to be written.

    Administrators are exempt: these limits exist to bound what an ordinary
    account can do to a space everyone relies on, and an administrator
    tidying or seeding that space should not be fighting them.
    """
    if not await is_shared_workspace(db, workspace_id):
        return
    if user.is_superadmin:
        return

    max_file = int(await get_setting(db, "shared.max_file_bytes") or 0)
    if max_file and size_bytes > max_file:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"공용 워크스페이스에는 파일 하나당 {round(max_file / MB)}MB까지 올릴 수 있습니다.",
        )

    blocked = await get_setting(db, "shared.blocked_extensions") or []
    ext = _extension(filename)
    if ext and ext in {str(b).lower().lstrip(".") for b in blocked}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"공용 워크스페이스에는 .{ext} 형식의 파일을 올릴 수 없습니다.",
        )

    remaining, limit, used = await get_daily_remaining(db, user)
    if limit and size_bytes > remaining:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"공용 워크스페이스의 하루 업로드 한도({round(limit / MB)}MB)를 초과했습니다. "
                f"오늘 남은 용량: {round(remaining / MB, 1)}MB. 내일 다시 시도하거나 관리자에게 문의하세요."
            ),
        )


# --------------------------------------------------------------------------
# Pool alerting
# --------------------------------------------------------------------------

async def _send_threshold_email(db: AsyncSession, account, percent: float) -> bool:
    admins = (await db.execute(
        select(User).where(User.is_superadmin == True, User.is_system == False)  # noqa: E712
    )).scalars().all()
    emails = [a.email for a in admins if a.email]
    if not emails:
        return False
    used_gb = round(account.storage_used_bytes / GB, 2)
    quota_gb = round(account.storage_quota_bytes / GB, 2)
    subject = f"[Project Run : Finder] 공용 워크스페이스 저장 용량 {percent:.0f}% 사용"
    html = f"""
    <div style="font-family:sans-serif;line-height:1.6">
      <h2>공용 워크스페이스 저장 용량 경고</h2>
      <p>공용 워크스페이스의 저장 용량이 <strong>{percent:.1f}%</strong>에 도달했습니다.</p>
      <p>사용량: <strong>{used_gb}GB</strong> / {quota_gb}GB</p>
      <p>관리자 대시보드에서 용량을 늘리거나 오래된 파일을 정리해 주세요.</p>
      <p style="color:#888;font-size:12px">이 안내는 용량이 기준 아래로 내려갈 때까지 매일 한 번 발송됩니다.</p>
    </div>
    """
    text = f"공용 워크스페이스 저장 용량이 {percent:.1f}%에 도달했습니다 ({used_gb}GB / {quota_gb}GB)."
    try:
        email_service.send_notification(emails, subject, html, text)
        return True
    except Exception as e:
        logger.error(f"[SharedPolicy] threshold email failed: {e}")
        return False


async def send_daily_threshold_reminder(db: AsyncSession) -> bool:
    """
    Re-send the storage warning once a day while the pool is still over its
    line.

    A single mail at the moment of crossing is easy to miss — it arrives once,
    possibly overnight, and nothing follows it. Repeating daily keeps it in
    front of whoever is actually going to act on it, and stops as soon as the
    pool comes back down.
    """
    from app.services.shared_workspace_service import get_quota_account

    account = await get_quota_account(db)
    if not account or not account.storage_quota_bytes:
        return False
    percent = (account.storage_used_bytes / account.storage_quota_bytes) * 100
    threshold = float(await get_setting(db, "shared.alert_threshold_percent") or 90)
    if percent < threshold:
        return False

    today = datetime.now(timezone.utc).date().isoformat()
    if await get_setting(db, "shared.alert_last_sent_date") == today:
        return False

    sent = await _send_threshold_email(db, account, percent)
    if sent:
        await set_setting(db, "shared.alert_last_sent_date", today)
    return sent


async def check_pool_threshold(db: AsyncSession) -> None:
    """
    Email every administrator when the shared pool crosses its warning line.

    Only on the way up, and only once per crossing: a pool sitting above the
    threshold would otherwise send a message on every upload, which trains
    people to ignore it. Falling back below resets it. A daily reminder
    (send_daily_threshold_reminder) covers the case where that one mail is
    missed.
    """
    from app.services.shared_workspace_service import get_quota_account

    account = await get_quota_account(db)
    if not account or not account.storage_quota_bytes:
        return

    percent = (account.storage_used_bytes / account.storage_quota_bytes) * 100
    threshold = float(await get_setting(db, "shared.alert_threshold_percent") or 90)
    last_level = float(await get_setting(db, "shared.alert_last_level") or 0)

    if percent < threshold:
        if last_level:
            await set_setting(db, "shared.alert_last_level", 0)
        return
    if last_level >= threshold:
        return  # already told them about this crossing

    if await _send_threshold_email(db, account, percent):
        await set_setting(db, "shared.alert_last_sent_date", datetime.now(timezone.utc).date().isoformat())

    await set_setting(db, "shared.alert_last_level", threshold)


async def notify_owner_of_removal(db: AsyncSession, file_item, actor: User) -> None:
    """
    Tell someone an administrator removed their file from the shared space.

    The notice on the page says this can happen without warning, which is the
    honest rule for a space the administrators must be able to keep clean —
    but saying nothing afterwards makes people's work disappear silently, and
    that is what costs trust. Only sent when somebody else did it.
    """
    try:
        if not file_item or not file_item.created_by or file_item.created_by == actor.id:
            return
        if not await is_shared_workspace(db, file_item.workspace_id):
            return
        owner = await db.get(User, file_item.created_by)
        if not owner or not owner.email or owner.is_system:
            return
        actor_name = actor.name or actor.email
        subject = "[Project Run : Finder] 공용 워크스페이스의 파일이 삭제되었습니다"
        html = f"""
        <div style="font-family:sans-serif;line-height:1.6">
          <h2>공용 워크스페이스 파일 삭제 안내</h2>
          <p>회원님이 공용 워크스페이스에 올린 <strong>{escape(file_item.name)}</strong> 파일을
             관리자({escape(actor_name)})가 삭제했습니다.</p>
          <p>휴지통에 있는 동안에는 관리자가 복구할 수 있습니다. 문의가 있으시면 관리자에게 연락해 주세요.</p>
        </div>
        """
        email_service.send_notification(owner.email, subject, html, f"'{file_item.name}' 파일이 삭제되었습니다.")
    except Exception as e:
        logger.error(f"[SharedPolicy] removal notice failed: {e}")
