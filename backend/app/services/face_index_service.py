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
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import FaceSignature, FileItem
from app.services import face_service
from app.services.s3_service import s3_service

logger = logging.getLogger(__name__)



def _faces_for_image(data: bytes):
    return face_service.dedupe_faces(face_service.faces_in_image_bytes(data))


def _faces_for_video(source: str):
    return face_service.dedupe_faces(face_service.faces_in_video(source))


def _faces_for_downloaded_video(path: str):
    try:
        return _faces_for_video(path)
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
            # Read where it lies. The decoder asks for the byte ranges holding
            # the keyframes it wants, so a film is looked at without being
            # fetched — which is what removed the size limit that had been
            # skipping the fourteen largest films in the library outright.
            url = await run_in_threadpool(
                s3_service.internal_presigned_get_url, file_item.s3_key
            )
            if url:
                found = await run_in_threadpool(_faces_for_video, url)
                if found:
                    return found
            # Storage that will not sign, or a container the decoder cannot
            # read over the network: fall back to having the whole file.
            path = await run_in_threadpool(
                face_service.write_temp_video,
                s3_service.stream_object(file_item.s3_key),
            )
            return await run_in_threadpool(_faces_for_downloaded_video, path)
    except Exception as e:
        # An image this decoder cannot read is not going to become readable,
        # so the file is still marked as looked at by the caller — otherwise
        # every future sweep would start by failing on it again.
        logger.warning("[Faces] %s could not be examined: %s", file_item.name, e)
    return []


async def record_faces(db: AsyncSession, file_item: FileItem, found: list) -> int:
    """
    Write down what was found, replacing anything found before.

    The file is marked with a statement rather than by setting the attribute,
    because the file it is handed has deliberately been detached from the
    session that read it (see sweep) and an attribute set on a detached row
    would quietly never be saved.
    """
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
    await db.execute(
        update(FileItem)
        .where(FileItem.id == file_item.id)
        .values(faces_scanned_at=datetime.now(timezone.utc))
    )
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

    Three sessions rather than one, and that division is the point. Choosing a
    batch is a read; fetching and decoding it takes minutes; writing it down is
    a write. Done in one session the read's transaction stays open across the
    whole minute, which means a lock held on the files table for a minute —
    harmless on its own, but an ALTER TABLE arriving behind it waits, and every
    query arriving behind *that* waits too, because the lock queue is in order.
    A deploy during a sweep was enough to take the whole app down that way.

    So the read ends before the slow part begins, and the rows are carried
    across detached.
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
            # Detach first, then end the transaction: expunged rows keep the
            # values already loaded, which is all the slow part needs.
            db.expunge_all()
            await db.rollback()
        if not batch:
            break

        # No session is held here, and that is deliberate — this is the minute.
        # Nearly all of it is spent waiting for storage: a photograph is a few
        # megabytes and finding the faces in it takes about fifty milliseconds.
        # Fetched several at a time, the sweep stops being a queue of downloads
        # and becomes what it should be, which is the decoder working flat out.
        results = await asyncio.gather(*(find_faces(f) for f in batch))

        async with AsyncSessionLocal() as db:
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
# unit vectors that is about 0.64. Held a little above it here, because a
# stranger turning up in a search is worse than a photograph missing from one:
# the missing one is still findable by date, and the stranger is just wrong.
SAME_PERSON_SIMILARITY = 0.66

# Reaching from one face to the next. Higher than the threshold above, because
# a step taken from a face that was itself only a guess is where a search
# starts drifting into other people — each link has to be surer than the first
# one was.
LINK_SIMILARITY = 0.70

# How many of the surest matches are stepped from, and how far each one reaches.
EXPAND_FROM = 24
REACH_PER_FACE = 40


# Every face this one leads to, directly or through a face it is sure of.
#
# One photograph of a person is one angle of them. Search with a profile and
# the frontal photographs of the same person fall below any threshold worth
# having — not because the threshold is wrong, but because the question was
# asked with half the evidence. This is what made the search feel accurate and
# forgetful at once: what it found was right, and it kept missing the rest.
#
# So it asks twice. The faces it is surest of become questions in their own
# right, and what they find is folded in. A profile is close to a
# three-quarter view, which is close to a frontal one; none of those steps is a
# guess, and together they cross a distance no single comparison could. Each
# step has to be surer than the first (LINK_SIMILARITY), and the reach is
# limited, because the same chaining that chases one person around six years
# will wander into another person if it is let run.
#
# A result's score is the product along the path it was reached by, so a face
# found directly always outranks one reached through somebody, and a face
# reached through a weak link ranks below one reached through a strong one.
_SIMILAR_FACES = """
    WITH direct AS (
        SELECT s.id, s.file_id, s.box_x, s.box_y, s.box_w, s.box_h, s.frame_time,
               s.embedding,
               1 - (s.embedding <=> CAST(:vec AS vector)) AS score,
               0 AS steps
        FROM kb_face_signatures s
        JOIN kb_files f ON f.id = s.file_id
        WHERE s.workspace_id = :ws
          AND f.is_trashed = FALSE
          AND 1 - (s.embedding <=> CAST(:vec AS vector)) >= :threshold
        -- No ORDER BY and no LIMIT here, deliberately. Written with them,
        -- Postgres answers this from the HNSW index, and an HNSW scan returns
        -- what its walk happened to visit — hnsw.ef_search rows, not every row
        -- that satisfies the filter. The count then depends on which plan was
        -- chosen, which is how the same search returned three hundred files one
        -- way and a hundred and fifty the other. A filter without an ordering
        -- is an exact scan, and "every face this close" is an exact question.
    ),
    seed AS (
        SELECT embedding, score FROM direct ORDER BY score DESC LIMIT :fan
    ),
    reached AS (
        SELECT n.id, n.file_id, n.box_x, n.box_y, n.box_w, n.box_h, n.frame_time,
               seed.score * (1 - (n.embedding <=> seed.embedding)) AS score,
               1 AS steps
        FROM seed
        CROSS JOIN LATERAL (
            SELECT o.id, o.file_id, o.box_x, o.box_y, o.box_w, o.box_h,
                   o.frame_time, o.embedding
            FROM kb_face_signatures o
            JOIN kb_files f2 ON f2.id = o.file_id
            WHERE o.workspace_id = :ws
              AND f2.is_trashed = FALSE
              AND 1 - (o.embedding <=> seed.embedding) >= :link
            -- Bounded by how sure the step has to be rather than by a row
            -- count, for the same reason. What this costs is a pass over the
            -- workspace's faces per seed; on a library many times this size
            -- the seeds are what to reduce, not the exactness.
        ) n
    ),
    best AS (
        SELECT DISTINCT ON (id)
               id, file_id, box_x, box_y, box_w, box_h, frame_time, score, steps
        FROM (
            SELECT id, file_id, box_x, box_y, box_w, box_h, frame_time, score, steps FROM direct
            UNION ALL
            SELECT id, file_id, box_x, box_y, box_w, box_h, frame_time, score, steps FROM reached
        ) every_face
        ORDER BY id, steps ASC, score DESC
    )
    SELECT id, file_id, box_x, box_y, box_w, box_h, frame_time, score AS similarity
    FROM best
    -- Whatever it found before, it still finds. The cap is a cap on the
    -- answer's size, and if it is spent on faces reached through somebody
    -- else, a face that answered the question directly falls off the end —
    -- which would make this a trade rather than an improvement.
    ORDER BY steps ASC, similarity DESC
    LIMIT :limit
"""


async def similar_faces(
    db: AsyncSession,
    embedding,
    workspace_id,
    *,
    threshold: float = SAME_PERSON_SIMILARITY,
    limit: int = 4000,
):
    """
    Every face in this workspace that is the same person as this one.

    The work stays in Postgres, on the cosine index: pulling twelve thousand
    vectors into Python to sort them there would be both slower and pointless.
    """
    rows = (await db.execute(
        text(_SIMILAR_FACES),
        {
            "vec": str(list(embedding)),
            "ws": str(workspace_id),
            "threshold": threshold,
            "link": LINK_SIMILARITY,
            "fan": EXPAND_FROM,
            "per_seed": REACH_PER_FACE,
            "limit": limit,
        },
    )).all()
    return rows
