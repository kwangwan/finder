import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import CopyJob, DocumentChunk, FileItem, Folder, User
from app.services.s3_service import s3_service, build_storage_key
from app.services.quota_service import quota_service
from app.services import folder_limit_service
from app.services import board_service
from app.models.board import BOARD_FILE_TYPE

logger = logging.getLogger(__name__)


# Guards a folder copy against a pre-existing parent cycle in the tree, which
# would otherwise recurse until the process dies. Far above any real nesting.
MAX_COPY_DEPTH = 40


async def _unique_copy_name(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    folder_id: Optional[uuid.UUID],
    name: str,
    is_folder: bool,
) -> str:
    """
    Give a pasted item a name that does not collide in its destination.

    Files may legitimately share a name in this app, but a copy landing beside
    its own original with an identical name is indistinguishable from it, so
    pasting into the source folder would look like nothing happened. Folders
    additionally must not collide at all. Only renames on an actual collision,
    so pasting into a different folder keeps the original name.
    """
    model = Folder if is_folder else FileItem
    parent_col = Folder.parent_id if is_folder else FileItem.folder_id

    existing = set((await db.execute(
        select(model.name).where(
            model.workspace_id == workspace_id,
            parent_col == folder_id if folder_id else parent_col.is_(None),
            model.is_trashed == False,  # noqa: E712
        )
    )).scalars().all())

    if name not in existing:
        return name

    stem, dot, ext = name.rpartition(".")
    if not dot or is_folder:
        stem, ext = name, ""
    suffix = f".{ext}" if ext else ""

    for n in range(2, 1000):
        label = "복사본" if n == 2 else f"복사본 {n - 1}"
        candidate = f"{stem} - {label}{suffix}"
        if candidate not in existing:
            return candidate
    return f"{stem} - 복사본 {uuid.uuid4().hex[:6]}{suffix}"


async def _copy_one_file(
    db: AsyncSession,
    src: FileItem,
    target_folder_id: Optional[uuid.UUID],
    workspace_id: uuid.UUID,
    user: User,
    rename: bool,
) -> Optional[FileItem]:
    """
    Duplicate one file into target_folder_id. Returns the new row, or None if
    the stored object could not be copied — in which case no row is created,
    since a FileItem pointing at a missing key is worse than a skipped file.
    """
    new_id = uuid.uuid4()
    new_key = None

    if src.s3_key:
        new_key = build_storage_key("uploads", new_id, src.name)
        ok = await run_in_threadpool(s3_service.copy_object, src.s3_key, new_key)
        if not ok:
            return None

    new_thumb_key = None
    if src.thumbnail_s3_key:
        new_thumb_key = build_storage_key("thumbnails", new_id, "thumb.jpg")
        # A thumbnail is regenerable, so failing to copy it is not worth
        # failing the whole paste over — the copy just falls back to an icon.
        if not await run_in_threadpool(s3_service.copy_object, src.thumbnail_s3_key, new_thumb_key):
            new_thumb_key = None

    name = await _unique_copy_name(db, workspace_id, target_folder_id, src.name, is_folder=False) if rename else src.name

    copy = FileItem(
        id=new_id,
        name=name,
        folder_id=target_folder_id,
        workspace_id=workspace_id,
        # The copy is a new object in its destination, so the person who made
        # it there is its uploader. Across workspaces this matters: the
        # destination's members should see who brought the file in, not
        # someone who may not even be a member there.
        created_by=user.id,
        last_edited_by=user.id,
        file_type=src.file_type,
        mime_type=src.mime_type,
        size_bytes=src.size_bytes,
        s3_key=new_key,
        thumbnail_s3_key=new_thumb_key,
        content=src.content,
        is_markdown=src.is_markdown,
        tags=list(src.tags or []),
        # Deliberately not carried over: is_favorite (a copy is not the item
        # the user starred) and the trash flags (a copy is always live).
        taken_at=src.taken_at,
        gps_latitude=src.gps_latitude,
        gps_longitude=src.gps_longitude,
        camera_make=src.camera_make,
        camera_model=src.camera_model,
        media_width=src.media_width,
        media_height=src.media_height,
        media_scanned_at=src.media_scanned_at,
    )
    db.add(copy)
    await db.flush()

    # Clone the embeddings rather than leaving the copy unindexed. The content
    # is byte-identical, so the vectors are too — recomputing them would cost
    # an embedding call per chunk to arrive at the same numbers, and leaving
    # them off would make the copy silently unfindable by search.
    if src.is_embedded:
        chunks = (await db.execute(
            select(DocumentChunk).where(DocumentChunk.file_id == src.id)
        )).scalars().all()
        for ch in chunks:
            db.add(DocumentChunk(
                file_id=copy.id,
                chunk_index=ch.chunk_index,
                content=ch.content,
                embedding=ch.embedding,
            ))
        copy.is_embedded = True
        copy.embedded_chunks_count = len(chunks)

    # A board's rows are not in the file record, so a copy would otherwise
    # arrive as an empty board.
    if src.file_type == BOARD_FILE_TYPE:
        await board_service.copy_tasks(db, src.id, copy.id, user)

    return copy


async def _copy_folder_recursive(
    db: AsyncSession,
    src: Folder,
    target_parent_id: Optional[uuid.UUID],
    workspace_id: uuid.UUID,
    user: User,
    rename: bool,
    depth: int,
    counters: dict,
) -> None:
    if depth > MAX_COPY_DEPTH:
        return

    # The destination answers to the same ceiling a person creating folders by
    # hand does. A copy that does not fit is skipped rather than aborted: the
    # rest of the job is still worth doing, and the count is reported back.
    if not await folder_limit_service.has_room(db, workspace_id, target_parent_id):
        counters["skipped"] += 1
        return

    name = await _unique_copy_name(db, workspace_id, target_parent_id, src.name, is_folder=True) if rename else src.name
    new_folder = Folder(
        id=uuid.uuid4(),
        name=name,
        parent_id=target_parent_id,
        workspace_id=workspace_id,
        created_by=user.id,
        icon=src.icon,
        color=src.color,
    )
    db.add(new_folder)
    await db.flush()
    counters["folders"] += 1

    child_files = (await db.execute(
        select(FileItem).where(FileItem.folder_id == src.id, FileItem.is_trashed == False)  # noqa: E712
    )).scalars().all()
    for f in child_files:
        # Names inside a freshly created folder cannot collide with anything.
        if await _copy_one_file(db, f, new_folder.id, workspace_id, user, rename=False):
            counters["files"] += 1
            counters["bytes"] += f.size_bytes or 0
        else:
            counters["skipped"] += 1
        # Same yield as the top-level loop: a deep tree must not copy in one
        # uninterrupted burst and starve live requests of threadpool slots.
        counters["since_yield"] = counters.get("since_yield", 0) + 1
        if counters["since_yield"] >= COPY_YIELD_EVERY_FILES:
            counters["since_yield"] = 0
            await asyncio.sleep(COPY_YIELD_SECONDS)

    child_folders = (await db.execute(
        select(Folder).where(Folder.parent_id == src.id, Folder.is_trashed == False)  # noqa: E712
    )).scalars().all()
    for sub in child_folders:
        await _copy_folder_recursive(db, sub, new_folder.id, workspace_id, user, False, depth + 1, counters)


async def _descendant_folder_ids(db: AsyncSession, folder_id: uuid.UUID) -> set:
    """Every folder at or below folder_id, used to reject pasting a folder into itself."""
    seen = {folder_id}
    frontier = [folder_id]
    while frontier:
        rows = (await db.execute(
            select(Folder.id).where(Folder.parent_id.in_(frontier), Folder.is_trashed == False)  # noqa: E712
        )).scalars().all()
        frontier = [r for r in rows if r not in seen]
        seen.update(frontier)
    return seen


# How long a finished job stays readable, so a client that was closed when it
# completed can still come back and see the outcome.
JOB_RETENTION_HOURS = 48
WORKER_IDLE_SECONDS = 2.0

# --- Load limits -------------------------------------------------------------
# The worker shares this process with every API request, and each file copy
# occupies a threadpool slot that ordinary requests (uploads, downloads,
# previews) also draw from. These keep a large copy from crowding them out.
#
# One job at a time is the main protection: copies are storage-bound, so
# running several concurrently would contend for the same MinIO connections
# and finish no sooner while making every live request slower.
#
# Within a job, the worker pauses briefly every few files. That is not a
# throughput limit so much as a yield — it hands the threadpool and the event
# loop back regularly instead of queueing hundreds of copy_object calls ahead
# of whatever a user is actively waiting on.
COPY_YIELD_EVERY_FILES = 10
COPY_YIELD_SECONDS = 0.25

# A user cannot stack up unbounded work. Well above any normal use; it exists
# so a runaway client (or an impatient double-click) cannot fill the queue.
MAX_PENDING_JOBS_PER_USER = 5


async def collect_source_bytes(db: AsyncSession, src_files, src_folders) -> tuple:
    """Total files and bytes a job will write, for the up-front quota check and
    for showing progress as a fraction rather than an ever-rising count."""
    from app.routers.folders import _collect_folder_files_recursive
    total_files = len(src_files)
    total_bytes = sum(f.size_bytes or 0 for f in src_files)
    for folder in src_folders:
        for f, _ in await _collect_folder_files_recursive(db, folder.id):
            total_files += 1
            total_bytes += f.size_bytes or 0
    return total_files, total_bytes


class CopyService:
    """
    Runs queued copy/move jobs, one at a time, in the background.

    Sequential on purpose: copies are storage-bound, and several large folder
    trees duplicating at once would contend for the same MinIO connection pool
    and make every one of them slower without finishing any sooner. A queue
    also gives a natural place to show progress and to survive the browser
    going away mid-copy.
    """

    def __init__(self):
        self._worker_task = None
        self._stop_event = asyncio.Event()

    async def pending_job_count(self, db: AsyncSession, user_id) -> int:
        from sqlalchemy import func
        return (await db.execute(
            select(func.count(CopyJob.id)).where(
                CopyJob.user_id == user_id,
                CopyJob.status.in_(("pending", "running")),
            )
        )).scalar_one() or 0

    async def enqueue(
        self,
        db: AsyncSession,
        user: User,
        *,
        source_workspace_id,
        target_workspace_id,
        target_folder_id,
        file_ids: List[uuid.UUID],
        folder_ids: List[uuid.UUID],
        trash_source: bool,
        total_files: int,
        total_bytes: int,
        skipped_cycles: int,
        summary: str,
    ) -> CopyJob:
        job = CopyJob(
            user_id=user.id,
            source_workspace_id=source_workspace_id,
            target_workspace_id=target_workspace_id,
            target_folder_id=target_folder_id,
            file_ids=[str(i) for i in file_ids],
            folder_ids=[str(i) for i in folder_ids],
            trash_source=trash_source,
            total_files=total_files,
            total_bytes=total_bytes,
            skipped_cycles=skipped_cycles,
            summary=summary,
            status="pending",
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        return job

    async def _claim_next(self) -> Optional[uuid.UUID]:
        """Take the oldest pending job. Marking it running in its own
        transaction means a restart mid-job leaves it visible as running
        rather than silently re-running from the start."""
        async with AsyncSessionLocal() as db:
            job = (await db.execute(
                select(CopyJob).where(CopyJob.status == "pending").order_by(CopyJob.created_at.asc()).limit(1)
            )).scalar_one_or_none()
            if not job:
                return None
            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            await db.commit()
            return job.id

    async def _run_job(self, job_id: uuid.UUID) -> None:
        async with AsyncSessionLocal() as db:
            job = await db.get(CopyJob, job_id)
            if not job:
                return
            user = await db.get(User, job.user_id)
            if not user:
                job.status = "failed"
                job.error_message = "작업을 요청한 사용자를 찾을 수 없습니다."
                job.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return

            counters = {"files": 0, "folders": 0, "skipped": 0, "bytes": 0}
            try:
                src_files = []
                if job.file_ids:
                    ids = [uuid.UUID(i) for i in job.file_ids]
                    src_files = (await db.execute(
                        select(FileItem).where(
                            FileItem.id.in_(ids),
                            FileItem.workspace_id == job.source_workspace_id,
                            FileItem.is_trashed == False,  # noqa: E712
                        )
                    )).scalars().all()

                src_folders = []
                for fid in (job.folder_ids or []):
                    folder = await db.get(Folder, uuid.UUID(fid))
                    if folder and not folder.is_trashed and folder.workspace_id == job.source_workspace_id:
                        src_folders.append(folder)

                cancelled = False
                processed = 0
                for f in src_files:
                    await db.refresh(job, ["status"])
                    if job.status == "cancelling":
                        cancelled = True
                        break
                    ok = await _copy_one_file(db, f, job.target_folder_id, job.target_workspace_id, user, rename=True)
                    if ok:
                        counters["files"] += 1
                        counters["bytes"] += f.size_bytes or 0
                    else:
                        counters["skipped"] += 1
                    # Progress is committed as it goes, so a client polling
                    # mid-job sees real movement instead of nothing until the end.
                    job.copied_files = counters["files"]
                    job.copied_bytes = counters["bytes"]
                    job.skipped = counters["skipped"]
                    await db.commit()
                    processed += 1
                    if processed % COPY_YIELD_EVERY_FILES == 0:
                        await asyncio.sleep(COPY_YIELD_SECONDS)

                for folder in src_folders:
                    if not cancelled:
                        await db.refresh(job, ["status"])
                        if job.status == "cancelling":
                            cancelled = True
                    if cancelled:
                        break
                    await _copy_folder_recursive(db, folder, job.target_folder_id, job.target_workspace_id, user, True, 0, counters)
                    job.copied_files = counters["files"]
                    job.copied_folders = counters["folders"]
                    job.copied_bytes = counters["bytes"]
                    job.skipped = counters["skipped"]
                    await db.commit()

                await quota_service.record_storage_added(db, job.target_workspace_id, user, counters["bytes"])

                # A cancelled move must NOT trash the originals: only part of
                # the selection reached the destination, so removing the
                # sources would lose whatever had not been copied yet.
                if cancelled:
                    job.status = "cancelled"
                    job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.info(f"[CopyWorker] job {job_id} cancelled after {counters['files']} file(s)")
                    return

                # The move half, only once the copy has committed: if it failed
                # the originals must still be there.
                if job.trash_source and (counters["files"] or counters["folders"]):
                    from app.routers.folders import _set_folder_trash_recursive
                    now = datetime.now(timezone.utc)
                    for f in src_files:
                        f.is_trashed = True
                        f.trashed_at = now
                        job.trashed_files += 1
                    for folder in src_folders:
                        await _set_folder_trash_recursive(db, folder, is_trashed=True, trashed_at=now)
                        job.trashed_folders += 1

                job.status = "done"
                job.finished_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info(f"[CopyWorker] job {job_id} done: {counters}")
            except Exception as e:
                await db.rollback()
                # Re-read: the failed transaction rolled the row back too.
                job = await db.get(CopyJob, job_id)
                if job:
                    job.status = "failed"
                    job.error_message = str(e)[:1000]
                    job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                logger.error(f"[CopyWorker] job {job_id} failed: {e}")

    async def _worker_loop(self):
        logger.info("[CopyWorker] Background copy worker started.")
        while not self._stop_event.is_set():
            try:
                job_id = await self._claim_next()
                if job_id:
                    await self._run_job(job_id)
                    continue  # straight on to the next without idling
            except Exception as e:
                logger.error(f"[CopyWorker] queue error: {e}")
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=WORKER_IDLE_SECONDS)
            except asyncio.TimeoutError:
                pass
        logger.info("[CopyWorker] Background copy worker stopped.")

    async def requeue_orphans(self):
        """A job left 'running' by a restart is nobody's work any more — put it
        back so it is retried rather than sitting there forever."""
        async with AsyncSessionLocal() as db:
            stale = (await db.execute(
                select(CopyJob).where(CopyJob.status.in_(("running", "cancelling")))
            )).scalars().all()
            for job in stale:
                # A job the user had asked to stop must not be resurrected by a
                # restart — honour the cancellation instead of re-running it.
                if job.status == "cancelling":
                    job.status = "cancelled"
                    job.finished_at = datetime.now(timezone.utc)
                else:
                    job.status = "pending"
                    job.started_at = None
            if stale:
                await db.commit()
                logger.info(f"[CopyWorker] requeued {len(stale)} interrupted job(s)")

    def start_worker(self):
        if self._worker_task is None or self._worker_task.done():
            self._stop_event.clear()
            self._worker_task = asyncio.create_task(self._worker_loop())

    async def stop_worker(self):
        self._stop_event.set()
        if self._worker_task:
            try:
                await asyncio.wait_for(self._worker_task, timeout=10.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            self._worker_task = None


copy_service = CopyService()
