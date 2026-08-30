import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base

# A board is a FileItem with this type: it lives in a folder, and so it moves,
# copies, trashes, restores, is favourited and is found by search exactly the
# way a document does, without any of that being written a second time.
BOARD_FILE_TYPE = "board"

# Ordered most urgent first. The rank is what the "soonest deadline, then most
# important" sort actually orders by, so it lives next to the values rather
# than being rebuilt at each call site.
PRIORITIES = ["urgent", "high", "normal", "low"]
PRIORITY_LABELS = {"urgent": "긴급", "high": "높음", "normal": "보통", "low": "낮음"}
PRIORITY_RANK = {value: i for i, value in enumerate(PRIORITIES)}
DEFAULT_PRIORITY = "normal"

STATUSES = ["todo", "in_progress", "review", "done", "hold"]
STATUS_LABELS = {
    "todo": "대기",
    "in_progress": "진행 중",
    "review": "검토",
    "done": "완료",
    "hold": "보류",
}
DEFAULT_STATUS = "todo"
# The one status that means "no longer waiting on anyone", so a list of what is
# outstanding can leave it out.
DONE_STATUS = "done"


class BoardTask(Base):
    """
    One row on a board, or one sub-item of a row.

    Kept in its own table rather than as JSON inside the board file, because
    the sidebar answers "everything across this workspace, soonest deadline
    first" — a question the database has to be able to sort and page, not one
    that can be answered by parsing every board on the client.
    """

    __tablename__ = "kb_board_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The board this belongs to. CASCADE: a board is the task's only home, and
    # deleting the file for good has to take its rows with it.
    file_id = Column(UUID(as_uuid=True), ForeignKey("kb_files.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_task_id = Column(UUID(as_uuid=True), ForeignKey("kb_board_tasks.id", ondelete="CASCADE"), nullable=True, index=True)

    name = Column(String(500), nullable=False)
    priority = Column(String(16), nullable=False, default=DEFAULT_PRIORITY)
    status = Column(String(16), nullable=False, default=DEFAULT_STATUS)
    # A period, not a single day. Work usually runs from one date to another,
    # and only the end was recordable. `due_date` stays the end of it — it is
    # what "how urgent is this" is measured against, and what everything
    # already sorts by.
    #
    # Dates, not timestamps: a deadline is a day, and storing it as an instant
    # makes it shift across time zones for no reason.
    start_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    # Every 할 일 has a document of its own, created with it. The notes, the
    # attachments, the version history and everything else a document can do
    # are then simply what a document does — none of it rebuilt here. Deleting
    # the 할 일 takes the document with it, and the document cannot be deleted
    # on its own, so this never points at nothing while the 할 일 is alive.
    document_id = Column(UUID(as_uuid=True), ForeignKey("kb_files.id", ondelete="SET NULL"), nullable=True, unique=True)
    # Manual order within a parent. Sparse, so a row can be dropped between two
    # others without renumbering the rest.
    position = Column(Integer, nullable=False, default=0)

    created_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    last_edited_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # No relationship for assignees on purpose: reading one lazily is IO at
    # attribute-access time, which an async session cannot do, and it failed
    # the first time a freshly created task was serialised. They are read with
    # an explicit query; the database's own CASCADE removes them with the task.

    __table_args__ = (
        # The workspace-wide list orders by deadline then priority, and the
        # board view reads one board at a time.
        Index("ix_board_task_due", "due_date", "priority"),
        Index("ix_board_task_file_parent", "file_id", "parent_task_id", "position"),
    )


class BoardTaskAssignee(Base):
    """Who is on a task. Its own table because a task can have several."""

    __tablename__ = "kb_board_task_assignees"

    task_id = Column(UUID(as_uuid=True), ForeignKey("kb_board_tasks.id", ondelete="CASCADE"), primary_key=True)
    # SET NULL is not available on a primary key, so a closed account's rows
    # are removed with it — an assignment to nobody is not worth keeping, and
    # the task itself is untouched.
    user_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("task_id", "user_id", name="uq_board_task_assignee"),
    )

