import uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_approved_user
from app.models import BoardTask, FileItem, Folder, User
from app.models.board import (
    BOARD_FILE_TYPE,
    PRIORITIES,
    PRIORITY_LABELS,
    STATUSES,
    STATUS_LABELS,
)
from app.services import board_service
from app.services.access_service import access_service

router = APIRouter(prefix="/api/boards", tags=["boards"])


class TaskCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)
    parent_task_id: Optional[uuid.UUID] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[date] = None
    detail: Optional[str] = None
    assignee_ids: Optional[List[uuid.UUID]] = None


class TaskUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=500)
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[date] = None
    detail: Optional[str] = None
    assignee_ids: Optional[List[uuid.UUID]] = None
    position: Optional[int] = None


async def _require_read(db: AsyncSession, user: User, board: FileItem) -> None:
    if not await access_service.can_access_file(db, user, board.id):
        raise HTTPException(status_code=403, detail="이 일정에 접근할 권한이 없습니다.")


async def _require_write(db: AsyncSession, user: User, board: FileItem) -> None:
    await _require_read(db, user, board)
    # Editing a board is a change inside the folder that holds it, so it obeys
    # the same rule as anything else there.
    await access_service.require_write_at(db, user, board.workspace_id, board.folder_id)


@router.get("/meta")
async def board_meta(current_user: User = Depends(get_current_approved_user)):
    """The fixed vocabularies, so the client never hardcodes its own copy."""
    return {
        "priorities": [{"value": v, "label": PRIORITY_LABELS[v]} for v in PRIORITIES],
        "statuses": [{"value": v, "label": STATUS_LABELS[v]} for v in STATUSES],
    }


@router.get("/tasks")
async def list_workspace_tasks(
    workspace_id: uuid.UUID,
    q: Optional[str] = None,
    include_done: bool = False,
    assignee_id: Optional[uuid.UUID] = None,
    task_status: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Every task in the workspace, soonest deadline first then most important.

    Completed work is left out unless asked for: this is the list of what is
    still outstanding, and a finished task is not.
    """
    if not await access_service.is_workspace_member(db, current_user, workspace_id):
        raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
    return await board_service.list_workspace_tasks(
        db, workspace_id,
        q=q, include_done=include_done, assignee_id=assignee_id,
        status=task_status, priority=priority, page=page, page_size=page_size,
    )


class BoardCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    workspace_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_board(
    req: BoardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Create a board.

    It is a file, so it is created where files are created and obeys the same
    rules — the folder decides who may make one, and from then on it moves,
    copies, is trashed and is found exactly like a document.
    """
    if req.workspace_id and not await access_service.is_workspace_member(db, current_user, req.workspace_id):
        raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")
    await access_service.require_write_at(db, current_user, req.workspace_id, req.folder_id)

    if req.folder_id is not None:
        folder = await db.get(Folder, req.folder_id)
        if folder is None or folder.is_trashed:
            raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다.")
        if req.workspace_id and folder.workspace_id and folder.workspace_id != req.workspace_id:
            raise HTTPException(status_code=400, detail="폴더와 워크스페이스가 일치하지 않습니다.")

    board = FileItem(
        name=req.name.strip(),
        file_type=BOARD_FILE_TYPE,
        workspace_id=req.workspace_id,
        folder_id=req.folder_id,
        created_by=current_user.id,
        last_edited_by=current_user.id,
        is_markdown=False,
        size_bytes=0,
        content=None,
    )
    db.add(board)
    await db.commit()
    await db.refresh(board)
    return {
        "id": str(board.id),
        "name": board.name,
        "file_type": board.file_type,
        "folder_id": str(board.folder_id) if board.folder_id else None,
        "workspace_id": str(board.workspace_id) if board.workspace_id else None,
        "created_at": board.created_at,
        "updated_at": board.updated_at,
    }


@router.get("/{file_id}")
async def get_board(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    board = await board_service.get_board(db, file_id)
    await _require_read(db, current_user, board)
    can_write = await access_service.can_write_at(db, current_user, board.workspace_id, board.folder_id)
    members = await board_service.assignable_users(db, current_user, board.workspace_id)
    return {
        "id": str(board.id),
        "name": board.name,
        "folder_id": str(board.folder_id) if board.folder_id else None,
        "workspace_id": str(board.workspace_id) if board.workspace_id else None,
        "can_write": can_write,
        "assignable_users": [
            {"id": str(u.id), "name": (u.username or u.name or u.email)} for u in members
        ],
        "tasks": await board_service.list_board_tasks(db, file_id),
    }


@router.get("/{file_id}/tasks/{task_id}")
async def get_task(
    file_id: uuid.UUID,
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """One task with its notes — fetched separately so a board listing does not
    carry every task's full detail."""
    board = await board_service.get_board(db, file_id)
    await _require_read(db, current_user, board)
    task = await db.get(BoardTask, task_id)
    if task is None or task.file_id != file_id:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    by_task = await board_service.assignees_by_task(db, [task.id])
    names = await board_service.user_names(db, [task.created_by] + by_task.get(task.id, []))
    return board_service.task_to_dict(task, names, by_task, board=board, include_detail=True)


@router.post("/{file_id}/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(
    file_id: uuid.UUID,
    req: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    board = await board_service.get_board(db, file_id)
    await _require_write(db, current_user, board)

    if req.parent_task_id is not None:
        parent = await db.get(BoardTask, req.parent_task_id)
        if parent is None or parent.file_id != file_id:
            raise HTTPException(status_code=404, detail="상위 작업을 찾을 수 없습니다.")
        # One level of sub-items. Deeper nesting turns a board into a tree that
        # cannot be read at a glance, which is the point of a board.
        if parent.parent_task_id is not None:
            raise HTTPException(status_code=400, detail="하위 작업 아래에는 다시 하위 작업을 만들 수 없습니다.")

    assignees = await board_service.assert_assignable(db, current_user, board.workspace_id, req.assignee_ids)
    task = BoardTask(
        file_id=file_id,
        parent_task_id=req.parent_task_id,
        name=req.name.strip(),
        priority=board_service.validate_priority(req.priority),
        status=board_service.validate_status(req.status),
        due_date=req.due_date,
        detail=req.detail,
        position=await board_service.next_position(db, file_id, req.parent_task_id),
        created_by=current_user.id,
        last_edited_by=current_user.id,
    )
    db.add(task)
    await db.flush()
    await board_service.set_assignees(db, task.id, assignees)
    await db.commit()
    await db.refresh(task)
    names = await board_service.user_names(db, [task.created_by] + assignees)
    return board_service.task_to_dict(task, names, {task.id: assignees}, include_detail=True)


@router.put("/{file_id}/tasks/{task_id}")
async def update_task(
    file_id: uuid.UUID,
    task_id: uuid.UUID,
    req: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    board = await board_service.get_board(db, file_id)
    await _require_write(db, current_user, board)
    task = await db.get(BoardTask, task_id)
    if task is None or task.file_id != file_id:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")

    sent = req.model_fields_set
    if "name" in sent and req.name is not None:
        task.name = req.name.strip()
    if "priority" in sent:
        task.priority = board_service.validate_priority(req.priority)
    if "status" in sent:
        task.status = board_service.validate_status(req.status)
    # `due_date: null` means "no deadline", which is a real choice and has to
    # be distinguishable from not sending the field at all.
    if "due_date" in sent:
        task.due_date = req.due_date
    if "detail" in sent:
        task.detail = req.detail
    if "position" in sent and req.position is not None:
        task.position = req.position
    if "assignee_ids" in sent:
        assignees = await board_service.assert_assignable(db, current_user, board.workspace_id, req.assignee_ids)
        await board_service.set_assignees(db, task.id, assignees)

    task.last_edited_by = current_user.id
    await db.commit()
    await db.refresh(task)
    by_task = await board_service.assignees_by_task(db, [task.id])
    names = await board_service.user_names(db, [task.created_by] + by_task.get(task.id, []))
    return board_service.task_to_dict(task, names, by_task, include_detail=True)


@router.delete("/{file_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    file_id: uuid.UUID,
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Remove a task and its sub-items.

    Deleted outright rather than moved to the trash: a row on a board is not a
    file, there is nowhere for it to sit, and the board it belongs to is itself
    recoverable from the trash if the whole thing was a mistake.
    """
    board = await board_service.get_board(db, file_id)
    await _require_write(db, current_user, board)
    task = await db.get(BoardTask, task_id)
    if task is None or task.file_id != file_id:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")

    children = (await db.execute(
        select(BoardTask).where(BoardTask.parent_task_id == task_id)
    )).scalars().all()
    for child in children:
        await db.delete(child)
    await db.delete(task)
    await db.commit()
    return None
