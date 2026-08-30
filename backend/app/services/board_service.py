import uuid
from datetime import date, datetime, timezone
from typing import Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy import Integer, and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BoardTask,
    BoardTaskAssignee,
    DocumentChunk,
    FileLink,
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
    """Name and photo per id — a face beside a name is how a row is read."""
    ids = [uid for uid in set(user_ids) if uid]
    if not ids:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {u.id: {"name": (u.username or u.name or u.email), "avatar": u.avatar_url} for u in rows}


def task_to_dict(
    task: BoardTask,
    names: dict,
    assignee_ids: Optional[dict] = None,
    board: Optional[FileItem] = None,
    documents: Optional[dict] = None,
) -> dict:
    document = (documents or {}).get(task.document_id)
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
        # The document this 할 일 opens, and whether anything has been written
        # in it yet — so a row can say so without carrying the text.
        "document_id": str(task.document_id) if task.document_id else None,
        "has_detail": bool(document is not None and (document.content or "").strip()),
        "assignees": [
            {
                "id": str(uid),
                "name": (names.get(uid) or {}).get("name", "(탈퇴한 이용자)"),
                "avatar": (names.get(uid) or {}).get("avatar"),
            }
            for uid in (assignee_ids or {}).get(task.id, [])
        ],
        "created_by": str(task.created_by) if task.created_by else None,
        "created_by_name": (names.get(task.created_by) or {}).get("name"),
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "last_edited_by_name": (names.get(task.last_edited_by) or {}).get("name"),
    }
    if board is not None:
        data["board"] = {
            "id": str(board.id),
            "name": board.name,
            "folder_id": str(board.folder_id) if board.folder_id else None,
            "workspace_id": str(board.workspace_id) if board.workspace_id else None,
        }
    return data


TASK_DOCUMENT_TYPE = "note"


def new_task_document(board: FileItem, name: str, user: User) -> FileItem:
    """
    The document a 할 일 owns, in the folder the board is in.

    An ordinary document in every respect — it is listed, searched, embedded
    and versioned like any other. The only thing it does not do is get deleted
    on its own; that happens from the 할 일 it belongs to.
    """
    return FileItem(
        name=name,
        file_type=TASK_DOCUMENT_TYPE,
        mime_type="text/markdown",
        workspace_id=board.workspace_id,
        folder_id=board.folder_id,
        created_by=user.id,
        last_edited_by=user.id,
        is_markdown=True,
        size_bytes=0,
        content="",
    )


async def documents_by_id(db: AsyncSession, ids: Iterable) -> dict:
    wanted = [i for i in set(ids) if i]
    if not wanted:
        return {}
    rows = (await db.execute(select(FileItem).where(FileItem.id.in_(wanted)))).scalars().all()
    return {row.id: row for row in rows}


async def board_task_documents(db: AsyncSession, board_id) -> List[FileItem]:
    """Every document owned by a 할 일 on this board."""
    return list((await db.execute(
        select(FileItem)
        .join(BoardTask, BoardTask.document_id == FileItem.id)
        .where(BoardTask.file_id == board_id)
    )).scalars().all())


async def move_board_documents(db: AsyncSession, board: FileItem) -> int:
    """
    A board's 할 일 documents live where the board lives.

    Moving the board and leaving them behind would scatter them into a folder
    nobody associates with the 일정 — and, worse, put them somewhere they could
    be caught by a deletion of that folder while their rows lived on.
    """
    if board.file_type != BOARD_FILE_TYPE:
        return 0
    documents = await board_task_documents(db, board.id)
    for document in documents:
        document.folder_id = board.folder_id
        document.workspace_id = board.workspace_id
    return len(documents)


async def set_board_documents_trashed(db: AsyncSession, board: FileItem, trashed: bool) -> int:
    """
    A board's 할 일 documents follow the board into the trash and back out.

    They cannot be thrown away on their own, so leaving them behind would
    leave documents nobody can reach and nobody can delete.
    """
    if board.file_type != BOARD_FILE_TYPE:
        return 0
    documents = await board_task_documents(db, board.id)
    now = datetime.now(timezone.utc)
    changed = 0
    for document in documents:
        if document.is_trashed == trashed:
            continue
        document.is_trashed = trashed
        document.trashed_at = now if trashed else None
        changed += 1
    return changed


async def trash_task_documents(db: AsyncSession, tasks: Iterable[BoardTask], user: Optional[User] = None) -> int:
    """
    Send the documents of these 할 일 to the trash.

    Not deleted outright: the document is where the work was written, and a
    row removed by accident should not take it with it for good.
    """
    ids = [t.document_id for t in tasks if t.document_id]
    if not ids:
        return 0
    documents = (await db.execute(
        select(FileItem).where(and_(FileItem.id.in_(ids), FileItem.is_trashed.is_(False)))
    )).scalars().all()
    now = datetime.now(timezone.utc)
    for document in documents:
        document.is_trashed = True
        document.trashed_at = now
        if user is not None:
            document.last_edited_by = user.id
    return len(documents)


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
    documents = await documents_by_id(db, [t.document_id for t in tasks])
    return [task_to_dict(t, names, by_task, documents=documents) for t in tasks]


async def list_workspace_tasks(
    db: AsyncSession,
    workspace_id,
    *,
    q: Optional[str] = None,
    include_done: bool = False,
    assignee_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    from_date=None,
    to_date=None,
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

    # A period filter matches anything that *overlaps* the range, not only what
    # begins or ends inside it: something running from last month to next month
    # is very much happening this week, and asking about this week and not being
    # shown it would be wrong.
    #
    # A row with only one of the two dates spans that single day.
    if from_date or to_date:
        span_start = func.coalesce(BoardTask.start_date, BoardTask.due_date)
        span_end = func.coalesce(BoardTask.due_date, BoardTask.start_date)
        conds.append(span_start.isnot(None))
        if to_date:
            conds.append(span_start <= to_date)
        if from_date:
            conds.append(span_end >= from_date)

    # Everything that matches, before grouping. Capped so one enormous
    # workspace cannot turn this into a full-table scan; the cap is far above
    # any real board and is reported so a truncated answer is never silent.
    SCAN_LIMIT = 2000
    matches = (await db.execute(
        select(BoardTask)
        .join(FileItem, FileItem.id == BoardTask.file_id)
        .where(and_(*conds))
        .limit(SCAN_LIMIT)
    )).scalars().all()

    # A sub-item belongs under the thing it is part of, always — including when
    # it has no period of its own and the parent does. So the unit being
    # ordered and paged is the top-level 할 일 together with its children, not
    # each row on its own.
    parent_ids = {t.parent_task_id for t in matches if t.parent_task_id}
    roots = {t.id: t for t in matches if not t.parent_task_id}
    missing_parents = parent_ids - set(roots)
    if missing_parents:
        # A sub-item matched but its parent did not — the parent still has to
        # come along, or the match would appear detached from what it is part of.
        for parent in (await db.execute(
            select(BoardTask).where(BoardTask.id.in_(missing_parents))
        )).scalars().all():
            roots[parent.id] = parent

    if not roots:
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 1}

    children_rows = (await db.execute(
        select(BoardTask).where(BoardTask.parent_task_id.in_(list(roots)))
    )).scalars().all()
    children_by_root = {}
    for child in children_rows:
        children_by_root.setdefault(child.parent_task_id, []).append(child)
    for group in children_by_root.values():
        group.sort(key=lambda t: (t.position, t.created_at))

    def group_key(root):
        """
        Ordered by whichever part of the group is most pressing.

        A parent with no date whose sub-item is due today belongs at the top:
        the work is due today, and which row carries the date is bookkeeping.
        """
        members = [root] + children_by_root.get(root.id, [])
        dues = [m.due_date for m in members if m.due_date]
        soonest = min(dues) if dues else None
        rank = min(PRIORITY_RANK.get(m.priority, len(PRIORITIES)) for m in members)
        return (1 if soonest is None else 0, soonest or date.max, rank, root.created_at)

    ordered = sorted(roots.values(), key=group_key)
    total = len(ordered)
    page_roots = ordered[(page - 1) * page_size: page * page_size]

    board_ids = {r.file_id for r in page_roots}
    boards = {}
    if board_ids:
        boards = {f.id: f for f in (await db.execute(
            select(FileItem).where(FileItem.id.in_(board_ids))
        )).scalars().all()}

    shown = [t for r in page_roots for t in [r] + children_by_root.get(r.id, [])]
    by_task = await assignees_by_task(db, [t.id for t in shown])
    names = await user_names(
        db,
        [t.created_by for t in shown] + [t.last_edited_by for t in shown]
        + [uid for ids in by_task.values() for uid in ids],
    )

    documents = await documents_by_id(db, [t.document_id for t in shown])

    items = []
    for root in page_roots:
        row = task_to_dict(root, names, by_task, board=boards.get(root.file_id), documents=documents)
        row["children"] = [
            task_to_dict(c, names, by_task, board=boards.get(c.file_id), documents=documents)
            for c in children_by_root.get(root.id, [])
        ]
        items.append(row)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "truncated": len(matches) >= SCAN_LIMIT,
    }


async def copy_tasks(db: AsyncSession, source_file_id, target_file_id, user: User) -> dict:
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
        return {"tasks": 0, "documents": 0, "bytes": 0}

    target_board = await db.get(FileItem, target_file_id)
    if target_board is None:
        return {"tasks": 0, "documents": 0, "bytes": 0}
    by_task = await assignees_by_task(db, [r.id for r in rows])
    sources = await documents_by_id(db, [r.document_id for r in rows])

    id_map = {}
    copied_bytes = 0
    # Parents before children, so a sub-item always finds its new parent id.
    ordered = sorted(rows, key=lambda t: (t.parent_task_id is not None, t.position))
    for task in ordered:
        new_id = uuid.uuid4()
        id_map[task.id] = new_id
        # A copied 할 일 needs a document of its own — sharing the original's
        # would mean writing in one copy showed up in the other.
        source_document = sources.get(task.document_id)
        document = new_task_document(target_board, task.name, user)
        if source_document is not None:
            document.content = source_document.content or ""
            document.size_bytes = len((document.content or "").encode("utf-8"))
        db.add(document)
        await db.flush()
        copied_bytes += document.size_bytes or 0

        # The copy has to be findable the same way the original was — a 할 일
        # document is reached through search, so an unindexed copy would be a
        # document nobody can get to. The content is identical, so the vectors
        # are cloned rather than paid for again.
        if source_document is not None and source_document.is_embedded:
            chunks = (await db.execute(
                select(DocumentChunk).where(DocumentChunk.file_id == source_document.id)
            )).scalars().all()
            for chunk in chunks:
                db.add(DocumentChunk(
                    file_id=document.id,
                    chunk_index=chunk.chunk_index,
                    content=chunk.content,
                    embedding=chunk.embedding,
                ))
            document.is_embedded = True
            document.embedded_chunks_count = len(chunks)

        # And what it had attached comes along: the copy points at the same
        # files, which is what attaching to several documents already means.
        for link in (await db.execute(
            select(FileLink).where(FileLink.document_id == source_document.id)
        )).scalars().all() if source_document is not None else []:
            db.add(FileLink(document_id=document.id, target_file_id=link.target_file_id))

        db.add(BoardTask(
            id=new_id,
            file_id=target_file_id,
            parent_task_id=id_map.get(task.parent_task_id) if task.parent_task_id else None,
            name=task.name,
            priority=task.priority,
            status=task.status,
            start_date=task.start_date,
            due_date=task.due_date,
            document_id=document.id,
            position=task.position,
            created_by=user.id,
            last_edited_by=user.id,
        ))
        for uid in by_task.get(task.id, []):
            db.add(BoardTaskAssignee(task_id=new_id, user_id=uid))
    await db.flush()
    return {"tasks": len(rows), "documents": len(rows), "bytes": copied_bytes}
