import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_approved_user, get_current_admin_user
from app.models import ContentReport, FileItem, User, Folder
from app.services.access_service import access_service

router = APIRouter(prefix="/api/reports", tags=["Content Reports"])

REASONS = {
    "inappropriate": "부적절한 내용",
    "copyright": "저작권 침해",
    "personal_info": "개인정보 노출",
    "spam": "스팸 또는 광고",
    "other": "기타",
}


class CreateReportRequest(BaseModel):
    file_id: uuid.UUID
    reason: str = Field(..., max_length=64)
    detail: Optional[str] = Field(None, max_length=2000)


@router.post("", status_code=201)
async def create_report(
    req: CreateReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Report something that does not belong in a shared space.

    Anyone who can see the file can report it, and reporting never removes
    anything on its own — it puts the item in a queue an administrator works
    through. Reporting has to be easy enough that people actually use it,
    which is exactly why it cannot be trusted to delete.
    """
    if req.reason not in REASONS:
        raise HTTPException(status_code=400, detail="알 수 없는 신고 사유입니다.")

    file_item = await db.get(FileItem, req.file_id)
    if not file_item or file_item.is_trashed:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    if not await access_service.can_access_file(db, current_user, req.file_id):
        raise HTTPException(status_code=403, detail="이 파일에 접근할 권한이 없습니다.")

    # One open report per person per file: a second one adds nothing for the
    # administrator and lets one person inflate a queue.
    existing = (await db.execute(
        select(ContentReport).where(
            ContentReport.file_id == req.file_id,
            ContentReport.reporter_id == current_user.id,
            ContentReport.status == "pending",
        )
    )).scalar_one_or_none()
    if existing:
        return {"id": str(existing.id), "status": existing.status, "already_reported": True}

    report = ContentReport(
        file_id=req.file_id,
        reporter_id=current_user.id,
        reason=req.reason,
        detail=(req.detail or "").strip() or None,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return {"id": str(report.id), "status": report.status, "already_reported": False}


@router.get("/reasons")
async def list_reasons(current_user: User = Depends(get_current_approved_user)):
    return {"reasons": [{"value": k, "label": v} for k, v in REASONS.items()]}


@router.get("/pending-count")
async def pending_count(
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user)
):
    """Just the number, for the sidebar badge."""
    n = (await db.execute(
        select(func.count(ContentReport.id)).where(ContentReport.status == "pending")
    )).scalar_one() or 0
    return {"pending": n}


@router.get("")
async def list_reports(
    status_filter: str = Query("pending", alias="status"),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user)
):
    """The review queue, with enough of each file to judge it without leaving."""
    stmt = select(ContentReport).order_by(desc(ContentReport.created_at)).limit(limit)
    if status_filter != "all":
        stmt = stmt.where(ContentReport.status == status_filter)
    reports = (await db.execute(stmt)).scalars().all()

    file_ids = {r.file_id for r in reports}
    user_ids = {r.reporter_id for r in reports if r.reporter_id}
    files = {f.id: f for f in (await db.execute(select(FileItem).where(FileItem.id.in_(file_ids)))).scalars().all()} if file_ids else {}
    user_ids |= {f.created_by for f in files.values() if f.created_by}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()} if user_ids else {}
    folder_ids = {f.folder_id for f in files.values() if f.folder_id}
    folders = {f.id: f for f in (await db.execute(select(Folder).where(Folder.id.in_(folder_ids)))).scalars().all()} if folder_ids else {}

    def row(r):
        f = files.get(r.file_id)
        reporter = users.get(r.reporter_id) if r.reporter_id else None
        owner = users.get(f.created_by) if f and f.created_by else None
        folder = folders.get(f.folder_id) if f and f.folder_id else None
        return {
            "id": str(r.id),
            "status": r.status,
            "reason": r.reason,
            "reason_label": REASONS.get(r.reason, r.reason),
            "detail": r.detail,
            "created_at": r.created_at,
            "resolution": r.resolution,
            "admin_note": r.admin_note,
            "reporter": (reporter.username or reporter.name or reporter.email) if reporter else "(탈퇴한 이용자)",
            "file": None if not f else {
                "id": str(f.id),
                "name": f.name,
                "file_type": f.file_type,
                "size_bytes": f.size_bytes,
                "is_trashed": f.is_trashed,
                "workspace_id": str(f.workspace_id) if f.workspace_id else None,
                "folder_id": str(f.folder_id) if f.folder_id else None,
                "folder_name": folder.name if folder else None,
                "uploader": (owner.username or owner.name or owner.email) if owner else "(탈퇴한 이용자)",
                "thumbnail_url": f"/api/storage/thumbnail/{f.id}" if f.thumbnail_s3_key else None,
                "content_preview": (f.content or "")[:400] if f.is_markdown else None,
            },
        }

    return {"reports": [row(r) for r in reports]}


class ResolveRequest(BaseModel):
    action: str                       # "delete" | "dismiss"
    note: Optional[str] = Field(None, max_length=1000)


@router.put("/{report_id}/resolve")
async def resolve_report(
    report_id: uuid.UUID,
    req: ResolveRequest,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user)
):
    """
    Act on a report: remove the file, or decide it is fine.

    Removal is to the trash, not a permanent delete — the same rule the rest of
    the product follows, so a judgement call made from a queue is recoverable.
    Every report on the same file is closed together, since they all describe
    the one decision just made.
    """
    report = await db.get(ContentReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="신고를 찾을 수 없습니다.")
    if req.action not in ("delete", "dismiss"):
        raise HTTPException(status_code=400, detail="알 수 없는 처리입니다.")

    file_item = await db.get(FileItem, report.file_id)
    if req.action == "delete" and file_item and not file_item.is_trashed:
        file_item.is_trashed = True
        file_item.trashed_at = datetime.now(timezone.utc)
        await db.commit()
        try:
            from app.services import shared_policy_service
            await shared_policy_service.notify_owner_of_removal(db, file_item, admin_user)
        except Exception:
            pass

    siblings = (await db.execute(
        select(ContentReport).where(
            ContentReport.file_id == report.file_id,
            ContentReport.status == "pending",
        )
    )).scalars().all()
    now = datetime.now(timezone.utc)
    for r in siblings:
        r.status = "resolved" if req.action == "delete" else "dismissed"
        r.resolution = req.action
        r.resolved_by = admin_user.id
        r.resolved_at = now
        r.admin_note = (req.note or "").strip() or None
    await db.commit()
    return {"ok": True, "closed": len(siblings), "action": req.action}
