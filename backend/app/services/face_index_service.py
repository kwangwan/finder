"""
얼굴 색인 — 라이브러리를 한 번 훑어 얼굴을 찾아 두고, 얼굴로 찾을 수 있게 한다.

Two jobs live here. One is the sweep: work through the photographs and films
that have not been looked at yet, find the faces in each, and write them down.
The other is the question that sweep exists to answer — given one face, which
files have someone who looks like them in them.

The sweep is deliberately restartable and deliberately slow to give up. Every
file it finishes is marked, whether or not it found anything, so a photograph
of a mountain is examined once and never again; a file that fails is marked
too, because a file that cannot be decoded today will not decode tomorrow
either and retrying it forever would mean the sweep never ends.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import FaceSignature, FileItem
from app.services import face_service
from app.services.s3_service import s3_service

logger = logging.getLogger(__name__)

# A film is downloaded whole before it can be decoded — a decoder seeks, and a
# stream cannot. Past this size it is skipped rather than pulled across the
# network for twelve frames.
MAX_VIDEO_BYTES = 800 * 1024 * 1024


def _faces_for_image(data: bytes):
    return face_service.dedupe_faces(face_service.faces_in_image_bytes(data))


def _faces_for_video(path: str):
    try:
        return face_service.dedupe_faces(face_service.faces_in_video_file(path))
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


async def find_faces(file_item: FileItem) -> list:
    """
    Look at one file and come back with the faces in it.

    Touches no database: this is the slow half — a few megabytes across the
    network and then a decode — and it is run several at a time (see sweep),
    which only works while it holds nothing.
    """
    try:
        if file_item.file_type == "image":
            data = await run_in_threadpool(s3_service.get_object_content, file_item.s3_key)
            return await run_in_threadpool(_faces_for_image, data) if data else []
        if file_item.file_type == "video":
            if (file_item.size_bytes or 0) > MAX_VIDEO_BYTES:
                logger.info("[Faces] %s is too large to decode, skipped", file_item.name)
                return []
            path = await run_in_threadpool(
                face_service.write_temp_video,
                s3_service.stream_object(file_item.s3_key),
            )
            return await run_in_threadpool(_faces_for_video, path)
    except Exception as e:
        # An image this decoder cannot read is not going to become readable,
        # so the file is still marked as looked at by the caller — otherwise
        # every future sweep would start by failing on it again.
        logger.warning("[Faces] %s could not be examined: %s", file_item.name, e)
    return []


async def record_faces(db: AsyncSession, file_item: FileItem, found: list) -> int:
    """Write down what was found, replacing anything found before."""
    await db.execute(delete(FaceSignature).where(FaceSignature.file_id == file_item.id))
    for face in found:
        db.add(FaceSignature(
            file_id=file_item.id,
            workspace_id=file_item.workspace_id,
            embedding=face["embedding"],
            box_x=face["box"][0], box_y=face["box"][1],
            box_w=face["box"][2], box_h=face["box"][3],
            det_score=face["score"],
            frame_time=face.get("frame_time"),
        ))
    file_item.faces_scanned_at = datetime.now(timezone.utc)
    return len(found)


async def scan_file(db: AsyncSession, file_item: FileItem) -> int:
    """One file, looked at and written down."""
    return await record_faces(db, file_item, await find_faces(file_item))


async def pending_count(db: AsyncSession, workspace_id=None) -> int:
    conditions = [
        FileItem.file_type.in_(("image", "video")),
        FileItem.is_trashed == False,  # noqa: E712
        FileItem.s3_key.isnot(None),
        FileItem.faces_scanned_at.is_(None),
    ]
    if workspace_id:
        conditions.append(FileItem.workspace_id == workspace_id)
    return (await db.execute(select(func.count(FileItem.id)).where(*conditions))).scalar_one()


async def sweep(batch_size: int = 8, limit: Optional[int] = None, workspace_id=None) -> dict:
    """
    Work through everything not yet looked at, a batch at a time.

    Its own sessions, one per batch, so a long sweep never holds a connection
    open for an hour and a failure costs one batch rather than the run.
    """
    scanned = faces = 0
    started = datetime.now(timezone.utc)
    while True:
        if limit is not None and scanned >= limit:
            break
        async with AsyncSessionLocal() as db:
            conditions = [
                FileItem.file_type.in_(("image", "video")),
                FileItem.is_trashed == False,  # noqa: E712
                FileItem.s3_key.isnot(None),
                FileItem.faces_scanned_at.is_(None),
            ]
            if workspace_id:
                conditions.append(FileItem.workspace_id == workspace_id)
            take = batch_size if limit is None else min(batch_size, limit - scanned)
            batch = (await db.execute(
                select(FileItem).where(*conditions).order_by(FileItem.file_type, FileItem.id).limit(take)
            )).scalars().all()
            if not batch:
                break

            # Nearly all of the time here is spent waiting for storage: a
            # photograph is a few megabytes and finding the faces in it takes
            # about fifty milliseconds. Fetched several at a time, the sweep
            # stops being a queue of downloads and becomes what it should be,
            # which is the decoder working flat out.
            results = await asyncio.gather(*(find_faces(f) for f in batch))
            for file_item, found in zip(batch, results):
                faces += await record_faces(db, file_item, found)
                scanned += 1
            await db.commit()
        await asyncio.sleep(0)   # let the rest of the app breathe between batches

    return {
        "scanned": scanned,
        "faces": faces,
        "seconds": (datetime.now(timezone.utc) - started).total_seconds(),
    }


# How alike two faces have to be before this app will say they are the same
# person. SFace's own guidance is 0.363 cosine *distance*; as a similarity on
# unit vectors that is about 0.64. Held a little above it here, because in a
# family library the cost of a stranger appearing in a search is higher than
# the cost of missing one photograph — the missing one is still findable by
# date, and the stranger is just wrong.
SAME_PERSON_SIMILARITY = 0.66


async def similar_faces(
    db: AsyncSession,
    embedding,
    workspace_id,
    *,
    threshold: float = SAME_PERSON_SIMILARITY,
    limit: int = 500,
):
    """
    Every face in this workspace close enough to be the same person.

    Ordered by the database, using the cosine index: `<=>` is cosine distance,
    so similarity is one minus it. The work stays in Postgres because pulling
    twelve thousand vectors into Python to sort them there would be both
    slower and pointless.
    """
    rows = (await db.execute(
        text("""
            SELECT s.id, s.file_id, s.box_x, s.box_y, s.box_w, s.box_h,
                   s.frame_time, 1 - (s.embedding <=> CAST(:vec AS vector)) AS similarity
            FROM kb_face_signatures s
            JOIN kb_files f ON f.id = s.file_id
            WHERE s.workspace_id = :ws
              AND f.is_trashed = FALSE
              AND 1 - (s.embedding <=> CAST(:vec AS vector)) >= :threshold
            ORDER BY s.embedding <=> CAST(:vec AS vector)
            LIMIT :limit
        """),
        {"vec": str(list(embedding)), "ws": str(workspace_id),
         "threshold": threshold, "limit": limit},
    )).all()
    return rows
