"""
갤러리 — 워크스페이스의 사진과 영상을, 찍은 때와 찍은 곳으로 본다.

A photo library is not a file list. What someone wants from it is "that trip",
"that summer", "who was there" — so the three questions this answers are when,
where, and (once faces are indexed) who, and every one of them has to work on
a library far larger than fits in a page.

Everything here is therefore counted separately from what it returns. The list
endpoint runs its filters twice — once for a page of rows, once for a count —
rather than fetching everything to measure it, and the map does not return
photos at all: it returns how many are in each square of a grid, because ten
thousand markers are neither drawable nor meaningful. The timeline is one
grouped count over the whole library, which is small enough to hold as a year
by year picture and is what makes the scrubber possible.
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Float, String, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_approved_user
from app.models import FileItem, User
from app.services.access_service import access_service

router = APIRouter(prefix="/api/gallery", tags=["Gallery"])

# What the gallery is made of. A board or a document has no place in it, and
# asking for "everything that is not a document" would sweep in the .zip
# somebody uploaded once.
MEDIA_TYPES = ("image", "video")

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 60


def _zone(name: Optional[str]) -> ZoneInfo:
    """
    The time zone a day is measured in.

    A photo taken at 23:40 belongs to that evening, not to the next morning in
    UTC, and which evening it was is the whole organising idea of a timeline.
    The browser says where it is; anything unrecognised falls back to Seoul
    rather than to UTC, which is nobody's evening.
    """
    if name:
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return ZoneInfo("Asia/Seoul")


def _media_conditions(workspace_id: uuid.UUID, kind: str):
    """The base of every query here: media in this workspace, not in the bin."""
    conditions = [
        FileItem.workspace_id == workspace_id,
        FileItem.is_trashed == False,  # noqa: E712
        FileItem.s3_key.isnot(None),
    ]
    if kind == "image":
        conditions.append(FileItem.file_type == "image")
    elif kind == "video":
        conditions.append(FileItem.file_type == "video")
    else:
        conditions.append(FileItem.file_type.in_(MEDIA_TYPES))
    return conditions


def _apply_filters(
    conditions: list,
    *,
    q: Optional[str],
    zone: ZoneInfo,
    year: Optional[int],
    month: Optional[int],
    date_from: Optional[str],
    date_to: Optional[str],
    bbox: Optional[str],
    placed_only: bool,
):
    """Everything the caller narrowed the library down by."""
    if q and q.strip():
        needle = f"%{q.strip()}%"
        conditions.append(
            or_(
                FileItem.name.ilike(needle),
                FileItem.camera_model.ilike(needle),
                FileItem.camera_make.ilike(needle),
            )
        )

    # Dates are compared in the viewer's own time zone, the same one the
    # timeline is grouped by, so a month in the rail and that month's filter
    # cannot disagree about which photos are in it.
    local_taken = func.timezone(str(zone), FileItem.taken_at)
    if year:
        conditions.append(func.extract("year", local_taken) == year)
    if month:
        conditions.append(func.extract("month", local_taken) == month)
    if date_from:
        conditions.append(func.date(local_taken) >= date_from)
    if date_to:
        conditions.append(func.date(local_taken) <= date_to)

    if placed_only:
        conditions.append(FileItem.gps_latitude.isnot(None))

    if bbox:
        try:
            south, west, north, east = (float(v) for v in bbox.split(","))
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="지도 범위를 읽을 수 없습니다.")
        conditions.append(FileItem.gps_latitude.between(south, north))
        # A window that crosses the date line is two windows, not one.
        if west <= east:
            conditions.append(FileItem.gps_longitude.between(west, east))
        else:
            conditions.append(
                or_(FileItem.gps_longitude >= west, FileItem.gps_longitude <= east)
            )
    return conditions


def _item(file_item: FileItem) -> dict:
    """One tile. Only what a tile and its caption need."""
    return {
        "id": str(file_item.id),
        "name": file_item.name,
        "file_type": file_item.file_type,
        "taken_at": file_item.taken_at.isoformat() if file_item.taken_at else None,
        "created_at": file_item.created_at.isoformat() if file_item.created_at else None,
        "size_bytes": file_item.size_bytes,
        "width": file_item.media_width,
        "height": file_item.media_height,
        "latitude": file_item.gps_latitude,
        "longitude": file_item.gps_longitude,
        "camera": " ".join(p for p in (file_item.camera_make, file_item.camera_model) if p) or None,
        "folder_id": str(file_item.folder_id) if file_item.folder_id else None,
        "has_thumbnail": bool(file_item.thumbnail_s3_key),
    }


async def _require_member(db: AsyncSession, user: User, workspace_id: uuid.UUID) -> None:
    if not await access_service.is_workspace_member(db, user, workspace_id):
        raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")


@router.get("/items")
async def list_gallery_items(
    workspace_id: uuid.UUID,
    q: Optional[str] = None,
    kind: str = Query("all", pattern="^(all|image|video)$"),
    year: Optional[int] = Query(None, ge=1900, le=2200),
    month: Optional[int] = Query(None, ge=1, le=12),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    bbox: Optional[str] = Query(None, description="south,west,north,east"),
    placed_only: bool = False,
    sort: str = Query("newest", pattern="^(newest|oldest)$"),
    tz: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    A page of the library, newest first.

    Sorted by when the photo was taken rather than when it was uploaded — a
    trip scanned in years later belongs to the trip. Photos with no date at
    all sort last rather than first, where they would otherwise push
    everything real down the page, and the id breaks ties so that paging never
    shows the same photo twice or skips one.
    """
    await _require_member(db, current_user, workspace_id)
    zone = _zone(tz)

    conditions = _apply_filters(
        _media_conditions(workspace_id, kind),
        q=q, zone=zone, year=year, month=month,
        date_from=date_from, date_to=date_to, bbox=bbox, placed_only=placed_only,
    )

    total = (await db.execute(
        select(func.count(FileItem.id)).where(and_(*conditions))
    )).scalar_one()

    taken = func.coalesce(FileItem.taken_at, FileItem.created_at)
    order = (taken.asc(), FileItem.id.asc()) if sort == "oldest" else (taken.desc(), FileItem.id.desc())

    rows = (await db.execute(
        select(FileItem)
        .where(and_(*conditions))
        .order_by(*order)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()

    return {
        "items": [_item(f) for f in rows],
        "total_count": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
    }


@router.get("/summary")
async def gallery_summary(
    workspace_id: uuid.UUID,
    q: Optional[str] = None,
    kind: str = Query("all", pattern="^(all|image|video)$"),
    tz: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    The shape of the whole library: how many, from when to when, and how many
    in each month.

    One grouped count, not one query per year. A library of a hundred thousand
    photos still has only a few hundred months in it, so this stays small
    however large the library gets — and it is what lets the scrubber show
    where the dense years are before anything is loaded.
    """
    await _require_member(db, current_user, workspace_id)
    zone = _zone(tz)
    conditions = _apply_filters(
        _media_conditions(workspace_id, kind),
        q=q, zone=zone, year=None, month=None,
        date_from=None, date_to=None, bbox=None, placed_only=False,
    )

    local_taken = func.timezone(str(zone), func.coalesce(FileItem.taken_at, FileItem.created_at))
    month_bucket = func.date_trunc("month", local_taken)

    rows = (await db.execute(
        select(month_bucket.label("month"), func.count(FileItem.id).label("count"))
        .where(and_(*conditions))
        .group_by(month_bucket)
        .order_by(month_bucket.desc())
    )).all()

    totals = (await db.execute(
        select(
            func.count(FileItem.id),
            func.count(FileItem.gps_latitude),
            func.sum(func.coalesce(FileItem.size_bytes, 0)),
            func.min(local_taken),
            func.max(local_taken),
            # How many are standing in the timeline on the day they were
            # uploaded rather than the day they were taken. Counted so the
            # gallery can say so instead of quietly presenting one as the
            # other.
            func.count(FileItem.id).filter(FileItem.taken_at.is_(None)),
        ).where(and_(*conditions))
    )).first()

    by_kind = dict((await db.execute(
        select(FileItem.file_type, func.count(FileItem.id))
        .where(and_(*conditions))
        .group_by(FileItem.file_type)
    )).all())

    return {
        "total_count": totals[0] or 0,
        "placed_count": totals[1] or 0,
        "total_bytes": int(totals[2] or 0),
        "first_taken_at": totals[3].isoformat() if totals[3] else None,
        "last_taken_at": totals[4].isoformat() if totals[4] else None,
        "undated_count": totals[5] or 0,
        "image_count": by_kind.get("image", 0),
        "video_count": by_kind.get("video", 0),
        "months": [
            {"month": row.month.strftime("%Y-%m"), "count": row.count}
            for row in rows if row.month is not None
        ],
    }


# How coarse the map's grid is at each zoom level, in degrees. Two photos from
# the same street should be one dot when the map shows a country and two dots
# when it shows the street, and this is that, said in the only unit a
# latitude has.
def _grid_size(zoom: int) -> float:
    if zoom <= 3:
        return 10.0
    if zoom <= 5:
        return 4.0
    if zoom <= 7:
        return 1.0
    if zoom <= 9:
        return 0.25
    if zoom <= 11:
        return 0.06
    if zoom <= 13:
        return 0.015
    if zoom <= 15:
        return 0.004
    return 0.0008


@router.get("/map")
async def gallery_map(
    workspace_id: uuid.UUID,
    zoom: int = Query(3, ge=0, le=20),
    q: Optional[str] = None,
    kind: str = Query("all", pattern="^(all|image|video)$"),
    year: Optional[int] = Query(None, ge=1900, le=2200),
    month: Optional[int] = Query(None, ge=1, le=12),
    bbox: Optional[str] = None,
    tz: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Where the photos were taken, as clusters rather than as photos.

    The database does the grouping: every photo is rounded onto a grid of the
    right size for this zoom, and what comes back is one row per square with
    how many are in it and the middle of where they actually are — so a
    cluster sits on the town it is made of rather than on the corner of an
    invisible square. One photo from each square comes too, for the dot to
    wear its face.
    """
    await _require_member(db, current_user, workspace_id)
    zone = _zone(tz)

    conditions = _apply_filters(
        _media_conditions(workspace_id, kind),
        q=q, zone=zone, year=year, month=month,
        date_from=None, date_to=None, bbox=bbox, placed_only=True,
    )

    grid = _grid_size(zoom)
    lat_cell = func.floor(cast(FileItem.gps_latitude, Float) / grid)
    lon_cell = func.floor(cast(FileItem.gps_longitude, Float) / grid)

    rows = (await db.execute(
        select(
            func.avg(FileItem.gps_latitude).label("lat"),
            func.avg(FileItem.gps_longitude).label("lon"),
            func.count(FileItem.id).label("count"),
            func.min(cast(FileItem.id, String)).label("sample_id"),
            func.max(func.coalesce(FileItem.taken_at, FileItem.created_at)).label("latest"),
        )
        .where(and_(*conditions))
        .group_by(lat_cell, lon_cell)
        .order_by(func.count(FileItem.id).desc())
        .limit(600)
    )).all()

    return {
        "clusters": [
            {
                "latitude": float(r.lat),
                "longitude": float(r.lon),
                "count": r.count,
                "sample_id": r.sample_id,
                "latest": r.latest.isoformat() if r.latest else None,
            }
            for r in rows
        ],
        "zoom": zoom,
        "grid": grid,
    }


@router.get("/path")
async def gallery_path(
    workspace_id: uuid.UUID,
    q: Optional[str] = None,
    kind: str = Query("all", pattern="^(all|image|video)$"),
    year: Optional[int] = Query(None, ge=1900, le=2200),
    month: Optional[int] = Query(None, ge=1, le=12),
    bbox: Optional[str] = None,
    tz: Optional[str] = None,
    limit: int = Query(1500, ge=2, le=4000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    The places of this period, in the order they were photographed.

    Not a route. Nothing here guesses how anybody travelled between two
    photographs — it is the photographs themselves, laid end to end in time,
    which is the only thing they can honestly say about how a trip moved.
    Drawn as a line, that is still enough to see a day going up a coast.

    Returned oldest first, and capped: a year with ten thousand placed photos
    is a scribble rather than a journey, so beyond the cap the period is
    sampled evenly rather than truncated — the shape of the whole is kept,
    which is what this is for.
    """
    await _require_member(db, current_user, workspace_id)
    zone = _zone(tz)
    conditions = _apply_filters(
        _media_conditions(workspace_id, kind),
        q=q, zone=zone, year=year, month=month,
        date_from=None, date_to=None, bbox=bbox, placed_only=True,
    )
    taken = func.coalesce(FileItem.taken_at, FileItem.created_at)

    total = (await db.execute(
        select(func.count(FileItem.id)).where(and_(*conditions))
    )).scalar_one()

    rows = (await db.execute(
        select(FileItem.id, FileItem.gps_latitude, FileItem.gps_longitude, taken.label("taken"))
        .where(and_(*conditions))
        .order_by(taken.asc(), FileItem.id.asc())
    )).all()

    if total > limit:
        step = total / limit
        rows = [rows[int(i * step)] for i in range(limit)]

    return {
        "points": [
            {
                "id": str(r.id),
                "latitude": r.gps_latitude,
                "longitude": r.gps_longitude,
                "taken_at": r.taken.isoformat() if r.taken else None,
            }
            for r in rows
        ],
        "total_count": total,
        "sampled": total > limit,
    }


@router.get("/place")
async def gallery_place(
    workspace_id: uuid.UUID,
    latitude: float,
    longitude: float,
    radius_km: float = Query(2.0, gt=0, le=500),
    q: Optional[str] = None,
    kind: str = Query("all", pattern="^(all|image|video)$"),
    year: Optional[int] = Query(None, ge=1900, le=2200),
    month: Optional[int] = Query(None, ge=1, le=12),
    tz: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=MAX_PAGE_SIZE),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    What was photographed around one point on the map.

    A dot on a map answers "how many"; this answers "which", because being
    told there are 212 photographs of somewhere and not being shown one of
    them is the least interesting thing a map can do. Newest first, paged like
    everything else, and counted separately so the panel can say how many
    there are before it has them all.
    """
    await _require_member(db, current_user, workspace_id)
    zone = _zone(tz)

    import math as _math
    lat_span = radius_km / 111.0
    lon_span = radius_km / max(1.0, 111.0 * _math.cos(_math.radians(latitude)))

    conditions = _apply_filters(
        _media_conditions(workspace_id, kind),
        q=q, zone=zone, year=year, month=month,
        date_from=None, date_to=None, bbox=None, placed_only=True,
    )
    conditions += [
        FileItem.gps_latitude.between(latitude - lat_span, latitude + lat_span),
        FileItem.gps_longitude.between(longitude - lon_span, longitude + lon_span),
    ]

    total = (await db.execute(
        select(func.count(FileItem.id)).where(and_(*conditions))
    )).scalar_one()
    taken = func.coalesce(FileItem.taken_at, FileItem.created_at)
    span = (await db.execute(
        select(func.min(taken), func.max(taken)).where(and_(*conditions))
    )).first()
    rows = (await db.execute(
        select(FileItem).where(and_(*conditions))
        .order_by(taken.desc(), FileItem.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [_item(f) for f in rows],
        "total_count": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
        "first_taken_at": span[0].isoformat() if span and span[0] else None,
        "last_taken_at": span[1].isoformat() if span and span[1] else None,
    }


@router.get("/neighbours")
async def gallery_neighbours(
    workspace_id: uuid.UUID,
    file_id: uuid.UUID,
    radius_km: float = Query(1.0, gt=0, le=200),
    limit: int = Query(24, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    What else was taken around here.

    The reason for a map in a photo library is rarely the map itself — it is
    standing somewhere again and asking what else happened here. A rough
    degree box does for that: the distance is sorted properly afterwards, and
    nobody is navigating by it.
    """
    await _require_member(db, current_user, workspace_id)
    origin = await db.get(FileItem, file_id)
    if origin is None or origin.gps_latitude is None:
        return {"items": []}

    lat_span = radius_km / 111.0
    # A degree of longitude shrinks towards the poles; without this a box
    # around Seoul would be half as wide as it should be.
    import math
    lon_span = radius_km / max(1.0, 111.0 * math.cos(math.radians(origin.gps_latitude)))

    conditions = _media_conditions(workspace_id, "all")
    conditions += [
        FileItem.gps_latitude.between(origin.gps_latitude - lat_span, origin.gps_latitude + lat_span),
        FileItem.gps_longitude.between(origin.gps_longitude - lon_span, origin.gps_longitude + lon_span),
        FileItem.id != origin.id,
    ]

    distance = (
        func.abs(FileItem.gps_latitude - origin.gps_latitude)
        + func.abs(FileItem.gps_longitude - origin.gps_longitude)
    )
    rows = (await db.execute(
        select(FileItem).where(and_(*conditions)).order_by(distance.asc()).limit(limit)
    )).scalars().all()
    return {"items": [_item(f) for f in rows]}


# ── 얼굴 ──────────────────────────────────────────────────────────────────
#
# Searching a photo library by face is the one thing that cannot be done with
# what a file already knows about itself, so it needs an index of its own —
# built once by a sweep, then asked the same way document search is asked, in
# Postgres, over vectors.


@router.get("/faces/status")
async def faces_status(
    workspace_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """How much of this workspace has been looked at, and what was found."""
    await _require_member(db, current_user, workspace_id)
    from app.models import FaceSignature
    from app.services import face_index_service, face_service

    pending = await face_index_service.pending_count(db, workspace_id)
    total_media = (await db.execute(
        select(func.count(FileItem.id)).where(and_(*_media_conditions(workspace_id, "all")))
    )).scalar_one()
    faces = (await db.execute(
        select(func.count(FaceSignature.id)).where(FaceSignature.workspace_id == workspace_id)
    )).scalar_one()
    files_with_faces = (await db.execute(
        select(func.count(func.distinct(FaceSignature.file_id)))
        .where(FaceSignature.workspace_id == workspace_id)
    )).scalar_one()

    return {
        "scanned": total_media - pending,
        "total": total_media,
        "pending": pending,
        "faces": faces,
        "files_with_faces": files_with_faces,
        "models_ready": face_service.models_ready(),
    }


@router.get("/items/{file_id}/faces")
async def faces_in_item(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    The faces in one photograph, as boxes over it.

    What the viewer sees drawn on the picture, and what they click to ask for
    everywhere else this person appears.
    """
    if not await access_service.can_access_file(db, current_user, file_id):
        raise HTTPException(status_code=403, detail="파일에 접근할 권한이 없습니다.")
    from app.models import FaceSignature

    file_item = await db.get(FileItem, file_id)
    rows = (await db.execute(
        select(FaceSignature).where(FaceSignature.file_id == file_id)
        .order_by(FaceSignature.box_x)
    )).scalars().all()
    return {
        "faces": [r.to_dict() for r in rows],
        "scanned": bool(file_item and file_item.faces_scanned_at),
    }


@router.get("/faces/{face_id}/matches")
async def faces_like_this(
    face_id: uuid.UUID,
    workspace_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Everywhere else this person appears.

    One file can hold several sightings of the same person — a video most of
    all — so matches are folded down to files before they are paged, and a
    file is ranked by its closest sighting rather than by how many it has.
    """
    await _require_member(db, current_user, workspace_id)
    from app.models import FaceSignature
    from app.services import face_index_service

    face = await db.get(FaceSignature, face_id)
    if face is None:
        raise HTTPException(status_code=404, detail="얼굴을 찾을 수 없습니다.")
    if not await access_service.can_access_file(db, current_user, face.file_id):
        raise HTTPException(status_code=403, detail="이 얼굴에 접근할 권한이 없습니다.")

    matches = await face_index_service.similar_faces(db, face.embedding, workspace_id)

    best: dict = {}
    for row in matches:
        current = best.get(row.file_id)
        if current is None or row.similarity > current:
            best[row.file_id] = row.similarity
    ordered = sorted(best.items(), key=lambda kv: kv[1], reverse=True)
    total = len(ordered)
    window = ordered[(page - 1) * page_size: page * page_size]

    if not window:
        return {"items": [], "total_count": total, "page": page, "page_size": page_size, "total_pages": 0}

    ids = [file_id for file_id, _ in window]
    rows = (await db.execute(select(FileItem).where(FileItem.id.in_(ids)))).scalars().all()
    by_id = {r.id: r for r in rows}
    items = []
    for file_id, similarity in window:
        file_item = by_id.get(file_id)
        if file_item is None:
            continue
        entry = _item(file_item)
        entry["similarity"] = round(float(similarity), 4)
        items.append(entry)

    return {
        "items": items,
        "total_count": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
    }
