import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import AppSetting, BoardTask, BoardTaskAssignee, FileItem, User, Workspace
from app.models.board import BOARD_FILE_TYPE, DONE_STATUS, PRIORITY_LABELS, PRIORITY_RANK
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

# Offsets from UTC that a person would actually choose, as (value, label). Kept
# to a list rather than a free number so a typo cannot silently move everyone's
# idea of "today" by nine hours.
TIMEZONE_CHOICES = [
    {"value": 9, "label": "한국 표준시 (UTC+9)"},
    {"value": 0, "label": "협정 세계시 (UTC)"},
    {"value": -8, "label": "미국 서부 (UTC-8)"},
    {"value": -5, "label": "미국 동부 (UTC-5)"},
    {"value": 1, "label": "중부 유럽 (UTC+1)"},
    {"value": 8, "label": "중국·싱가포르 (UTC+8)"},
]

DEFAULTS = {
    "enabled": False,
    "utc_offset_hours": 9,
    "send_hour": 9,
    "send_minute": 0,
    # Which horizons to include. A digest with every horizon on is a wall of
    # text; one with none is an empty mail.
    "horizons": ["today", "tomorrow", "week", "month"],
}

HORIZON_LABELS = {
    "today": "오늘 중",
    "tomorrow": "내일 중",
    "week": "이번 주 중",
    "month": "이번 달 중",
}


def _key(workspace_id) -> str:
    return f"boards.digest.{workspace_id}"


def _sent_key(workspace_id) -> str:
    return f"boards.digest.{workspace_id}.last_sent_on"


async def get_settings(db: AsyncSession, workspace_id) -> dict:
    row = (await db.execute(
        select(AppSetting).where(AppSetting.key == _key(workspace_id))
    )).scalars().first()
    data = dict(DEFAULTS)
    if row and isinstance(row.value, dict):
        data.update({k: v for k, v in row.value.items() if k in DEFAULTS})
    return data


async def save_settings(db: AsyncSession, workspace_id, incoming: dict) -> dict:
    current = await get_settings(db, workspace_id)
    current.update({k: v for k, v in incoming.items() if k in DEFAULTS})

    current["utc_offset_hours"] = int(current["utc_offset_hours"])
    current["send_hour"] = max(0, min(23, int(current["send_hour"])))
    current["send_minute"] = max(0, min(59, int(current["send_minute"])))
    current["enabled"] = bool(current["enabled"])
    horizons = [h for h in (current.get("horizons") or []) if h in HORIZON_LABELS]
    current["horizons"] = horizons or list(DEFAULTS["horizons"])

    row = (await db.execute(
        select(AppSetting).where(AppSetting.key == _key(workspace_id))
    )).scalars().first()
    if row is None:
        db.add(AppSetting(key=_key(workspace_id), value=current))
    else:
        row.value = current
    await db.commit()
    return current


def local_today(utc_offset_hours: int) -> date:
    return (datetime.now(timezone.utc) + timedelta(hours=utc_offset_hours)).date()


def horizon_bounds(today: date) -> dict:
    """
    The last day each horizon covers.

    "This week" ends on the coming Sunday and "this month" on the last of the
    month — a horizon is a real calendar boundary, not "seven days from now".
    Someone reading "이번 주 중" means the week they are in.
    """
    week_end = today + timedelta(days=(6 - today.weekday()))
    if today.month == 12:
        month_end = date(today.year, 12, 31)
    else:
        month_end = date(today.year, today.month + 1, 1) - timedelta(days=1)
    return {
        "today": today,
        "tomorrow": today + timedelta(days=1),
        "week": week_end,
        "month": month_end,
    }


def bucket_of(due: date, today: date, bounds: dict) -> Optional[str]:
    """
    Which horizon a deadline belongs to — the nearest one that contains it.

    Anything already late is reported under 오늘 rather than dropped: a missed
    deadline is the most urgent thing in the list, not the least.
    """
    if due <= bounds["today"]:
        return "today"
    if due <= bounds["tomorrow"]:
        return "tomorrow"
    if due <= bounds["week"]:
        return "week"
    if due <= bounds["month"]:
        return "month"
    return None


async def collect_for_workspace(db: AsyncSession, workspace_id, config: dict) -> dict:
    """
    Everything outstanding in this workspace with a deadline inside the chosen
    horizons, grouped by the person it is assigned to.

    A task with nobody on it is left out: a digest is addressed to a person,
    and there is nobody to address it to.
    """
    today = local_today(config["utc_offset_hours"])
    bounds = horizon_bounds(today)
    horizons = config["horizons"]
    furthest = max((bounds[h] for h in horizons), default=today)

    rows = (await db.execute(
        select(BoardTask, FileItem)
        .join(FileItem, FileItem.id == BoardTask.file_id)
        .where(
            FileItem.workspace_id == workspace_id,
            FileItem.is_trashed == False,          # noqa: E712
            FileItem.file_type == BOARD_FILE_TYPE,
            BoardTask.status != DONE_STATUS,
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


def render_digest(workspace_name: str, entry: dict, config: dict, today: date) -> tuple:
    buckets = entry["buckets"]
    total = sum(len(v) for v in buckets.values())
    subject = f"[{workspace_name}] 오늘 확인할 일정 {total}건"

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
                f"<td style=\"padding:6px 10px;border-bottom:1px solid #eee\">{tag}{it['name']}</td>"
                f"<td style=\"padding:6px 10px;border-bottom:1px solid #eee;color:#666;white-space:nowrap\">"
                f"{it['due'].month}월 {it['due'].day}일</td>"
                f"<td style=\"padding:6px 10px;border-bottom:1px solid #eee;color:#666;white-space:nowrap\">"
                f"{PRIORITY_LABELS.get(it['priority'], it['priority'])}</td>"
                f"<td style=\"padding:6px 10px;border-bottom:1px solid #eee;color:#888\">{it['board']}</td>"
                f"</tr>"
            )
            sections_text.append(
                f"  - {'[기한 지남] ' if it['overdue'] else ''}{it['name']} "
                f"({it['due'].month}/{it['due'].day}, {PRIORITY_LABELS.get(it['priority'], it['priority'])}, {it['board']})"
            )
        sections_html.append(
            f"<h3 style=\"margin:22px 0 8px;font-size:15px\">{HORIZON_LABELS[horizon]} ({len(items)}건)</h3>"
            f"<table style=\"border-collapse:collapse;width:100%;font-size:14px\">{''.join(rows_html)}</table>"
        )
        sections_text.insert(len(sections_text) - len(items), f"\n[{HORIZON_LABELS[horizon]}] {len(items)}건")

    html = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
        "max-width:640px;margin:0 auto;padding:24px;color:#111\">"
        f"<p style=\"margin:0 0 4px;color:#666;font-size:13px\">{workspace_name}</p>"
        f"<h2 style=\"margin:0 0 2px;font-size:19px\">{today.month}월 {today.day}일 일정 안내</h2>"
        f"<p style=\"margin:0;color:#666;font-size:13px\">{entry['user'].username or entry['user'].name or ''}님께 배정된 작업입니다.</p>"
        + "".join(sections_html)
        + "<p style=\"margin:26px 0 0;color:#999;font-size:12px\">"
          "이 메일은 워크스페이스 관리자가 설정한 시각에 자동으로 발송됩니다.</p>"
        "</div>"
    )
    text = f"[{workspace_name}] {today.month}월 {today.day}일 일정 안내\n" + "\n".join(sections_text)
    return subject, html, text


async def send_for_workspace(db: AsyncSession, workspace: Workspace, config: dict) -> int:
    per_user = await collect_for_workspace(db, workspace.id, config)
    if not per_user:
        return 0
    today = local_today(config["utc_offset_hours"])
    sent = 0
    for entry in per_user.values():
        if not any(entry["buckets"].values()):
            continue
        subject, html, text = render_digest(workspace.name, entry, config, today)
        try:
            if email_service.send_notification(entry["user"].email, subject, html, text):
                sent += 1
        except Exception as e:  # pragma: no cover - a bad address must not stop the rest
            logger.warning(f"[BoardDigest] could not send to {entry['user'].email}: {e}")
    return sent


async def run_due_digests() -> None:
    """
    Send each workspace's digest once, at the minute its administrator chose.

    The marker records the local date already sent, so a restart inside the
    send window does not deliver a second copy — and a service that was down
    at the chosen minute still sends late that day rather than skipping it.
    """
    async with AsyncSessionLocal() as db:
        workspaces = (await db.execute(select(Workspace))).scalars().all()
        for workspace in workspaces:
            try:
                config = await get_settings(db, workspace.id)
                if not config["enabled"]:
                    continue
                now_local = datetime.now(timezone.utc) + timedelta(hours=config["utc_offset_hours"])
                due_at = now_local.replace(
                    hour=config["send_hour"], minute=config["send_minute"], second=0, microsecond=0
                )
                if now_local < due_at:
                    continue

                marker = (await db.execute(
                    select(AppSetting).where(AppSetting.key == _sent_key(workspace.id))
                )).scalars().first()
                today_str = now_local.date().isoformat()
                if marker is not None and marker.value == today_str:
                    continue

                count = await send_for_workspace(db, workspace, config)
                if marker is None:
                    db.add(AppSetting(key=_sent_key(workspace.id), value=today_str))
                else:
                    marker.value = today_str
                await db.commit()
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
