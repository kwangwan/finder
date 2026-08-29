"""
Reads capture metadata out of media files: EXIF for photos, the MP4/MOV
`moov` atom for video.

Everything here works from small ranged reads rather than whole objects. A
photo's EXIF sits in the first few KB of the JPEG, and a phone-recorded MP4
keeps its `moov` at the very end of the file (only "faststart"-processed
files move it to the front), so head and tail slices are enough. That is what
makes backfilling ~12k files affordable — the alternative would be pulling
terabytes back out of MinIO to read a few hundred bytes from each one.
"""
import asyncio
import struct
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

from PIL import Image
import io

# EXIF tag ids, resolved once rather than scanning ExifTags.TAGS per file.
_TAG_DATETIME_ORIGINAL = 36867  # when the shutter fired
_TAG_DATETIME = 306             # file write time; fallback only
_TAG_MAKE = 271
_TAG_MODEL = 272
_GPS_IFD = 0x8825
_EXIF_IFD = 0x8769
_TAG_OFFSET = 0x9010          # OffsetTime
_TAG_OFFSET_ORIGINAL = 0x9011  # OffsetTimeOriginal (EXIF 2.31+)

# How much of each file to pull. EXIF is at the head; MP4 metadata is
# normally at the tail, but check the head too for faststart files.
IMAGE_HEAD_BYTES = 256 * 1024
VIDEO_PROBE_BYTES = 512 * 1024

# MP4/MOV timestamps count seconds from 1904-01-01, not the Unix epoch.
_MP4_EPOCH = datetime(1904, 1, 1, tzinfo=timezone.utc)


def _clean(value: Any, limit: int = 128) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().replace("\x00", "")
    return text[:limit] or None


def _parse_utc_offset(raw: Any) -> Optional[timezone]:
    """EXIF OffsetTimeOriginal looks like '+09:00'."""
    text = _clean(raw, 8)
    if not text or len(text) < 6 or text[0] not in "+-":
        return None
    try:
        hours, minutes = int(text[1:3]), int(text[4:6])
    except ValueError:
        return None
    if not (0 <= hours <= 14 and 0 <= minutes < 60):
        return None
    delta = timedelta(hours=hours, minutes=minutes)
    return timezone(-delta if text[0] == "-" else delta)


def _parse_exif_datetime(raw: Any, offset: Optional[timezone] = None) -> Optional[datetime]:
    """
    EXIF stores '2026:06:06 13:55:03' — colons in the date part too — as the
    camera's LOCAL wall clock, with no zone attached to it.

    The column this lands in is TIMESTAMPTZ and the frontend renders it in
    the viewer's local zone (the app-wide convention), so a true instant is
    required: tagging the wall clock as UTC would display every Korean photo
    nine hours late. EXIF 2.31's OffsetTimeOriginal carries the real offset
    and these files do provide it. Without it there is genuinely no way to
    recover the instant, so the wall clock is kept as-is (labelled UTC) — the
    date stays right and the time can be off by the capture offset, which
    beats discarding the value entirely.
    """
    text = _clean(raw, 32)
    if not text:
        return None
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            naive = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if offset is not None:
            return naive.replace(tzinfo=offset).astimezone(timezone.utc)
        return naive.replace(tzinfo=timezone.utc)
    return None


def _dms_to_degrees(values, ref: Optional[str]) -> Optional[float]:
    """EXIF GPS is (degrees, minutes, seconds) rationals plus a N/S/E/W ref."""
    try:
        degrees, minutes, seconds = (float(v) for v in values)
    except (TypeError, ValueError):
        return None
    result = degrees + minutes / 60.0 + seconds / 3600.0
    if ref in ("S", "W"):
        result = -result
    if not (-180.0 <= result <= 180.0):
        return None
    return round(result, 6)


def extract_image_metadata(head_bytes: bytes) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    try:
        img = Image.open(io.BytesIO(head_bytes))
    except Exception:
        return out

    try:
        if img.width and img.height:
            out["media_width"], out["media_height"] = img.width, img.height
    except Exception:
        pass

    try:
        exif = img.getexif()
    except Exception:
        return out
    if not exif:
        return out

    # DateTimeOriginal and its offset live in the Exif sub-IFD, not the top
    # level; only DateTime (the file-write fallback) sits in the main one.
    try:
        exif_ifd = exif.get_ifd(_EXIF_IFD) or {}
    except Exception:
        exif_ifd = {}
    offset = _parse_utc_offset(exif_ifd.get(_TAG_OFFSET_ORIGINAL) or exif_ifd.get(_TAG_OFFSET))

    taken = (
        _parse_exif_datetime(exif_ifd.get(_TAG_DATETIME_ORIGINAL), offset)
        or _parse_exif_datetime(exif.get(_TAG_DATETIME_ORIGINAL), offset)
        or _parse_exif_datetime(exif.get(_TAG_DATETIME), offset)
    )
    if taken:
        out["taken_at"] = taken
    make, model = _clean(exif.get(_TAG_MAKE)), _clean(exif.get(_TAG_MODEL))
    if make:
        out["camera_make"] = make
    if model:
        out["camera_model"] = model

    try:
        gps = exif.get_ifd(_GPS_IFD)
    except Exception:
        gps = None
    if gps:
        lat = _dms_to_degrees(gps.get(2), _clean(gps.get(1), 4))
        lon = _dms_to_degrees(gps.get(4), _clean(gps.get(3), 4))
        if lat is not None and lon is not None:
            out["gps_latitude"], out["gps_longitude"] = lat, lon
    return out


def _parse_mvhd(buf: bytes) -> Optional[datetime]:
    """
    Pull the creation time out of an `mvhd` box.

    Located by searching the buffer for the marker rather than walking the
    box tree from the top, because these buffers are deliberately partial
    slices of the file — a proper walk needs the header the slice may not
    contain.
    """
    idx = buf.find(b"mvhd")
    if idx < 0:
        return None
    pos = idx + 4
    try:
        version = buf[pos]
        pos += 4  # version byte + 3 flag bytes
        if version == 1:
            (created,) = struct.unpack_from(">Q", buf, pos)
        else:
            (created,) = struct.unpack_from(">I", buf, pos)
    except Exception:
        return None
    if not created:
        return None
    try:
        stamp = _MP4_EPOCH + timedelta(seconds=created)
    except (OverflowError, OSError):
        return None
    # Guard against garbage from a misaligned match.
    if not (1990 <= stamp.year <= 2100):
        return None
    return stamp


def _parse_iso6709(text: str):
    """QuickTime stores location as ISO-6709, e.g. '+37.5665+126.9780/'."""
    import re
    m = re.match(r"^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)", text.strip())
    if not m:
        return None, None
    try:
        lat, lon = float(m.group(1)), float(m.group(2))
    except ValueError:
        return None, None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None, None
    return round(lat, 6), round(lon, 6)


def extract_video_metadata(buf: bytes) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    taken = _parse_mvhd(buf)
    if taken:
        out["taken_at"] = taken

    idx = buf.find(b"\xa9xyz")
    if idx >= 0:
        try:
            (size,) = struct.unpack_from(">H", buf, idx + 4)
            start = idx + 8  # marker + size(2) + language(2)
            raw = buf[start:start + min(size, 64)].decode("utf-8", "ignore")
            lat, lon = _parse_iso6709(raw)
            if lat is not None and lon is not None:
                out["gps_latitude"], out["gps_longitude"] = lat, lon
        except Exception:
            pass
    return out


def extract_metadata(file_type: str, name: str, head: bytes, tail: bytes = b"") -> Dict[str, Any]:
    """
    Dispatch on file type. Returns only the fields actually found — an empty
    dict is a normal outcome (screenshots and screen recordings carry no
    capture metadata at all) and is not an error.
    """
    lowered = (name or "").lower()
    is_video = file_type == "video" or lowered.endswith((".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"))
    if is_video:
        # Head first for faststart files, tail otherwise; merge so whichever
        # end holds the moov wins without needing to know which it was.
        merged = dict(extract_video_metadata(tail))
        for k, v in extract_video_metadata(head).items():
            merged.setdefault(k, v)
        return merged

    is_image = file_type == "image" or lowered.endswith((".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic"))
    if is_image:
        return extract_image_metadata(head)
    return {}


# ---------------------------------------------------------------------------
# Fetching + persistence
# ---------------------------------------------------------------------------
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from sqlalchemy import select, and_  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402
from app.services.s3_service import s3_service  # noqa: E402
from app.models import FileItem  # noqa: E402

_MEDIA_TYPES = ("image", "video")
_META_FIELDS = ("taken_at", "gps_latitude", "gps_longitude", "camera_make", "camera_model", "media_width", "media_height")


async def _read_ranges(file_item) -> tuple[bytes, bytes]:
    """Head slice for EXIF/faststart, tail slice for a trailing moov box."""
    head = tail = b""
    size = file_item.size_bytes or 0
    is_video = (file_item.file_type == "video")
    head_len = VIDEO_PROBE_BYTES if is_video else IMAGE_HEAD_BYTES

    res = await run_in_threadpool(s3_service.get_object_range, file_item.s3_key, f"bytes=0-{head_len - 1}")
    if res:
        head = res.get("body") or b""

    if is_video and size > VIDEO_PROBE_BYTES:
        start = max(0, size - VIDEO_PROBE_BYTES)
        res_tail = await run_in_threadpool(s3_service.get_object_range, file_item.s3_key, f"bytes={start}-{size - 1}")
        if res_tail:
            tail = res_tail.get("body") or b""
    return head, tail


async def scan_file(db: AsyncSession, file_item: FileItem, commit: bool = True) -> dict:
    """
    Extract and persist metadata for one file.

    media_scanned_at is stamped whichever way it goes, so a file with no
    metadata (every screenshot) is not re-read on every future pass. Failures
    to reach storage are deliberately NOT stamped, so a transient MinIO
    problem gets retried rather than being recorded as "nothing here".
    """
    if file_item.file_type not in _MEDIA_TYPES or not file_item.s3_key:
        return {}
    try:
        head, tail = await _read_ranges(file_item)
    except Exception as e:
        print(f"[MediaMeta] storage read failed for {file_item.id}: {e}")
        return {}
    if not head and not tail:
        return {}

    try:
        found = await run_in_threadpool(extract_metadata, file_item.file_type, file_item.name, head, tail)
    except Exception as e:
        print(f"[MediaMeta] parse failed for {file_item.id}: {e}")
        found = {}

    for field in _META_FIELDS:
        if field in found:
            setattr(file_item, field, found[field])
    file_item.media_scanned_at = datetime.now(timezone.utc)

    if commit:
        await db.commit()
    return found


async def _fetch_and_parse(file_item, semaphore) -> dict:
    """Network + parsing only, no DB access — safe to run concurrently."""
    async with semaphore:
        try:
            head, tail = await _read_ranges(file_item)
        except Exception as e:
            print(f"[MediaMeta] storage read failed for {file_item.id}: {e}")
            return None
        if not head and not tail:
            return None
        try:
            return await run_in_threadpool(extract_metadata, file_item.file_type, file_item.name, head, tail)
        except Exception as e:
            print(f"[MediaMeta] parse failed for {file_item.id}: {e}")
            return {}


async def backfill_media_metadata(db: AsyncSession, batch_size: int = 2000, concurrency: int = 12) -> int:
    """
    Fill in metadata for media uploaded before extraction existed.

    Bounded per run and driven off media_scanned_at, so it chips away at the
    backlog on each periodic pass instead of trying to read every object at
    once, and naturally stops once everything has been examined.

    Reads run concurrently because MinIO is reached over the public URL here
    (no MINIO_INTERNAL_URL is configured), so each ranged read pays real
    round-trip latency and a sequential pass over ~12k files crawls. Only the
    network and parsing are parallel: AsyncSession is not safe for concurrent
    use, so results are applied to the ORM objects afterwards, in one pass.
    """
    stmt = (
        select(FileItem)
        .where(
            and_(
                FileItem.is_trashed == False,  # noqa: E712
                FileItem.file_type.in_(_MEDIA_TYPES),
                FileItem.s3_key.isnot(None),
                FileItem.media_scanned_at.is_(None),
            )
        )
        .limit(batch_size)
    )
    files = (await db.execute(stmt)).scalars().all()
    if not files:
        return 0

    semaphore = asyncio.Semaphore(concurrency)
    results = await asyncio.gather(*(_fetch_and_parse(f, semaphore) for f in files))

    now = datetime.now(timezone.utc)
    found_count = 0
    for file_item, found in zip(files, results):
        # None means storage was unreachable — deliberately left unstamped so
        # a transient failure is retried rather than recorded as "no metadata".
        if found is None:
            continue
        for field in _META_FIELDS:
            if field in found:
                setattr(file_item, field, found[field])
        file_item.media_scanned_at = now
        if found:
            found_count += 1

    await db.commit()
    print(f"[MediaMeta] scanned {len(files)} file(s), metadata found in {found_count}")
    return len(files)
