import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_approved_user
from app.models import FileItem, Folder, User
from app.services import favorite_service
from app.services.access_service import access_service

router = APIRouter(prefix="/api/favorites", tags=["favorites"])

VALID_TYPES = {favorite_service.FOLDER, favorite_service.FILE}


class FavoriteToggle(BaseModel):
    target_type: str
    target_id: uuid.UUID
    is_favorite: bool = True


async def _resolve_target(db: AsyncSession, user: User, target_type: str, target_id: uuid.UUID):
    """The target, once it is established that this user may see it."""
    if target_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="즐겨찾기할 수 없는 대상입니다.")

    if target_type == favorite_service.FOLDER:
        target = await db.get(Folder, target_id)
        if target is None:
            raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다.")
        if not await access_service.can_access_folder(db, user, target_id):
            raise HTTPException(status_code=403, detail="이 폴더에 접근할 권한이 없습니다.")
    else:
        target = await db.get(FileItem, target_id)
        if target is None:
            raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
        if not await access_service.can_access_file(db, user, target_id):
            raise HTTPException(status_code=403, detail="이 파일에 접근할 권한이 없습니다.")
    return target


@router.get("")
async def list_favorites(
    workspace_id: Optional[uuid.UUID] = None,
    kind: str = Query("all", description="all | folder | file"),
    q: Optional[str] = Query(None, description="이름 검색"),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    This user's favourites — searchable and paged, because a shortcut list
    that has to be scrolled past is not a shortcut.
    """
    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
        workspace_ids = [workspace_id]
    else:
        workspace_ids = list(await access_service.get_user_workspace_ids(db, current_user.id))

    return await favorite_service.list_favorites(
        db, current_user, workspace_ids, kind=kind, q=q, page=page, page_size=page_size
    )


@router.post("")
async def toggle_favorite(
    req: FavoriteToggle,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    target = await _resolve_target(db, current_user, req.target_type, req.target_id)
    await favorite_service.set_favorite(
        db,
        user_id=current_user.id,
        target_type=req.target_type,
        target_id=req.target_id,
        workspace_id=target.workspace_id,
        on=req.is_favorite,
    )
    return {"target_type": req.target_type, "target_id": str(req.target_id), "is_favorite": req.is_favorite}


@router.get("/ids")
async def list_favorite_ids(
    kind: str = Query(favorite_service.FOLDER, description="folder | file"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Every favourited id of one kind, so a listing can draw its stars without
    asking per row. Small by nature — it is one person's shortcuts.
    """
    if kind not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="알 수 없는 대상 종류입니다.")
    page = await favorite_service.list_favorites(
        db, current_user, None, kind=kind, page=1, page_size=100
    )
    ids: List[str] = [item["id"] for item in page["items"]]
    # Beyond one page, keep asking — the list is per person, so this is short.
    while len(ids) < page["total"]:
        page = await favorite_service.list_favorites(
            db, current_user, None, kind=kind, page=page["page"] + 1, page_size=100
        )
        if not page["items"]:
            break
        ids.extend(item["id"] for item in page["items"])
    return {"kind": kind, "ids": ids}
