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
import math
import uuid

import cv2
import numpy as np
from datetime import date as dt_date, datetime, timezone as dt_timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import Float, String, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_approved_user, get_current_approved_user_query_or_header
from app.models import FileItem, User
from app.services.access_service import access_service
from app.services.s3_service import s3_service

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


def _as_day(value: str) -> dt_date:
    """A YYYY-MM-DD from the query string, as a day."""
    try:
        return dt_date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="날짜를 읽을 수 없습니다.")


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
    uploader: Optional[uuid.UUID] = None,
    camera: Optional[str] = None,
    placed: Optional[str] = None,
):
    """Everything the caller narrowed the library down by."""
    if uploader:
        conditions.append(FileItem.created_by == uploader)
    # Names only. The box used to search camera makes and models as well, which
    # meant typing a word and not knowing which of three things it had matched
    # — and nobody guesses "SM-G991N" into a search box anyway. The cameras are
    # a list to choose from now, which is what a fixed handful of values wants
    # to be.
    if q and q.strip():
        conditions.append(FileItem.name.ilike(f"%{q.strip()}%"))
    if camera:
        wanted = [c for c in camera.split("|") if c]
        if wanted:
            conditions.append(or_(*[
                func.concat(
                    func.coalesce(FileItem.camera_make, ""), " ",
                    func.coalesce(FileItem.camera_model, ""),
                ) == c
                for c in wanted
            ]))
    # Whether it is on the map. "Which of these will never appear in the map
    # view" is a real question about a library, and it had no way of being
    # asked.
    if placed == "yes":
        conditions.append(FileItem.gps_latitude.isnot(None))
    elif placed == "no":
        conditions.append(FileItem.gps_latitude.is_(None))

    # Dates are compared in the viewer's own time zone, the same one the
    # timeline is grouped by, so a month in the rail and that month's filter
    # cannot disagree about which photos are in it.
    local_taken = func.timezone(str(zone), FileItem.taken_at)
    if year:
        conditions.append(func.extract("year", local_taken) == year)
    if month:
        conditions.append(func.extract("month", local_taken) == month)
    # Read into a real date rather than handed over as text. Postgres has no
    # operator for `date >= text`, and declaring the cast in the statement does
    # not help — the driver still has a string to send. Parsing here also means
    # a malformed day is refused rather than raised from inside the query.
    if date_from:
        conditions.append(func.date(local_taken) >= _as_day(date_from))
    if date_to:
        conditions.append(func.date(local_taken) <= _as_day(date_to))

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


@router.get("/cameras")
async def gallery_cameras(
    workspace_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    What took the photographs, and how many each.

    A handful of values that never change is a list to choose from, not
    something to type. Make and model are joined into the one name a person
    would use for the thing — "Samsung SM-G991N" rather than two columns — and
    that joined name is what the filter matches on.
    """
    await _require_member(db, current_user, workspace_id)
    name = func.trim(func.concat(
        func.coalesce(FileItem.camera_make, ""), " ",
        func.coalesce(FileItem.camera_model, ""),
    ))
    rows = (await db.execute(
        select(name.label("name"), func.count(FileItem.id).label("count"))
        .where(and_(*_media_conditions(workspace_id, "all")))
        .group_by(name)
        .having(name != "")
        .order_by(func.count(FileItem.id).desc())
        .limit(60)
    )).all()
    return {"items": [{"name": r.name, "count": r.count} for r in rows]}


@router.get("/uploaders")
async def gallery_uploaders(
    workspace_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    Who put photographs in this workspace, and how many each.

    The person asking comes first whether or not they have any — "my photos"
    is the answer wanted often enough that it should not be hunted for in an
    alphabetical list. Names and pictures only; the member directory, which
    carries email addresses, stays administrator-only.

    This exists mostly for one thing: a workspace is filled by several people
    at once, so a line joining photographs in time order is only one person's
    day once it is one person's photographs.
    """
    await _require_member(db, current_user, workspace_id)

    rows = (await db.execute(
        select(User, func.count(FileItem.id).label("count"))
        .join(FileItem, FileItem.created_by == User.id)
        .where(and_(*_media_conditions(workspace_id, "all")))
        .group_by(User.id)
        .order_by(func.count(FileItem.id).desc())
    )).all()

    def described(user: User, count: int) -> dict:
        return {
            "id": str(user.id),
            "name": (user.username or user.name or user.email),
            "avatar": user.avatar_url,
            "count": count,
        }

    mine = next((r for r in rows if r[0].id == current_user.id), None)
    others = [described(u, c) for u, c in rows if u.id != current_user.id]
    return {
        "items": ([described(mine[0], mine[1])] if mine else [described(current_user, 0)]) + others,
    }


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
    uploader: Optional[uuid.UUID] = None,
    sort: str = Query("newest", pattern="^(newest|oldest)$"),
    tz: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    camera: Optional[str] = Query(None, description="'make model', several separated by |"),
    placed: Optional[str] = Query(None, pattern="^(yes|no)$"),
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
        uploader=uploader, camera=camera, placed=placed,
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
    uploader: Optional[uuid.UUID] = None,
    tz: Optional[str] = None,
    camera: Optional[str] = Query(None, description="'make model', several separated by |"),
    placed: Optional[str] = Query(None, pattern="^(yes|no)$"),
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
        date_from=None, date_to=None, bbox=None, placed_only=False, uploader=uploader, camera=camera, placed=placed,
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
    if zoom <= 16:
        return 0.0008
    # Zoomed in this far the screen is a street, then a courtyard. A cell that
    # is wider than the view would gather everything on it into one dot sitting
    # off to a side, so the grid keeps getting finer until it is a few metres.
    if zoom <= 18:
        return 0.0002
    return 0.00005


@router.get("/map")
async def gallery_map(
    workspace_id: uuid.UUID,
    # The map itself goes to 22. Refusing a zoom it can reach would mean a 422
    # and, on the other end, a map that quietly loses every dot at full zoom.
    zoom: int = Query(3, ge=0, le=24),
    q: Optional[str] = None,
    kind: str = Query("all", pattern="^(all|image|video)$"),
    year: Optional[int] = Query(None, ge=1900, le=2200),
    month: Optional[int] = Query(None, ge=1, le=12),
    bbox: Optional[str] = None,
    uploader: Optional[uuid.UUID] = None,
    tz: Optional[str] = None,
    camera: Optional[str] = Query(None, description="'make model', several separated by |"),
    placed: Optional[str] = Query(None, pattern="^(yes|no)$"),
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
        date_from=None, date_to=None, bbox=bbox, placed_only=True, uploader=uploader, camera=camera, placed=placed,
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
            # The ground this dot actually stands for. Without it the panel
            # beside the map had to guess from the zoom level, and a dot
            # holding one photograph answered with a hundred from the dots
            # around it.
            func.min(FileItem.gps_latitude).label("min_lat"),
            func.max(FileItem.gps_latitude).label("max_lat"),
            func.min(FileItem.gps_longitude).label("min_lon"),
            func.max(FileItem.gps_longitude).label("max_lon"),
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
                "bounds": [float(r.min_lat), float(r.min_lon), float(r.max_lat), float(r.max_lon)],
            }
            for r in rows
        ],
        "zoom": zoom,
        "grid": grid,
    }


# Two photographs taken within this of each other, one after the other, are the
# same stop rather than a move. Roughly a long block: close enough that a
# courtyard, a restaurant and the street outside it stay one place, far enough
# that walking to the next street shows up as walking.
STOP_RADIUS_M = 120.0

# A guard rather than a policy. Nothing in this app is near it; it exists so a
# library that grew past every expectation degrades into a long answer rather
# than an unanswerable one.
MAX_PATH_PHOTOS = 150_000

_METRES_PER_DEGREE = 111_320.0


def _local_day(moment, zone) -> Optional[str]:
    """The calendar day a moment falls on, where the photographs were taken."""
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt_timezone.utc)
    return moment.astimezone(zone).date().isoformat()


def _stops_along(rows, zone) -> list:
    """
    A run of photographs in one spot, gathered into the stop it was.

    The comparison is against where the stop *began*, not against its running
    average — an average creeps, and a slow walk down a promenade would feed it
    one photograph at a time and never once exceed the radius, arriving at a
    single "stop" a kilometre wide. Measured from the anchor, that walk becomes
    the sequence of stops it actually was.
    """
    stops: list[dict] = []
    anchor = None
    for row in rows:
        lat, lon = row.gps_latitude, row.gps_longitude
        if stops and anchor is not None:
            dy = (lat - anchor[0]) * _METRES_PER_DEGREE
            dx = (lon - anchor[1]) * _METRES_PER_DEGREE * math.cos(math.radians(lat))
            if math.hypot(dx, dy) <= STOP_RADIUS_M:
                stop = stops[-1]
                stop["count"] += 1
                stop["_lat"] += lat
                stop["_lon"] += lon
                stop["latitude"] = stop["_lat"] / stop["count"]
                stop["longitude"] = stop["_lon"] / stop["count"]
                bounds = stop["bounds"]
                stop["bounds"] = [min(bounds[0], lat), min(bounds[1], lon),
                                  max(bounds[2], lat), max(bounds[3], lon)]
                if row.taken:
                    stop["until"] = row.taken.isoformat()
                    stop["day_to"] = _local_day(row.taken, zone)
                continue
        anchor = (lat, lon)
        stops.append({
            "id": str(row.id),
            "latitude": lat,
            "longitude": lon,
            "count": 1,
            # The ground this stop actually covers, so asking for its
            # photographs is asking for exactly the ones it is made of —
            # the same reason a dot on the map carries its own extent
            # rather than being looked up by a radius.
            "bounds": [lat, lon, lat, lon],
            "taken_at": row.taken.isoformat() if row.taken else None,
            "until": row.taken.isoformat() if row.taken else None,
            # The days this stop covers, worked out here rather than in the
            # browser: the days belong to the workspace's clock, and the
            # browser's is whichever one the reader happens to be sitting in.
            "day_from": _local_day(row.taken, zone),
            "day_to": _local_day(row.taken, zone),
            "_lat": lat,
            "_lon": lon,
        })
    for stop in stops:
        stop.pop("_lat", None)
        stop.pop("_lon", None)
    return stops

@router.get("/path")
async def gallery_path(
    workspace_id: uuid.UUID,
    q: Optional[str] = None,
    kind: str = Query("all", pattern="^(all|image|video)$"),
    year: Optional[int] = Query(None, ge=1900, le=2200),
    month: Optional[int] = Query(None, ge=1, le=12),
    bbox: Optional[str] = None,
    uploader: Optional[uuid.UUID] = None,
    tz: Optional[str] = None,
    camera: Optional[str] = Query(None, description="'make model', several separated by |"),
    placed: Optional[str] = Query(None, pattern="^(yes|no)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user),
):
    """
    The places of this period, in the order they were photographed.

    Not a route. Nothing here guesses how anybody travelled between two
    photographs — it is the photographs themselves, laid end to end in time,
    which is the only thing they can honestly say about how a trip moved.
    Drawn as a line, that is still enough to see a day going up a coast.

    Every photograph counts, and none is skipped. This used to keep fifteen
    hundred and sample the rest evenly, which quietly broke the one promise the
    line makes: a leg drawn from the first photograph to the ninth says the
    trip went straight there, when it had in fact stopped seven times on the
    way. A drawn sequence that omits places is worse than a dense one.

    What it does instead is collapse rather than sample. Four hundred
    photographs of one temple over one afternoon are not four hundred moves;
    they are one stop, and saying so removes the repetition without removing a
    single place. So consecutive photographs within STOP_RADIUS_M of where the
    stop began are gathered into that stop, and a photograph beyond it starts
    the next one — which is also why a return to somewhere already visited is a
    new stop and not a merge, since what is being collapsed is time spent still,
    never two visits.

    Nothing here is stored. The trail is worked out from the photographs every
    time it is asked for, so photographs of the middle of a trip uploaded a year
    later simply appear in the middle where they belong, the next time it is
    opened — there is no saved route to go stale.

    What would go wrong is a photograph with a place but no capture time. Every
    other view falls back to the upload date for those, which is honest there
    because it is shown as an upload date; here it would be a lie with a line
    drawn through it — a leg from the middle of a trip to wherever today's
    upload happened to be. So they are left out and counted, and the map says
    how many.
    """
    await _require_member(db, current_user, workspace_id)
    zone = _zone(tz)
    conditions = _apply_filters(
        _media_conditions(workspace_id, kind),
        q=q, zone=zone, year=year, month=month,
        date_from=None, date_to=None, bbox=bbox, placed_only=True, uploader=uploader, camera=camera, placed=placed,
    )
    total = (await db.execute(
        select(func.count(FileItem.id)).where(and_(*conditions))
    )).scalar_one()

    dated = conditions + [FileItem.taken_at.isnot(None)]
    rows = (await db.execute(
        select(FileItem.id, FileItem.gps_latitude, FileItem.gps_longitude,
               FileItem.taken_at.label("taken"))
        .where(and_(*dated))
        .order_by(FileItem.taken_at.asc(), FileItem.id.asc())
        .limit(MAX_PATH_PHOTOS)
    )).all()

    return {
        "points": _stops_along(rows, zone),
        "total_count": total,
        "counted": len(rows),
        "undated": max(total - len(rows), 0),
        "stop_radius_m": STOP_RADIUS_M,
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
    uploader: Optional[uuid.UUID] = None,
    bbox: Optional[str] = Query(None, description="south,west,north,east — the ground a dot covers"),
    # Arriving from the trail asks a narrower question: not "this place", but
    # "this place while we were there". Days rather than moments, because the
    # panel is a day timeline and because a day is the same day for everyone
    # reading the same workspace.
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD, in the workspace's clock"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD, in the workspace's clock"),
    tz: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=MAX_PAGE_SIZE),
    camera: Optional[str] = Query(None, description="'make model', several separated by |"),
    placed: Optional[str] = Query(None, pattern="^(yes|no)$"),
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

    # Built twice: once for the whole place, once narrowed to the days asked
    # for. The ground is added to both below, so the only difference between
    # them is the stay — which is what lets the panel say "this is an afternoon
    # of a place that holds far more".
    def base(from_day, to_day):
        return _apply_filters(
            _media_conditions(workspace_id, kind),
            q=q, zone=zone, year=year, month=month,
            date_from=from_day, date_to=to_day, bbox=None, placed_only=True, uploader=uploader, camera=camera, placed=placed,
        )

    conditions = base(date_from, date_to)
    whole_place = base(None, None)

    if bbox:
        # Asked for by the exact ground a dot on the map covers, so what the
        # panel lists is what that dot is made of — no more, and none of its
        # neighbours. A hair of slack, because the bounds came back as floats
        # and the same numbers have to match themselves.
        try:
            south, west, north, east = (float(v) for v in bbox.split(","))
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="범위를 읽을 수 없습니다.")
        slack = 1e-7
        ground = [
            FileItem.gps_latitude.between(south - slack, north + slack),
            FileItem.gps_longitude.between(west - slack, east + slack),
        ]
    else:
        lat_span = radius_km / 111.0
        lon_span = radius_km / max(1.0, 111.0 * math.cos(math.radians(latitude)))
        ground = [
            FileItem.gps_latitude.between(latitude - lat_span, latitude + lat_span),
            FileItem.gps_longitude.between(longitude - lon_span, longitude + lon_span),
        ]
    conditions += ground
    whole_place += ground

    total = (await db.execute(
        select(func.count(FileItem.id)).where(and_(*conditions))
    )).scalar_one()

    # What the place holds altogether, when the question was narrowed to one
    # stay. Without it the panel would show an afternoon and look like the
    # whole of somewhere — and a viewer has no way to tell the difference
    # between "this is all there is here" and "this is all we asked for".
    place_total = total
    if date_from or date_to:
        place_total = (await db.execute(
            select(func.count(FileItem.id)).where(and_(*whole_place))
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
        "place_total_count": place_total,
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
    camera: Optional[str] = Query(None, description="'make model', several separated by |"),
    placed: Optional[str] = Query(None, pattern="^(yes|no)$"),
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


@router.get("/faces/{face_id}/crop")
async def face_crop(
    face_id: uuid.UUID,
    # Reached the way a thumbnail is — as the src of an <img>, which cannot
    # carry a header — so it takes the same short-lived media token.
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user_query_or_header),
):
    """
    This one face, cut out of the picture it was found in.

    A film cannot show its faces the way a photograph can — they are at
    moments, spread through it — so the way to offer them is as pictures of
    their own. Cut once and kept: getting one back out of a film means seeking
    into it and decoding, which is seconds, and nobody should wait for that
    twice.
    """
    from app.models import FaceSignature
    from app.services import face_service

    face = await db.get(FaceSignature, face_id)
    if face is None:
        raise HTTPException(status_code=404, detail="얼굴을 찾을 수 없습니다.")
    if not await access_service.can_access_file(db, current_user, face.file_id):
        raise HTTPException(status_code=403, detail="이 얼굴에 접근할 권한이 없습니다.")

    cached_key = f"faces/{face_id}.jpg"
    cached = await run_in_threadpool(s3_service.get_object_content, cached_key)
    if cached:
        return Response(content=cached, media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=86400"})

    file_item = await db.get(FileItem, face.file_id)
    if file_item is None or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="원본을 찾을 수 없습니다.")

    if file_item.file_type == "video":
        url = await run_in_threadpool(s3_service.internal_presigned_get_url, file_item.s3_key)
        # The turn is not recorded per face, so it is worked out again from the
        # frame itself — the same way the sweep decided it.
        # The turn is the one the sweep settled on for this film. Working it
        # out again here, frame by frame, gave different answers for different
        # faces of the same film — some cut-outs came back lying on their side.
        image = await run_in_threadpool(
            face_service.frame_at, url or file_item.s3_key,
            face.frame_time, int(face.frame_turn or 0),
        )
    else:
        data = await run_in_threadpool(s3_service.get_object_content, file_item.s3_key)
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR) if data else None

    if image is None:
        raise HTTPException(status_code=404, detail="이 얼굴을 꺼낼 수 없습니다.")

    height, width = image.shape[:2]
    x, y = face.box_x * width, face.box_y * height
    w, h = face.box_w * width, face.box_h * height
    pad = max(w, h) * 0.35          # a face with a little room around it
    left, top = max(0, int(x - pad)), max(0, int(y - pad))
    right, bottom = min(width, int(x + w + pad)), min(height, int(y + h + pad))
    crop = image[top:bottom, left:right]
    if crop.size == 0:
        raise HTTPException(status_code=404, detail="이 얼굴을 꺼낼 수 없습니다.")
    side = 192
    crop = cv2.resize(crop, (side, side), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 86])
    if not ok:
        raise HTTPException(status_code=500, detail="이 얼굴을 저장할 수 없습니다.")
    body = encoded.tobytes()
    await run_in_threadpool(s3_service.put_object, cached_key, body, "image/jpeg")
    return Response(content=body, media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=86400"})


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
    from app.services import face_index_service

    rows = (await db.execute(
        select(FaceSignature).where(FaceSignature.file_id == file_id)
        # A film's faces are moments; they belong in the order they happen.
        # A photograph's have no time, so they fall back to left-to-right.
        .order_by(FaceSignature.frame_time.nulls_first(), FaceSignature.box_x)
    )).scalars().all()
    # Folded into people. A film shows the same person at four moments and
    # says "four" — which is four sightings, not four people. They are grouped
    # here rather than merged at index time because the moments are worth
    # keeping: each one is a place in the film you can be sent to.
    people = []
    for row in rows:
        vector = np.asarray(row.embedding, dtype=np.float32)
        for group in people:
            if float(np.dot(vector, group["_vector"])) >= face_index_service.SAME_PERSON_SIMILARITY:
                group["faces"].append(row.to_dict())
                break
        else:
            people.append({"_vector": vector, "faces": [row.to_dict()]})
    for group in people:
        group.pop("_vector", None)
        # The clearest sighting speaks for the person.
        group["id"] = max(group["faces"], key=lambda f: f["score"] or 0)["id"]

    return {
        "faces": [r.to_dict() for r in rows],
        "people": people,
        "scanned": bool(file_item and file_item.faces_scanned_at),
    }


@router.get("/faces/{face_id}/matches")
async def faces_like_this(
    face_id: uuid.UUID,
    workspace_id: uuid.UUID,
    q: Optional[str] = None,
    kind: str = Query("all", pattern="^(all|image|video)$"),
    year: Optional[int] = Query(None, ge=1900, le=2200),
    month: Optional[int] = Query(None, ge=1, le=12),
    uploader: Optional[uuid.UUID] = None,
    camera: Optional[str] = Query(None, description="'make model', several separated by |"),
    placed: Optional[str] = Query(None, pattern="^(yes|no)$"),
    tz: Optional[str] = None,
    sort: str = Query("newest", pattern="^(newest|oldest|closest)$"),
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

    # Narrowed the same way the rest of the gallery is. The filters were on
    # screen while this was showing and did nothing to it, which reads as a
    # broken filter rather than as one that does not apply here — and "이 사람이
    # 나온 2023년 사진" is a reasonable thing to want.
    if best and (q or kind != "all" or year or month or uploader or camera or placed):
        allowed = {
            row[0]
            for row in (await db.execute(
                select(FileItem.id).where(and_(*_apply_filters(
                    _media_conditions(workspace_id, kind),
                    q=q, zone=_zone(tz), year=year, month=month,
                    date_from=None, date_to=None, bbox=None, placed_only=False,
                    uploader=uploader, camera=camera, placed=placed,
                ), FileItem.id.in_(list(best.keys()))))
            )).all()
        }
        best = {file_id: score for file_id, score in best.items() if file_id in allowed}

    # By when they were taken, newest first — the same order as everywhere else
    # in the gallery, and the order the grid's month headings assume. Ranked by
    # likeness instead, the months came out shuffled and the same month
    # appeared over and over as the list crossed back into it.
    #
    # Free to do: the whole match set is already in hand, and the dates are one
    # indexed read of the files it names. Ordering by likeness is still offered
    # for anyone who wants the surest ones first.
    taken = func.coalesce(FileItem.taken_at, FileItem.created_at)
    when = {
        row[0]: row[1]
        for row in (await db.execute(
            select(FileItem.id, taken).where(FileItem.id.in_(list(best.keys())))
        )).all()
    } if best else {}

    if sort == "closest":
        ordered = sorted(best.items(), key=lambda kv: kv[1], reverse=True)
    else:
        floor = datetime.min.replace(tzinfo=dt_timezone.utc)
        ordered = sorted(
            best.items(),
            key=lambda kv: (when.get(kv[0]) or floor, kv[1]),
            reverse=(sort == "newest"),
        )
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
