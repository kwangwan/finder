import asyncio
import logging
from datetime import datetime
from typing import List, Optional
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import AsyncSessionLocal
from app.models import DeletionQueueItem, FileItem, Folder
from app.services.s3_service import s3_service
from app.services.quota_service import quota_service

logger = logging.getLogger("deletion_service")

class DeletionService:
    def __init__(self):
        self._stop_event = asyncio.Event()
        self._worker_task: Optional[asyncio.Task] = None

    async def enqueue_file(self, db: AsyncSession, file_item: FileItem) -> DeletionQueueItem:
        """Enqueue a single file for asynchronous permanent deletion."""
        queue_item = DeletionQueueItem(
            s3_key=file_item.s3_key,
            thumbnail_s3_key=file_item.thumbnail_s3_key,
            file_size_bytes=file_item.size_bytes or 0,
            workspace_id=file_item.workspace_id,
            created_by=file_item.created_by,
            status="pending"
        )
        db.add(queue_item)
        return queue_item

    async def enqueue_files_batch(self, db: AsyncSession, file_items: List[FileItem]):
        """Enqueue a list of files for asynchronous permanent deletion."""
        for f in file_items:
            db.add(DeletionQueueItem(
                s3_key=f.s3_key,
                thumbnail_s3_key=f.thumbnail_s3_key,
                file_size_bytes=f.size_bytes or 0,
                workspace_id=f.workspace_id,
                created_by=f.created_by,
                status="pending"
            ))

    async def enqueue_folder_recursive(self, db: AsyncSession, folder: Folder):
        """Recursively collect and enqueue all files in a folder for deletion."""
        # 1. Enqueue all files directly under this folder
        files_res = await db.execute(select(FileItem).where(FileItem.folder_id == folder.id))
        files = files_res.scalars().all()
        for f in files:
            await self.enqueue_file(db, f)
            # Reclaim quota immediately in DB
            await quota_service.record_storage_freed(
                db=db,
                workspace_id=f.workspace_id,
                creator_id=f.created_by,
                bytes_freed=f.size_bytes or 0
            )
            await db.delete(f)

        # 2. Recurse into subfolders
        children_res = await db.execute(select(Folder).where(Folder.parent_id == folder.id))
        for child in children_res.scalars().all():
            await self.enqueue_folder_recursive(db, child)

        await db.delete(folder)

    async def process_batch(self, batch_size: int = 100) -> int:
        """Process a batch of pending deletion queue items."""
        async with AsyncSessionLocal() as db:
            # Select pending or retryable failed items
            q = select(DeletionQueueItem).where(
                and_(
                    DeletionQueueItem.status.in_(["pending", "failed"]),
                    DeletionQueueItem.retry_count < 5
                )
            ).order_by(DeletionQueueItem.created_at.asc()).limit(batch_size)

            res = await db.execute(q)
            items = res.scalars().all()

            if not items:
                return 0

            # Mark as processing
            for item in items:
                item.status = "processing"
            await db.commit()

            # Process deletions
            deleted_ids = []
            for item in items:
                try:
                    # 1. Delete main file from S3 & local cache
                    if item.s3_key:
                        s3_service.delete_object(item.s3_key)

                    # 2. Delete thumbnail from S3 & local cache
                    if item.thumbnail_s3_key:
                        s3_service.delete_object(item.thumbnail_s3_key)

                    deleted_ids.append(item.id)
                except Exception as e:
                    logger.warning(f"Error deleting S3 object for queue item {item.id}: {e}")
                    item.status = "failed"
                    item.retry_count += 1
                    item.error_message = str(e)[:500]
                    item.updated_at = datetime.utcnow()

            # Delete successfully processed queue items
            if deleted_ids:
                await db.execute(
                    delete(DeletionQueueItem).where(DeletionQueueItem.id.in_(deleted_ids))
                )

            await db.commit()
            return len(deleted_ids)

    async def _worker_loop(self):
        """Continuous background worker loop that runs every 3 seconds."""
        logger.info("[Deletion Worker] Background deletion worker started.")
        while not self._stop_event.is_set():
            try:
                processed_count = await self.process_batch(batch_size=100)
                if processed_count > 0:
                    logger.info(f"[Deletion Worker] Purged {processed_count} files from storage.")
            except Exception as e:
                logger.error(f"[Deletion Worker] Error processing deletion queue: {e}")

            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                pass

        logger.info("[Deletion Worker] Background deletion worker stopped.")

    def start_worker(self):
        """Start the async background worker task."""
        if self._worker_task is None or self._worker_task.done():
            self._stop_event.clear()
            self._worker_task = asyncio.create_task(self._worker_loop())

    async def stop_worker(self):
        """Gracefully stop the background worker task."""
        self._stop_event.set()
        if self._worker_task:
            try:
                await asyncio.wait_for(self._worker_task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            self._worker_task = None

deletion_service = DeletionService()
