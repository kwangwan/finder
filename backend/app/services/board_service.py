import uuid
from datetime import date
from typing import Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy import Integer, and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BoardTask,
    BoardTaskAssignee,
    FileItem,
    User,
    Workspace,
)
from app.models.board import (
    BOARD_FILE_TYPE,
    DEFAULT_PRIORITY,
    DEFAULT_STATUS,
    DONE_STATUS,
    PRIORITIES,
    PRIORITY_LABELS,
    PRIORITY_RANK,
    STATUS_LABELS,
    STATUSES,
)


def priority_rank_expr():
    """
    Priority as a number the database can sort by.

    Stored as a word because that is what it means and what survives a schema
    change; ranked here because "most important first" is not alphabetical.
    """
    return case(
        {value: rank for value, rank in PRIORITY_RANK.items()},
        value=BoardTask.priority,
        else_=len(PRIORITIES),
    )


def order_by_urgency():
    """
    The default order everywhere a list of tasks is shown: soonest deadline
    first, then most important.

    A task with no deadline sorts after every dated one rather than before —
    "no date" is not "due right now", and putting them first would bury the
    things that actually are.
    """
    return [
        case((BoardTask.due_date.is_(None), 1), else_=0).cast(Integer).asc(),
        BoardTask.due_date.asc(),
        priority_rank_expr().asc(),
        BoardTask.created_at.asc(),
    ]


def validate_priority(value: Optional[str]) -> str:
    if value is None:
        return DEFAULT_PRIORITY
    if value not in PRIORITY_RANK:
        raise HTTPException(status_code=400, detail="알 수 없는 중요도입니다.")
    return value


def validate_status(value: Optional[str]) -> str:
    if value is None:
        return DEFAULT_STATUS
    if value not in STATUSES:
        raise HTTPException(status_code=400, detail="알 수 없는 진행 상태입니다.")
    return value


async def get_board(db: AsyncSession, file_id: uuid.UUID) -> FileItem:
    board = await db.get(FileItem, file_id)
    if board is None or board.is_trashed or board.file_type != BOARD_FILE_TYPE:
        raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.")
    return board


async def assignable_users(db: AsyncSession, user: User, workspace_id) -> List[User]:
    """
    Who may be put on a task here.

    In the shared workspace every registered account is a member, so anyone
    could be handed work by a stranger who found their folder. There, a person
    may only assign themselves. Elsewhere the members were chosen deliberately
    and already see each other's work, so the whole membership is offered.
    """
    is_shared = bool((await db.execute(
        select(Workspace.is_shared).where(Workspace.id == workspace_id)
    )).scalar_one_or_none())
    if is_shared:
        return [user]

    from app.models import WorkspaceMember
    rows = (await db.execute(
        select(User)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace_id, User.is_system == False)  # noqa: E712
        .order_by(User.username.asc())
    )).scalars().all()
    # The person asking is always on the list, even if membership is recorded
    # some other way (an administrator, for instance).
    if all(u.id != user.id for u in rows):
        rows = [user] + list(rows)
    return rows


async def assert_assignable(db: AsyncSession, user: User, workspace_id, user_ids: Iterable[uuid.UUID]) -> List[uuid.UUID]:
    wanted = [uid for uid in (user_ids or [])]
    if not wanted:
        return []
    allowed = {u.id for u in await assignable_users(db, user, workspace_id)}
    bad = [uid for uid in wanted if uid not in allowed]
    if bad:
        raise HTTPException(
            status_code=403,
            detail="공용 워크스페이스에서는 본인만 작업자로 지정할 수 있습니다."
            if len(allowed) == 1 and user.id in allowed
            else "이 워크스페이스의 구성원만 작업자로 지정할 수 있습니다.",
        )
    # De-duplicated, order preserved.
    seen = set()
    out = []
    for uid in wanted:
        if uid in seen:
            continue
        seen.add(uid)
        out.append(uid)
    return out


async def assignees_by_task(db: AsyncSession, task_ids: Iterable[uuid.UUID]) -> dict:
    """
    Who is on each of these tasks, in one query.

    Read explicitly rather than through the relationship: a lazily loaded
    collection triggers IO at attribute access, which on an async session is
    not allowed and fails outright the first time a freshly created task is
    serialised.
    """
    ids = [i for i in task_ids if i]
    if not ids:
        return {}
    rows = (await db.execute(
        select(BoardTaskAssignee).where(BoardTaskAssignee.task_id.in_(ids))
    )).scalars().all()
    out = {}
    for row in rows:
        out.setdefault(row.task_id, []).append(row.user_id)
    for key in out:
        out[key].sort(key=str)
    return out


async def set_assignees(db: AsyncSession, task_id: uuid.UUID, user_ids: List[uuid.UUID]) -> None:
    rows = (await db.execute(
        select(BoardTaskAssignee).where(BoardTaskAssignee.task_id == task_id)
    )).scalars().all()
    existing = {r.user_id for r in rows}
    wanted = set(user_ids)
    for row in rows:
        if row.user_id not in wanted:
            await db.delete(row)
    for uid in user_ids:
        if uid not in existing:
            db.add(BoardTaskAssignee(task_id=task_id, user_id=uid))


async def next_position(db: AsyncSession, file_id, parent_task_id) -> int:
    q = select(func.max(BoardTask.position)).where(BoardTask.file_id == file_id)
    q = q.where(BoardTask.parent_task_id.is_(None) if parent_task_id is None else BoardTask.parent_task_id == parent_task_id)
    current = (await db.execute(q)).scalar_one_or_none()
    # Sparse steps, so a row can later be dropped between two others without
    # renumbering everything after it.
    return (current or 0) + 100


async def user_names(db: AsyncSession, user_ids: Iterable[uuid.UUID]) -> dict:
    ids = [uid for uid in set(user_ids) if uid]
    if not ids:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {u.id: (u.username or u.name or u.email) for u in rows}


def task_to_dict(
    task: BoardTask,
    names: dict,
    assignee_ids: Optional[dict] = None,
    board: Optional[FileItem] = None,
    include_detail: bool = False,
) -> dict:
    today = date.today()
    data = {
        "id": str(task.id),
        "file_id": str(task.file_id),
        "parent_task_id": str(task.parent_task_id) if task.parent_task_id else None,
        "name": task.name,
        "priority": task.priority,
        "priority_label": PRIORITY_LABELS.get(task.priority, task.priority),
        "status": task.status,
        "status_label": STATUS_LABELS.get(task.status, task.status),
        "start_date": task.start_date.isoformat() if task.start_date else None,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        # Worked out here so every view agrees on what "overdue" and "soon"
        # mean, instead of each one re-deriving it from a date string.
        "days_left": (task.due_date - today).days if task.due_date else None,
        "position": task.position,
        "assignees": [
            {"id": str(uid), "name": names.get(uid, "(탈퇴한 이용자)")}
            for uid in (assignee_ids or {}).get(task.id, [])
        ],
        "created_by": str(task.created_by) if task.created_by else None,
        "created_by_name": names.get(task.created_by),
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "last_edited_by_name": names.get(task.last_edited_by),
    }
    if include_detail:
        data["detail"] = task.detail or ""
    if board is not None:
        data["board"] = {
            "id": str(board.id),
            "name": board.name,
            "folder_id": str(board.folder_id) if board.folder_id else None,
            "workspace_id": str(board.workspace_id) if board.workspace_id else None,
        }
    return data


async def list_board_tasks(db: AsyncSession, file_id: uuid.UUID) -> List[dict]:
    """Every row of one board, sub-items included, in manual order."""
    tasks = (await db.execute(
        select(BoardTask).where(BoardTask.file_id == file_id).order_by(BoardTask.position.asc(), BoardTask.created_at.asc())
    )).scalars().all()
    by_task = await assignees_by_task(db, [t.id for t in tasks])
    names = await user_names(
        db,
        [t.created_by for t in tasks] + [t.last_edited_by for t in tasks] + [uid for ids in by_task.values() for uid in ids],
    )
    return [task_to_dict(t, names, by_task) for t in tasks]


async def list_workspace_tasks(
    db: AsyncSession,
    workspace_id,
    *,
    q: Optional[str] = None,
    include_done: bool = False,
    assignee_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    page: int = 1,
    page_size: int = 30,
):
    """
    Every task in a workspace, soonest deadline first.

    Joined to the board file so a task on a trashed board disappears with it —
    the board is the task's home, and a shortcut to work inside something that
    was thrown away is noise.
    """
    page = max(1, page)
    page_size = max(1, min(100, page_size))

    conds = [
        FileItem.id == BoardTask.file_id,
        FileItem.workspace_id == workspace_id,
        FileItem.is_trashed == False,  # noqa: E712
        FileItem.file_type == BOARD_FILE_TYPE,
    ]
    if not include_done:
        conds.append(BoardTask.status != DONE_STATUS)
    if status:
        conds.append(BoardTask.status == status)
    if priority:
        conds.append(BoardTask.priority == priority)
    if q and q.strip():
        conds.append(BoardTask.name.ilike(f"%{q.strip()}%"))
    if assignee_id:
        conds.append(
            select(BoardTaskAssignee.task_id)
            .where(BoardTaskAssignee.task_id == BoardTask.id, BoardTaskAssignee.user_id == assignee_id)
            .exists()
        )

    base = select(BoardTask).join(FileItem, FileItem.id == BoardTask.file_id).where(and_(*conds))
    total = (await db.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar_one()

    tasks = (await db.execute(
        base.order_by(*order_by_urgency()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    boards = {}
    if tasks:
        rows = (await db.execute(
            select(FileItem).where(FileItem.id.in_({t.file_id for t in tasks}))
        )).scalars().all()
        boards = {f.id: f for f in rows}
    by_task = await assignees_by_task(db, [t.id for t in tasks])
    names = await user_names(db, [t.created_by for t in tasks] + [uid for ids in by_task.values() for uid in ids])

    return {
        "items": [task_to_dict(t, names, by_task, board=boards.get(t.file_id)) for t in tasks],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


async def copy_tasks(db: AsyncSession, source_file_id, target_file_id, user: User) -> int:
    """
    Reproduce a board's rows onto a copy of it.

    Without this a copied board would arrive empty, because the rows are not
    in the file record that the copy duplicates. Sub-items keep their parent by
    mapping old ids to new ones; assignments are carried over as they were.
    """
    rows = (await db.execute(
        select(BoardTask).where(BoardTask.file_id == source_file_id).order_by(BoardTask.position.asc())
    )).scalars().all()
    if not rows:
        return 0

    by_task = await assignees_by_task(db, [r.id for r in rows])
    id_map = {}
    # Parents before children, so a sub-item always finds its new parent id.
    ordered = sorted(rows, key=lambda t: (t.parent_task_id is not None, t.position))
    for task in ordered:
        new_id = uuid.uuid4()
        id_map[task.id] = new_id
        db.add(BoardTask(
            id=new_id,
            file_id=target_file_id,
            parent_task_id=id_map.get(task.parent_task_id) if task.parent_task_id else None,
            name=task.name,
            priority=task.priority,
            status=task.status,
            start_date=task.start_date,
            due_date=task.due_date,
            detail=task.detail,
            position=task.position,
            created_by=user.id,
            last_edited_by=user.id,
        ))
        for uid in by_task.get(task.id, []):
            db.add(BoardTaskAssignee(task_id=new_id, user_id=uid))
    await db.flush()
    return len(rows)
