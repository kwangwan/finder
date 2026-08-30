import asyncio
import logging
from html import escape
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import AppSetting, BoardTask, BoardTaskAssignee, FileItem, User, Workspace
from app.models.board import BOARD_FILE_TYPE, DONE_STATUS, PRIORITY_LABELS, PRIORITY_RANK
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

# Real time zones, not fixed offsets.
#
# An offset is wrong for half the year anywhere that changes its clocks — New
# York is UTC-5 in January and UTC-4 in July — and two places that share an
# offset still want to see their own name: the setting is read far more often
# than it is changed, and "한국 표준시" tells someone they got it right in a way
# "UTC+9" does not.
TIMEZONE_CHOICES = [
    ("Pacific/Midway", "미드웨이"),
    ("Pacific/Honolulu", "하와이"),
    ("America/Anchorage", "알래스카"),
    ("America/Los_Angeles", "미국 서부 (로스앤젤레스)"),
    ("America/Vancouver", "캐나다 밴쿠버"),
    ("America/Denver", "미국 산악 (덴버)"),
    ("America/Chicago", "미국 중부 (시카고)"),
    ("America/Mexico_City", "멕시코시티"),
    ("America/New_York", "미국 동부 (뉴욕)"),
    ("America/Toronto", "캐나다 토론토"),
    ("America/Bogota", "보고타"),
    ("America/Santiago", "산티아고"),
    ("America/Sao_Paulo", "상파울루"),
    ("America/Argentina/Buenos_Aires", "부에노스아이레스"),
    ("Atlantic/Azores", "아조레스"),
    ("UTC", "협정 세계시"),
    ("Europe/London", "영국 (런던)"),
    ("Europe/Lisbon", "포르투갈 (리스본)"),
    ("Europe/Paris", "프랑스 (파리)"),
    ("Europe/Berlin", "독일 (베를린)"),
    ("Europe/Madrid", "스페인 (마드리드)"),
    ("Europe/Rome", "이탈리아 (로마)"),
    ("Europe/Amsterdam", "네덜란드 (암스테르담)"),
    ("Europe/Stockholm", "스웨덴 (스톡홀름)"),
    ("Europe/Warsaw", "폴란드 (바르샤바)"),
    ("Europe/Athens", "그리스 (아테네)"),
    ("Europe/Helsinki", "핀란드 (헬싱키)"),
    ("Europe/Kyiv", "우크라이나 (키이우)"),
    ("Africa/Cairo", "이집트 (카이로)"),
    ("Africa/Johannesburg", "남아프리카공화국"),
    ("Africa/Lagos", "나이지리아 (라고스)"),
    ("Africa/Nairobi", "케냐 (나이로비)"),
    ("Europe/Moscow", "러시아 (모스크바)"),
    ("Europe/Istanbul", "튀르키예 (이스탄불)"),
    ("Asia/Riyadh", "사우디아라비아 (리야드)"),
    ("Asia/Tehran", "이란 (테헤란)"),
    ("Asia/Dubai", "아랍에미리트 (두바이)"),
    ("Asia/Karachi", "파키스탄 (카라치)"),
    ("Asia/Kolkata", "인도 (콜카타)"),
    ("Asia/Kathmandu", "네팔 (카트만두)"),
    ("Asia/Dhaka", "방글라데시 (다카)"),
    ("Asia/Yangon", "미얀마 (양곤)"),
    ("Asia/Bangkok", "태국 (방콕)"),
    ("Asia/Ho_Chi_Minh", "베트남 (호찌민)"),
    ("Asia/Jakarta", "인도네시아 (자카르타)"),
    ("Asia/Shanghai", "중국 (상하이)"),
    ("Asia/Hong_Kong", "홍콩"),
    ("Asia/Taipei", "대만 (타이베이)"),
    ("Asia/Singapore", "싱가포르"),
    ("Asia/Manila", "필리핀 (마닐라)"),
    ("Asia/Kuala_Lumpur", "말레이시아 (쿠알라룸푸르)"),
    ("Australia/Perth", "호주 서부 (퍼스)"),
    ("Asia/Seoul", "한국 표준시"),
    ("Asia/Tokyo", "일본 표준시"),
    ("Australia/Adelaide", "호주 애들레이드"),
    ("Australia/Brisbane", "호주 브리즈번"),
    ("Australia/Sydney", "호주 시드니"),
    ("Pacific/Guam", "괌"),
    ("Pacific/Noumea", "누메아"),
    ("Pacific/Auckland", "뉴질랜드 (오클랜드)"),
    ("Pacific/Fiji", "피지"),
    ("Pacific/Apia", "사모아"),
    ("Pacific/Tongatapu", "통가"),
]

DEFAULT_TIMEZONE = "Asia/Seoul"


def zone_of(name: str) -> ZoneInfo:
    """The named zone, or the default if it is one this system does not know."""
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except Exception:
        return ZoneInfo(DEFAULT_TIMEZONE)


def timezone_options() -> list:
    """Each zone with the offset it is on *today*, so the list reads correctly
    in summer and in winter rather than only in whichever one it was written."""
    now = datetime.now(timezone.utc)
    out = []
    for name, label in TIMEZONE_CHOICES:
        offset = now.astimezone(zone_of(name)).utcoffset()
        minutes = int(offset.total_seconds() // 60)
        sign = "+" if minutes >= 0 else "-"
        hh, mm = divmod(abs(minutes), 60)
        suffix = f"UTC{sign}{hh}" + (f":{mm:02d}" if mm else "")
        out.append({"value": name, "label": f"{label} ({suffix})", "minutes": minutes})
    out.sort(key=lambda o: (o["minutes"], o["label"]))
    return out


DEFAULTS = {
    "enabled": False,
    "timezone": DEFAULT_TIMEZONE,
    "send_hour": 9,
    "send_minute": 0,
    # Which horizons to include. A digest with every horizon on is a wall of
    # text; one with none is an empty mail.
    "horizons": ["today", "tomorrow", "d7", "d30"],
}

# Rolling windows, not calendar boundaries.
#
# "이번 주" and "이번 달" were the honest reading of those words, but on a Sunday
# or the last of the month they cover nothing at all, and the mail arrived
# almost empty on exactly the days someone is planning the week ahead. Counting
# forward from today always looks the same distance ahead.
HORIZONS = ["today", "tomorrow", "d7", "d30"]
HORIZON_LABELS = {
    "today": "오늘 중",
    "tomorrow": "내일 중",
    "d7": "7일 이내",
    "d30": "30일 이내",
}
HORIZON_DAYS = {"today": 0, "tomorrow": 1, "d7": 7, "d30": 30}


def _key(workspace_id) -> str:
    return f"boards.digest.{workspace_id}"


def _user_key(workspace_id, user_id) -> str:
    return f"boards.digest.{workspace_id}.user.{user_id}"


def _sent_key(workspace_id, user_id) -> str:
    return f"boards.digest.{workspace_id}.sent.{user_id}"


# What a person may decide for themselves. The reference clock is deliberately
# not among them: it is what "오늘" means, and two people on the same board
# disagreeing about which day it is would make the boards disagree too.
USER_OVERRIDABLE = ["enabled", "send_hour", "send_minute", "horizons"]


async def get_settings(db: AsyncSession, workspace_id) -> dict:
    row = (await db.execute(
        select(AppSetting).where(AppSetting.key == _key(workspace_id))
    )).scalars().first()
    data = dict(DEFAULTS)
    if row and isinstance(row.value, dict):
        data.update({k: v for k, v in row.value.items() if k in DEFAULTS})
    return data


def _clean(config: dict) -> dict:
    # An older setting stored a fixed offset. Read it once and turn it into the
    # nearest real zone, so nobody has to notice the change.
    if "utc_offset_hours" in config and not config.get("timezone"):
        legacy = {9: "Asia/Seoul", 0: "UTC", -8: "America/Los_Angeles",
                  -5: "America/New_York", 1: "Europe/Paris", 8: "Asia/Shanghai"}
        config["timezone"] = legacy.get(int(config["timezone"]), DEFAULT_TIMEZONE)
    config.pop("utc_offset_hours", None)
    known = {name for name, _ in TIMEZONE_CHOICES}
    if config.get("timezone") not in known:
        config["timezone"] = DEFAULT_TIMEZONE
    config["send_hour"] = max(0, min(23, int(config["send_hour"])))
    config["send_minute"] = max(0, min(59, int(config["send_minute"])))
    config["enabled"] = bool(config["enabled"])
    # Kept in the fixed order so the mail's sections always read nearest first,
    # whatever order they arrived in.
    chosen = {h for h in (config.get("horizons") or []) if h in HORIZON_LABELS}
    config["horizons"] = [h for h in HORIZONS if h in chosen] or list(DEFAULTS["horizons"])
    return config


async def save_settings(db: AsyncSession, workspace_id, incoming: dict) -> dict:
    """The workspace default — what someone gets before choosing anything."""
    current = await get_settings(db, workspace_id)
    current.update({k: v for k, v in incoming.items() if k in DEFAULTS})
    current = _clean(current)

    row = (await db.execute(
        select(AppSetting).where(AppSetting.key == _key(workspace_id))
    )).scalars().first()
    if row is None:
        db.add(AppSetting(key=_key(workspace_id), value=current))
    else:
        row.value = current
    await db.commit()
    return current


async def get_user_override(db: AsyncSession, workspace_id, user_id) -> dict:
    """Only the keys this person actually set; empty means "use the default"."""
    row = (await db.execute(
        select(AppSetting).where(AppSetting.key == _user_key(workspace_id, user_id))
    )).scalars().first()
    if not row or not isinstance(row.value, dict):
        return {}
    return {k: v for k, v in row.value.items() if k in USER_OVERRIDABLE}


async def save_user_override(db: AsyncSession, workspace_id, user_id, incoming: dict) -> dict:
    """
    What one person decided for themselves.

    `None` for a key means "go back to the workspace default" rather than
    "set it to nothing" — following the default afterwards is the point of
    being able to clear it.
    """
    override = await get_user_override(db, workspace_id, user_id)
    for key in USER_OVERRIDABLE:
        if key not in incoming:
            continue
        if incoming[key] is None:
            override.pop(key, None)
        else:
            override[key] = incoming[key]

    if "send_hour" in override:
        override["send_hour"] = max(0, min(23, int(override["send_hour"])))
    if "send_minute" in override:
        override["send_minute"] = max(0, min(59, int(override["send_minute"])))
    if "enabled" in override:
        override["enabled"] = bool(override["enabled"])
    if "horizons" in override:
        chosen = {h for h in (override["horizons"] or []) if h in HORIZON_LABELS}
        override["horizons"] = [h for h in HORIZONS if h in chosen]
        if not override["horizons"]:
            override.pop("horizons")

    row = (await db.execute(
        select(AppSetting).where(AppSetting.key == _user_key(workspace_id, user_id))
    )).scalars().first()
    if row is None:
        db.add(AppSetting(key=_user_key(workspace_id, user_id), value=override))
    else:
        row.value = override
    await db.commit()
    return override


async def effective_settings(db: AsyncSession, workspace_id, user_id) -> dict:
    """The workspace default with this person's own choices laid over it."""
    base = await get_settings(db, workspace_id)
    base.update(await get_user_override(db, workspace_id, user_id))
    return _clean(base)


def local_now(tz_name: str) -> datetime:
    return datetime.now(zone_of(tz_name))


def local_today(tz_name: str) -> date:
    return local_now(tz_name).date()


def horizon_bounds(today: date) -> dict:
    """The last day each horizon covers, counted forward from today."""
    return {name: today + timedelta(days=days) for name, days in HORIZON_DAYS.items()}


def bucket_of(due: date, today: date, bounds: dict) -> Optional[str]:
    """
    Which horizon a deadline belongs to — the nearest one that contains it,
    and only that one.

    The sections do not overlap: something due tomorrow appears under 내일 중
    and nowhere else. Repeating it under every wider window would make the
    same three tasks fill the mail four times over.

    Anything already late is reported under 오늘 rather than dropped: a missed
    deadline is the most urgent thing in the list, not the least.
    """
    for name in HORIZONS:
        if due <= bounds[name]:
            return name
    return None


async def collect_for_workspace(db: AsyncSession, workspace_id, config: dict) -> dict:
    """
    Everything outstanding in this workspace with a deadline inside the chosen
    horizons, grouped by the person it is assigned to.

    A task with nobody on it is left out: a digest is addressed to a person,
    and there is nobody to address it to.
    """
    today = local_today(config["timezone"])
    bounds = horizon_bounds(today)
    horizons = config["horizons"]
    furthest = max((bounds[h] for h in horizons), default=today)

    # Done is decided by the top-level 할 일: a sub-item still showing 대기
    # under a finished parent is finished with it, and a reminder about it
    # would be a reminder to do something already done.
    parent = aliased(BoardTask)
    parent_done = (
        select(parent.id)
        .where(parent.id == BoardTask.parent_task_id, parent.status == DONE_STATUS)
        .exists()
    )

    rows = (await db.execute(
        select(BoardTask, FileItem)
        .join(FileItem, FileItem.id == BoardTask.file_id)
        .where(
            FileItem.workspace_id == workspace_id,
            FileItem.is_trashed == False,          # noqa: E712
            FileItem.file_type == BOARD_FILE_TYPE,
            BoardTask.status != DONE_STATUS,
            ~parent_done,
            BoardTask.due_date.isnot(None),
            BoardTask.due_date <= furthest,
        )
    )).all()
    if not rows:
        return {}

    task_ids = [t.id for t, _f in rows]
    assignee_rows = (await db.execute(
        select(BoardTaskAssignee).where(BoardTaskAssignee.task_id.in_(task_ids))
    )).scalars().all()
    by_task = {}
    for a in assignee_rows:
        by_task.setdefault(a.task_id, []).append(a.user_id)
    if not by_task:
        return {}

    users = {
        u.id: u for u in (await db.execute(
            select(User).where(
                User.id.in_({uid for ids in by_task.values() for uid in ids}),
                User.is_system == False,  # noqa: E712
                User.is_approved == True,  # noqa: E712
            )
        )).scalars().all()
    }

    per_user = {}
    for task, board in rows:
        bucket = bucket_of(task.due_date, today, bounds)
        if bucket is None or bucket not in horizons:
            continue
        for uid in by_task.get(task.id, []):
            user = users.get(uid)
            if user is None or not user.email:
                continue
            entry = per_user.setdefault(uid, {"user": user, "buckets": {h: [] for h in horizons}})
            entry["buckets"][bucket].append({
                "name": task.name,
                "board": board.name,
                "due": task.due_date,
                "priority": task.priority,
                "overdue": task.due_date < today,
            })

    for entry in per_user.values():
        for items in entry["buckets"].values():
            items.sort(key=lambda i: (i["due"], PRIORITY_RANK.get(i["priority"], 9)))
    return per_user


WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]


def day_text(value: date) -> str:
    """The date as it gets said out loud — which weekday it is, is half of
    what a deadline means."""
    return f"{value.month}월 {value.day}일 ({WEEKDAYS[value.weekday()]})"


def render_digest(workspace_name: str, entry: dict, config: dict, today: date) -> tuple:
    buckets = entry["buckets"]
    total = sum(len(v) for v in buckets.values())
    # Everything below is written by people — a 할 일 called "a < b" would
    # otherwise break the mail, and a crafted name could put markup into one
    # sent to somebody else.
    ws_name = escape(workspace_name)
    who = escape(entry["user"].username or entry["user"].name or "")
    subject = f"[{workspace_name}] {day_text(today)} 할 일 {total}건"

    sections_html = []
    sections_text = []
    for horizon in config["horizons"]:
        items = buckets.get(horizon) or []
        if not items:
            continue
        rows_html = []
        for it in items:
            tag = "<span style=\"color:#dc2626;font-weight:700\">기한 지남 · </span>" if it["overdue"] else ""
            rows_html.append(
                f"<tr>"
                f"<td style=\"padding:6px 10px;border-bottom:1px solid #eee;word-break:break-all\">{tag}{escape(it['name'])}</td>"
                f"<td style=\"padding:6px 10px;border-bottom:1px solid #eee;color:#666;white-space:nowrap\">"
                f"{day_text(it['due'])}</td>"
                f"<td style=\"padding:6px 10px;border-bottom:1px solid #eee;color:#666;white-space:nowrap\">"
                f"{PRIORITY_LABELS.get(it['priority'], it['priority'])}</td>"
                f"<td style=\"padding:6px 10px;border-bottom:1px solid #eee;color:#888;word-break:break-all\">{escape(it['board'])}</td>"
                f"</tr>"
            )
            sections_text.append(
                f"  - {'[기한 지남] ' if it['overdue'] else ''}{it['name']} "
                f"({day_text(it['due'])}, {PRIORITY_LABELS.get(it['priority'], it['priority'])}, {it['board']})"
            )
        # Fixed columns so every section lines up with the next one: with each
        # table sizing its own, the dates and priorities sat at a different
        # place in each block and the mail read as several unrelated lists.
        sections_html.append(
            f"<h3 style=\"margin:22px 0 8px;font-size:15px\">{HORIZON_LABELS[horizon]} ({len(items)}건)</h3>"
            "<table style=\"border-collapse:collapse;width:100%;font-size:14px;table-layout:fixed\">"
            "<colgroup><col><col style=\"width:124px\"><col style=\"width:64px\">"
            "<col style=\"width:132px\"></colgroup>"
            f"{''.join(rows_html)}</table>"
        )
        sections_text.insert(len(sections_text) - len(items), f"\n[{HORIZON_LABELS[horizon]}] {len(items)}건")

    app_url = email_service.app_url
    html = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
        "max-width:640px;margin:0 auto;padding:24px;color:#111\">"
        f"<p style=\"margin:0 0 4px;color:#666;font-size:13px\">{ws_name}</p>"
        f"<h2 style=\"margin:0 0 2px;font-size:19px\">{day_text(today)} 할 일 안내</h2>"
        f"<p style=\"margin:0;color:#666;font-size:13px\">{who}님이 담당인 할 일입니다.</p>"
        + "".join(sections_html)
        + f"<p style=\"margin:24px 0 0\"><a href=\"{app_url}\" "
          "style=\"display:inline-block;padding:9px 16px;background:#3b82f6;color:#fff;"
          "border-radius:6px;text-decoration:none;font-size:14px\">일정에서 보기</a></p>"
        + "<p style=\"margin:22px 0 0;color:#999;font-size:12px\">"
          "이 메일은 회원님이 정한 시각에 하루 한 번 발송됩니다. "
          "받는 시각과 담을 기간은 일정 화면의 ‘설정’에서 바꾸거나 끌 수 있습니다.</p>"
        "</div>"
    )
    text = (
        f"[{workspace_name}] {day_text(today)} 할 일 안내\n"
        + "\n".join(sections_text)
        + f"\n\n일정에서 보기: {app_url}"
        + "\n받는 시각과 담을 기간은 일정 화면의 '설정'에서 바꾸거나 끌 수 있습니다."
    )
    return subject, html, text


def narrow_to(entry: dict, horizons) -> dict:
    """The same collection, limited to the sections one person asked for."""
    return {"user": entry["user"], "buckets": {h: entry["buckets"].get(h, []) for h in horizons}}


async def send_for_workspace(db: AsyncSession, workspace: Workspace, config: dict) -> int:
    """
    Send to whoever is due right now.

    Collected once for the workspace with every horizon, then narrowed per
    person — the times and the sections are each person's own choice, so this
    is the only place that can know whether a given mail is due.
    """
    wide = dict(config)
    wide["horizons"] = list(HORIZONS)
    per_user = await collect_for_workspace(db, workspace.id, wide)
    if not per_user:
        return 0

    today = local_today(config["timezone"])
    now_local = local_now(config["timezone"])
    sent = 0

    for uid, entry in per_user.items():
        mine = await effective_settings(db, workspace.id, uid)
        if not mine["enabled"]:
            continue
        due_at = now_local.replace(hour=mine["send_hour"], minute=mine["send_minute"], second=0, microsecond=0)
        if now_local < due_at:
            continue

        marker = (await db.execute(
            select(AppSetting).where(AppSetting.key == _sent_key(workspace.id, uid))
        )).scalars().first()
        today_str = today.isoformat()
        if marker is not None and marker.value == today_str:
            continue

        narrowed = narrow_to(entry, mine["horizons"])
        if not any(narrowed["buckets"].values()):
            continue
        subject, html, text = render_digest(workspace.name, narrowed, mine, today)
        try:
            delivered = email_service.send_notification(entry["user"].email, subject, html, text)
        except Exception as e:  # pragma: no cover - a bad address must not stop the rest
            logger.warning(f"[BoardDigest] could not send to {entry['user'].email}: {e}")
            continue
        # The marker is what stops a second copy going out today, so it is only
        # written once the mail actually left. Marking a failed send would lose
        # that person their day's reminder entirely.
        if not delivered:
            logger.warning(f"[BoardDigest] send reported failure for {entry['user'].email}; will retry")
            continue
        sent += 1

        if marker is None:
            db.add(AppSetting(key=_sent_key(workspace.id, uid), value=today_str))
        else:
            marker.value = today_str
    await db.commit()
    return sent


async def run_due_digests() -> None:
    """
    Send each workspace's digest once, at the minute its administrator chose.

    Each recipient has their own send time and their own marker: the marker
    records the local date already sent, so a restart inside the send window
    does not deliver a second copy — and a service that was down at someone's
    chosen minute still sends late that day rather than skipping it.
    """
    async with AsyncSessionLocal() as db:
        workspaces = (await db.execute(select(Workspace))).scalars().all()
        for workspace in workspaces:
            try:
                config = await get_settings(db, workspace.id)
                # Each person has their own time and their own marker, so the
                # decision of who is due now is made per recipient.
                count = await send_for_workspace(db, workspace, config)
                if count:
                    logger.info(f"[BoardDigest] sent {count} digest(s) for '{workspace.name}'")
            except Exception as e:  # pragma: no cover
                logger.error(f"[BoardDigest] workspace {workspace.id} failed: {e}")
                await db.rollback()


async def digest_loop() -> None:
    """Checks every minute; each workspace sends at most once a day."""
    while True:
        try:
            await run_due_digests()
        except Exception as e:  # pragma: no cover
            logger.error(f"[BoardDigest] loop error: {e}")
        await asyncio.sleep(60)
