from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, and_, or_
import uuid
import httpx
from typing import Optional
from app.core.database import get_db
from app.core.config import settings
from app.models import Folder, FileItem, DocumentChunk, User
from app.core.security import get_current_approved_user
from app.services.access_service import access_service
from app.services.s3_service import s3_service

router = APIRouter(prefix="/api/system", tags=["System & Stats"])

@router.get("/stats")
async def get_system_stats(
    workspace_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Get system stats for folders, notes, files, chunks, storage.
    - If workspace_id is provided, verifies user's membership.
    - If workspace_id is omitted:
        - Admin users see global stats across the system.
        - Non-admin users see aggregate stats across only their accessible workspaces.
    """
    folder_conditions = [Folder.is_trashed == False]
    file_conditions = [FileItem.is_trashed == False]

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        folder_conditions.append(Folder.workspace_id == workspace_id)
        file_conditions.append(FileItem.workspace_id == workspace_id)
    elif not current_user.is_superadmin:
        ws_ids = await access_service.get_user_workspace_ids(db, current_user.id)
        if ws_ids:
            folder_conditions.append(or_(
                Folder.workspace_id.in_(list(ws_ids)),
                and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id)
            ))
            file_conditions.append(or_(
                FileItem.workspace_id.in_(list(ws_ids)),
                and_(FileItem.workspace_id.is_(None), FileItem.created_by == current_user.id)
            ))
        else:
            folder_conditions.append(and_(Folder.workspace_id.is_(None), Folder.created_by == current_user.id))
            file_conditions.append(and_(FileItem.workspace_id.is_(None), FileItem.created_by == current_user.id))

    folder_count = (await db.execute(select(func.count(Folder.id)).where(and_(*folder_conditions)))).scalar_one_or_none() or 0
    total_files = (await db.execute(select(func.count(FileItem.id)).where(and_(*file_conditions)))).scalar_one_or_none() or 0
    note_count = (await db.execute(select(func.count(FileItem.id)).where(and_(*file_conditions, FileItem.is_markdown == True)))).scalar_one_or_none() or 0
    
    # Isolated chunk count
    chunk_stmt = select(func.count(DocumentChunk.id)).join(FileItem, DocumentChunk.file_id == FileItem.id).where(and_(*file_conditions))
    chunk_count = (await db.execute(chunk_stmt)).scalar_one_or_none() or 0
    
    total_bytes = (await db.execute(select(func.sum(FileItem.size_bytes)).where(and_(*file_conditions)))).scalar_one_or_none() or 0

    return {
        "folder_count": folder_count,
        "total_files": total_files,
        "note_count": note_count,
        "uploaded_files_count": total_files - note_count,
        "chunk_count": chunk_count,
        "total_size_bytes": total_bytes or 0,
        "max_chunk_size_mb": settings.MINIO_MAX_CHUNK_SIZE_MB,
        "embedding_model": settings.OPENWEBUI_EMBEDDING_MODEL
    }

@router.get("/health")
async def get_health_status(db: AsyncSession = Depends(get_db)):
    """Health check for PostgreSQL, MinIO, and OpenWebUI."""
    # DB
    db_status = "ok"
    try:
        await db.execute(text("SELECT 1;"))
    except Exception as e:
        db_status = f"error: {str(e)}"

    # OpenWebUI
    openwebui_status = "unknown"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            headers = {}
            if settings.OPENWEBUI_API_KEY:
                headers["Authorization"] = f"Bearer {settings.OPENWEBUI_API_KEY}"
            r = await client.get(f"{settings.OPENWEBUI_URL.rstrip('/')}/api/models", headers=headers)
            openwebui_status = "ok" if r.status_code == 200 else f"status {r.status_code}"
    except Exception as e:
        openwebui_status = f"unreachable ({e.__class__.__name__})"

    return {
        "status": "healthy" if db_status == "ok" else "degraded",
        "services": {
            "database": db_status,
            "openwebui": openwebui_status,
            "minio_configured_url": settings.MINIO_PUBLIC_URL
        },
        "version": settings.APP_VERSION
    }
