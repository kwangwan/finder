from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import FileItem, User
from app.core.security import get_current_approved_user
from app.schemas.search import SearchRequest, SearchResponse
from app.services.search_service import search_service
from app.services.document_service import document_service

router = APIRouter(prefix="/api/search", tags=["Search"])

@router.post("", response_model=SearchResponse)
async def perform_search(
    req: SearchRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Perform hybrid similarity and keyword search across accessible documents."""
    return await search_service.search(db, req, current_user)

@router.post("/reindex-all")
async def reindex_all_files(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Re-index all files and notes in the database into pgvector (Admin only)."""
    if not current_user.is_superadmin:
        raise HTTPException(
            status_code=403,
            detail="전체 지식 베이스 재색인은 최고 관리자만 수행할 수 있습니다."
        )

    res = await db.execute(select(FileItem))
    files = res.scalars().all()
    
    indexed_count = 0
    total_chunks = 0
    for f in files:
        try:
            chunks = await document_service.index_file_chunks(db, f)
            total_chunks += chunks
            indexed_count += 1
        except Exception as e:
            print(f"[Reindex Warning] Failed to index {f.id} ({f.name}): {e}")

    return {
        "status": "success",
        "total_files": len(files),
        "indexed_files": indexed_count,
        "total_chunks": total_chunks
    }
