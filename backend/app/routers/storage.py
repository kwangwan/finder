import uuid
import math
import json
import asyncio
import tempfile
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional
from botocore.exceptions import ClientError
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Response, UploadFile, File, Form, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import os
import shutil
from pathlib import Path
from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.models import FileItem, User, Folder
from app.core.security import get_current_approved_user, get_current_approved_user_query_or_header
from app.schemas.storage import (
    StorageConfigResponse, PresignedUploadRequest, PresignedUploadResponse,
    PresignedDownloadResponse, MultipartInitRequest, MultipartInitResponse,
    MultipartPartUrlsRequest, MultipartPartUrlsResponse, MultipartCompleteRequest,
    MultipartAbortRequest, ChunkInitRequest, ChunkInitResponse,
    ChunkCompleteRequest, ChunkAbortRequest
)
from app.schemas.file import FileResponse
from app.services.s3_service import s3_service, sanitize_filename, build_storage_key
from app.services.document_service import document_service
from app.services.thumbnail_service import thumbnail_service
from app.services.access_service import access_service
from app.services.quota_service import quota_service
from app.services.svg_sanitizer import sanitize_svg

router = APIRouter(prefix="/api/storage", tags=["Storage & Uploads"])


async def _stream_s3_object(s3_key: str, chunk_size: int = 1024 * 1024):
    """
    Yield an S3/MinIO object's bytes in chunks instead of buffering the whole
    thing into memory first — used for the no-Range fallback response below.
    Without this, previewing/downloading a large file (e.g. a several-
    hundred-MB video with no Range header from the browser's first request)
    meant reading the entire object into RAM before a single byte reached the
    client, which is exactly what made large videos feel like they loaded the
    whole file before playing anything. Each chunk read is offloaded via
    run_in_threadpool since boto3's StreamingBody.read() is a blocking call.
    """
    resp = await run_in_threadpool(s3_service.client.get_object, Bucket=s3_service.bucket_name, Key=s3_key)
    body = resp["Body"]
    try:
        while True:
            chunk = await run_in_threadpool(body.read, chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        body.close()

@router.get("/config", response_model=StorageConfigResponse)
async def get_storage_config(
    current_user: User = Depends(get_current_approved_user)
):
    """Return storage chunking configuration (MINIO_MAX_CHUNK_SIZE_MB)."""
    chunk_mb = settings.MINIO_MAX_CHUNK_SIZE_MB
    return StorageConfigResponse(
        max_chunk_size_mb=chunk_mb,
        chunk_size_bytes=chunk_mb * 1024 * 1024,
        public_url=settings.MINIO_PUBLIC_URL
    )

@router.post("/presigned-upload", response_model=PresignedUploadResponse)
async def get_presigned_upload_url(
    req: PresignedUploadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Generate a single presigned PUT URL for files smaller than chunk size."""
    # Storage quota check on workspace owner
    workspace_id = None
    if req.folder_id:
        folder = await db.get(Folder, req.folder_id)
        if folder:
            workspace_id = folder.workspace_id
    await quota_service.check_quota(db, workspace_id, current_user, req.size_bytes)

    file_uuid = uuid.uuid4()
    s3_key = build_storage_key("uploads", file_uuid, req.filename)

    try:
        url = s3_service.generate_presigned_put_url(
            s3_key=s3_key,
            content_type=req.content_type
        )
        return PresignedUploadResponse(
            upload_url=url,
            s3_key=s3_key,
            method="PUT",
            headers={"Content-Type": req.content_type}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate presigned upload URL: {str(e)}")

@router.get("/presigned-download/{file_id}", response_model=PresignedDownloadResponse)
async def get_presigned_download_url(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Generate a presigned GET URL for downloading or viewing a file."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 다운로드 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="File or storage key not found")

    try:
        url = s3_service.generate_presigned_get_url(
            s3_key=file_item.s3_key,
            filename=file_item.name,
            expires_in=3600
        )
        return PresignedDownloadResponse(
            download_url=url,
            filename=file_item.name,
            expires_in=3600
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate download URL: {str(e)}")

@router.get("/chunk-download/{file_id}")
async def download_file_chunk(
    file_id: uuid.UUID,
    range: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Download a byte range of a file (Chunked Range Download).
    Allows downloading massive files through Cloudflare Zero Trust by splitting into 50MB range chunks.
    """
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 다운로드 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="File not found")

    range_header = range or f"bytes=0-{file_item.size_bytes - 1}"
    res = await run_in_threadpool(s3_service.get_object_range, file_item.s3_key, range_header)
    
    if not res:
        raise HTTPException(status_code=500, detail="Failed to fetch byte chunk from storage")

    safe_name = urllib.parse.quote(file_item.name)
    headers = {
        "Content-Range": res["content_range"] or f"bytes 0-{len(res['body'])-1}/{file_item.size_bytes}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(len(res["body"])),
        "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}",
        "Content-Type": res["content_type"],
    }

    return Response(
        content=res["body"],
        status_code=status.HTTP_206_PARTIAL_CONTENT if range else status.HTTP_200_OK,
        headers=headers,
        media_type=res["content_type"]
    )

@router.post("/multipart/initiate", response_model=MultipartInitResponse)
async def initiate_multipart_upload(
    req: MultipartInitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Initiate S3 multipart upload for large files based on MINIO_MAX_CHUNK_SIZE_MB."""
    workspace_id = req.workspace_id
    if not workspace_id and req.folder_id:
        folder = await db.get(Folder, req.folder_id)
        if folder:
            workspace_id = folder.workspace_id
    await quota_service.check_quota(db, workspace_id, current_user, req.size_bytes)

    file_uuid = uuid.uuid4()
    s3_key = build_storage_key("uploads", file_uuid, req.filename)
    
    chunk_bytes = settings.MINIO_MAX_CHUNK_SIZE_MB * 1024 * 1024
    total_parts = math.ceil(req.size_bytes / chunk_bytes) if req.size_bytes > 0 else 1

    try:
        upload_id = s3_service.create_multipart_upload(
            s3_key=s3_key,
            content_type=req.content_type
        )
        return MultipartInitResponse(
            upload_id=upload_id,
            s3_key=s3_key,
            chunk_size_mb=settings.MINIO_MAX_CHUNK_SIZE_MB,
            chunk_size_bytes=chunk_bytes,
            total_parts=total_parts
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initiate multipart upload: {str(e)}")

@router.post("/multipart/part-urls", response_model=MultipartPartUrlsResponse)
async def get_multipart_part_urls(
    req: MultipartPartUrlsRequest,
    current_user: User = Depends(get_current_approved_user)
):
    """Generate presigned PUT URLs for each requested part number."""
    try:
        parts = s3_service.generate_multipart_presigned_urls(
            s3_key=req.s3_key,
            upload_id=req.upload_id,
            part_numbers=req.part_numbers
        )
        return MultipartPartUrlsResponse(parts=parts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate part URLs: {str(e)}")

@router.post("/multipart/complete", response_model=FileResponse)
async def complete_multipart_upload(
    req: MultipartCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Complete S3 multipart upload and save file metadata in PostgreSQL."""
    try:
        s3_service.complete_multipart_upload(
            s3_key=req.s3_key,
            upload_id=req.upload_id,
            parts=[p.dict() for p in req.parts]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to complete multipart upload on S3: {str(e)}")

    # Detect file type
    name_lower = req.filename.lower()
    file_type = req.file_type or "other"
    is_markdown = False
    if name_lower.endswith(".md"):
        file_type = "note"
        is_markdown = True
    elif name_lower.endswith(".pdf"):
        file_type = "pdf"
    elif name_lower.endswith((".docx", ".doc")):
        file_type = "docx"
    elif name_lower.endswith((".xlsx", ".xls")):
        file_type = "xlsx"
    elif name_lower.endswith((".txt", ".json", ".csv", ".py", ".js", ".html", ".css", ".yaml", ".yml")):
        file_type = "text"
    elif name_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
        file_type = "image"
    elif name_lower.endswith((".zip", ".tar", ".gz", ".7z", ".rar")):
        file_type = "archive"

    workspace_id = req.workspace_id
    if req.folder_id:
        if not await access_service.can_access_folder(db, current_user, req.folder_id):
            raise HTTPException(status_code=403, detail="폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, req.folder_id)
        if folder:
            if workspace_id and folder.workspace_id and workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")
            if not workspace_id:
                workspace_id = folder.workspace_id

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    # Generate thumbnail for media files if applicable
    thumbnail_s3_key = None
    if file_type in ("image", "video"):
        try:
            # Download bytes from S3 (or range for video) to generate thumbnail
            media_bytes = await run_in_threadpool(s3_service.get_object_content, req.s3_key)
            if media_bytes:
                file_uuid = req.s3_key.split("/")[1] if "/" in req.s3_key else str(uuid.uuid4())
                thumbnail_s3_key = await run_in_threadpool(
                    thumbnail_service.create_and_store_thumbnail,
                    file_uuid=file_uuid,
                    filename=req.filename,
                    file_bytes=media_bytes,
                    file_type=file_type
                )
        except Exception as thumb_err:
            print(f"[Thumbnail Warning] Multipart thumbnail generation failed: {thumb_err}")

    file_item = FileItem(
        folder_id=req.folder_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        name=req.filename,
        file_type=file_type,
        mime_type=req.mime_type,
        size_bytes=req.size_bytes,
        s3_key=req.s3_key,
        thumbnail_s3_key=thumbnail_s3_key,
        is_markdown=is_markdown
    )
    db.add(file_item)
    await db.commit()
    await db.refresh(file_item)

    # Update workspace owner storage usage
    await quota_service.record_storage_added(db, workspace_id, current_user, req.size_bytes or 0)

    # Index embeddings
    try:
        await document_service.index_file_chunks(db, file_item)
    except Exception as e:
        print(f"[Embedding Warning] Indexing failed for multipart file {file_item.id}: {e}")

    resp = FileResponse.model_validate(file_item)
    if file_item.thumbnail_s3_key:
        resp.thumbnail_url = f"/api/storage/thumbnail/{file_item.id}"
    return resp

@router.post("/multipart/abort")
async def abort_multipart_upload(
    req: MultipartAbortRequest,
    current_user: User = Depends(get_current_approved_user)
):
    """Abort multipart upload session."""
    s3_service.abort_multipart_upload(s3_key=req.s3_key, upload_id=req.upload_id)
    return {"status": "aborted"}

TEMP_CHUNKS_DIR = Path(__file__).resolve().parent.parent.parent / "storage_data" / "temp_chunks"
TEMP_CHUNKS_DIR.mkdir(parents=True, exist_ok=True)


def _read_chunk_session_meta(session_dir: Path) -> Optional[dict]:
    meta_path = session_dir / "meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text())
    except Exception:
        return None


def _abort_chunk_session(session_dir: Path):
    """Abort the underlying MinIO multipart upload (freeing any parts already
    streamed to it) and remove the local session directory. Safe to call on a
    session that was never fully initialized."""
    meta = _read_chunk_session_meta(session_dir)
    if meta and meta.get("s3_key") and meta.get("minio_upload_id"):
        try:
            s3_service.abort_multipart_upload(meta["s3_key"], meta["minio_upload_id"])
        except Exception as e:
            print(f"[Chunk Upload Warning] Could not abort MinIO multipart upload: {e}")
    shutil.rmtree(session_dir, ignore_errors=True)


async def cleanup_stale_chunk_sessions(db: AsyncSession, max_age_hours: int = 24) -> int:
    """
    Remove abandoned chunk-upload sessions (e.g. a browser tab closed mid-upload,
    or a network drop that never reached /chunk/abort) that have not received a
    new part in over max_age_hours. An active upload keeps writing parts, so its
    session directory's newest file mtime stays recent and it is never touched
    by this cleanup.

    Each part is streamed straight into a MinIO multipart upload as it arrives
    (see /chunk/part), so an abandoned session isn't just a few KB of local
    metadata — it's however many parts the user got through before giving up,
    sitting in MinIO as an incomplete upload, plus its quota reservation still
    held against the owner. Without this, both would never be reclaimed.
    """
    import time
    removed = 0
    cutoff = time.time() - max_age_hours * 3600
    for session_dir in TEMP_CHUNKS_DIR.iterdir():
        if not session_dir.is_dir():
            continue
        try:
            newest_mtime = max(
                (p.stat().st_mtime for p in session_dir.rglob("*") if p.is_file()),
                default=session_dir.stat().st_mtime
            )
            if newest_mtime < cutoff:
                meta = _read_chunk_session_meta(session_dir)
                _abort_chunk_session(session_dir)
                if meta:
                    await quota_service.release_reservation(db, meta.get("owner_id"), meta.get("reserved_bytes", 0))
                removed += 1
        except Exception:
            pass
    return removed


async def cleanup_phantom_files(db: AsyncSession, max_age_hours: int = 48) -> int:
    """
    Delete FileItem rows whose s3_key doesn't actually exist in storage — a
    file that's counted in listings/stats but can never be opened. This can
    happen if the storage write fails after the row was already committed
    (e.g. a mid-request crash) or, historically, from a since-fixed bug where
    a failed S3 put was silently swallowed and the row got created anyway.

    Scoped to recently-created rows (not the whole table) so this stays cheap
    as the table grows — anything older has already been checked by a
    previous run of this same periodic job.
    """
    cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
    res = await db.execute(
        select(FileItem).where(FileItem.created_at >= cutoff, FileItem.s3_key.isnot(None))
    )
    files = res.scalars().all()

    async def _is_missing(f) -> bool:
        try:
            await run_in_threadpool(s3_service.client.head_object, Bucket=s3_service.bucket_name, Key=f.s3_key)
            return False
        except ClientError as e:
            # Only treat a definitive "not found" as phantom — a transient
            # network/API error here must not delete a perfectly good file.
            return e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey")
        except Exception:
            return False

    removed = 0
    batch_size = 20
    for i in range(0, len(files), batch_size):
        batch = files[i:i + batch_size]
        missing_flags = await asyncio.gather(*(_is_missing(f) for f in batch))
        for f, is_missing in zip(batch, missing_flags):
            if not is_missing:
                continue
            await quota_service.record_storage_freed(
                db=db, workspace_id=f.workspace_id, creator_id=f.created_by, bytes_freed=f.size_bytes or 0
            )
            await db.delete(f)
            await db.commit()
            removed += 1
    return removed


async def backfill_missing_thumbnails(db: AsyncSession, batch_size: int = 5) -> int:
    """
    (Re)generate thumbnails for image/video files that don't have one — e.g.
    a transient failure during upload (a large video timing out, a momentary
    S3/MinIO blip under heavy concurrent load). Unlike cleanup_phantom_files
    this isn't scoped to a recent time window: a missing thumbnail should
    stay rare regardless of how large the table grows, so scanning the whole
    (small) "no thumbnail yet" set on every run is cheap — there's no ever-
    growing backlog to bound.
    """
    res = await db.execute(
        select(FileItem).where(
            FileItem.is_trashed == False,
            FileItem.file_type.in_(["image", "video"]),
            FileItem.thumbnail_s3_key.is_(None),
            FileItem.s3_key.isnot(None),
        )
    )
    files = res.scalars().all()

    async def _generate_one(f: FileItem) -> Optional[str]:
        try:
            if f.file_type == "image":
                image_bytes = await run_in_threadpool(s3_service.get_object_content, f.s3_key)
                if not image_bytes:
                    return None
                return await run_in_threadpool(
                    thumbnail_service.create_and_store_thumbnail,
                    file_uuid=str(f.id), filename=f.name, file_bytes=image_bytes, file_type="image"
                )
            else:
                tmp_path = None
                try:
                    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(f.name).suffix) as tmp:
                        tmp_path = tmp.name
                    await run_in_threadpool(
                        s3_service.client.download_file, Bucket=s3_service.bucket_name, Key=f.s3_key, Filename=tmp_path
                    )
                    return await run_in_threadpool(
                        thumbnail_service.create_and_store_thumbnail_from_path,
                        file_uuid=str(f.id), filename=f.name, file_path=tmp_path, file_type="video"
                    )
                finally:
                    if tmp_path and os.path.exists(tmp_path):
                        os.remove(tmp_path)
        except Exception as e:
            print(f"[Thumbnail Backfill Warning] Failed for file {f.id}: {e}")
            return None

    generated = 0
    for i in range(0, len(files), batch_size):
        batch = files[i:i + batch_size]
        results = await asyncio.gather(*(_generate_one(f) for f in batch))
        for f, thumb_key in zip(batch, results):
            if thumb_key:
                f.thumbnail_s3_key = thumb_key
                generated += 1
        await db.commit()
    return generated

@router.post("/chunk/init", response_model=ChunkInitResponse)
async def init_chunk_upload(
    req: ChunkInitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Initialize a proxy chunked upload session (5MB per chunk, 100% Cloudflare
    Tunnel safe). Immediately opens a matching MinIO multipart upload, so each
    part can be streamed straight to storage as it arrives (see /chunk/part)
    instead of accumulating on local disk to be re-uploaded as one object at
    completion time — for a large file, that re-upload was slow enough to
    exceed the Cloudflare Tunnel's request timeout, making /chunk/complete
    fail even though the file had, in fact, fully uploaded.
    """
    workspace_id = req.workspace_id
    if req.folder_id:
        if not await access_service.can_access_folder(db, current_user, req.folder_id):
            raise HTTPException(status_code=403, detail="폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, req.folder_id)
        if folder:
            if folder.is_trashed:
                raise HTTPException(status_code=400, detail="업로드 대상 폴더가 휴지통으로 이동되어 업로드할 수 없습니다.")
            if workspace_id and folder.workspace_id and workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")
            if not workspace_id:
                workspace_id = folder.workspace_id
    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    # Reserve the declared size up front rather than just checking it, so a
    # second large upload starting seconds later (possibly from another
    # browser/device) can't also pass the check before this one finishes and
    # updates storage_used_bytes — see quota_service.reserve_quota.
    owner = await quota_service.reserve_quota(db, workspace_id, current_user, req.size_bytes)

    file_uuid = uuid.uuid4()
    s3_key = build_storage_key("uploads", file_uuid, req.filename)
    try:
        minio_upload_id = s3_service.create_multipart_upload(
            s3_key=s3_key,
            content_type=req.content_type or "application/octet-stream"
        )
    except Exception:
        await quota_service.release_reservation(db, owner.id, req.size_bytes)
        raise

    upload_id = str(uuid.uuid4())
    session_dir = TEMP_CHUNKS_DIR / upload_id
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "meta.json").write_text(json.dumps({
        "s3_key": s3_key,
        "minio_upload_id": minio_upload_id,
        "filename": req.filename,
        "size_bytes": req.size_bytes,
        "workspace_id": str(workspace_id) if workspace_id else None,
        "folder_id": str(req.folder_id) if req.folder_id else None,
        "mime_type": req.content_type,
        "owner_id": str(owner.id),
        "reserved_bytes": req.size_bytes,
        "bytes_by_part": {},
    }))

    chunk_bytes = settings.MINIO_MAX_CHUNK_SIZE_MB * 1024 * 1024
    total_parts = math.ceil(req.size_bytes / chunk_bytes) if req.size_bytes > 0 else 1

    return ChunkInitResponse(
        upload_id=upload_id,
        chunk_size_mb=settings.MINIO_MAX_CHUNK_SIZE_MB,
        chunk_size_bytes=chunk_bytes,
        total_parts=total_parts
    )

@router.post("/chunk/part")
async def upload_chunk_part(
    upload_id: str = Form(...),
    part_number: int = Form(...),
    chunk: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Stream an individual chunk part (5MB) directly into the session's MinIO
    multipart upload — never touches local disk, so completion doesn't need to
    re-upload the whole file (see /chunk/init)."""
    session_dir = TEMP_CHUNKS_DIR / upload_id
    meta = _read_chunk_session_meta(session_dir)
    if not meta:
        raise HTTPException(status_code=404, detail="Upload session expired or not found")

    chunk_bytes = await chunk.read()

    # The quota reservation at /chunk/init was sized to the client-declared
    # size_bytes. A client could under-declare that and then stream more data
    # than it reserved, so cap actual bytes received at the reservation (with
    # one chunk of slack for the final, possibly larger-than-expected part).
    # Bytes are tracked per part_number (not a running counter) so that a
    # retried part — e.g. after a Cloudflare Tunnel 502 that the client saw as
    # a failure even though this endpoint actually finished processing it —
    # overwrites its own entry instead of being counted twice; an additive
    # counter double-counts every such retry and can trip this limit on an
    # upload that never actually exceeded its declared size.
    bytes_by_part = meta.get("bytes_by_part", {})
    reserved = meta.get("reserved_bytes", meta.get("size_bytes", 0))
    chunk_limit_bytes = settings.MINIO_MAX_CHUNK_SIZE_MB * 1024 * 1024
    prospective_total = sum(bytes_by_part.values()) - bytes_by_part.get(str(part_number), 0) + len(chunk_bytes)
    if reserved and prospective_total > reserved + chunk_limit_bytes:
        _abort_chunk_session(session_dir)
        await quota_service.release_reservation(db, meta.get("owner_id"), meta.get("reserved_bytes", 0))
        raise HTTPException(status_code=413, detail="업로드된 데이터가 선언한 파일 크기를 초과했습니다.")

    try:
        etag = s3_service.upload_part(meta["s3_key"], meta["minio_upload_id"], part_number, chunk_bytes)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to store chunk part {part_number} in MinIO: {e}")

    # Each part's ETag goes in its own file so out-of-order or retried parts
    # never clobber each other. meta.json is safe to read-modify-write because
    # the client sends parts for a given upload_id strictly sequentially (see
    # api/index.js), never concurrently.
    (session_dir / f"part_{part_number:05d}.etag").write_text(etag)
    bytes_by_part[str(part_number)] = len(chunk_bytes)
    meta["bytes_by_part"] = bytes_by_part
    (session_dir / "meta.json").write_text(json.dumps(meta))

    return {"upload_id": upload_id, "part_number": part_number, "bytes_received": len(chunk_bytes)}

async def _generate_and_save_video_thumbnail(file_id: uuid.UUID, s3_key: str, filename: str):
    """Runs as a FastAPI BackgroundTask, after /chunk/complete's response has
    already been sent. Video thumbnailing needs the whole object downloaded
    back from MinIO so OpenCV can seek a frame — for a large video that can
    take far longer than the reverse proxy sitting in front of this app is
    willing to wait, which was turning into an outright upload failure (a 504)
    even though the upload itself had already fully succeeded. Doing this
    afterward, off the request/response path, means a slow thumbnail can
    never fail the upload — uses its own DB session since the request's is
    long gone by the time this runs."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix) as tmp:
            tmp_path = tmp.name
        await run_in_threadpool(
            s3_service.client.download_file, Bucket=s3_service.bucket_name, Key=s3_key, Filename=tmp_path
        )
        thumbnail_s3_key = await run_in_threadpool(
            thumbnail_service.create_and_store_thumbnail_from_path,
            file_uuid=str(file_id), filename=filename, file_path=tmp_path, file_type="video"
        )
        if thumbnail_s3_key:
            async with AsyncSessionLocal() as db:
                file_item = await db.get(FileItem, file_id)
                if file_item and not file_item.is_trashed:
                    file_item.thumbnail_s3_key = thumbnail_s3_key
                    await db.commit()
    except Exception as e:
        print(f"[Thumbnail Warning] Background video thumbnail generation failed for {file_id}: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

@router.post("/chunk/complete", response_model=FileResponse)
async def complete_chunk_upload(
    req: ChunkCompleteRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Finalize a chunked upload: complete the MinIO multipart upload from the
    ETags collected in /chunk/part (no local merge — every part is already in
    MinIO), generate a thumbnail, extract text content, and record the file.
    """
    session_dir = TEMP_CHUNKS_DIR / req.upload_id
    meta = _read_chunk_session_meta(session_dir)
    if not meta:
        raise HTTPException(status_code=404, detail="Upload session not found")

    s3_key = meta["s3_key"]
    file_uuid = uuid.UUID(s3_key.split("/")[1])

    parts = []
    for part_num in range(1, req.total_parts + 1):
        etag_file = session_dir / f"part_{part_num:05d}.etag"
        if not etag_file.exists():
            _abort_chunk_session(session_dir)
            await quota_service.release_reservation(db, meta.get("owner_id"), meta.get("reserved_bytes", 0))
            raise HTTPException(status_code=400, detail=f"Missing chunk part {part_num}")
        parts.append({"PartNumber": part_num, "ETag": etag_file.read_text().strip()})

    try:
        s3_service.complete_multipart_upload(s3_key=s3_key, upload_id=meta["minio_upload_id"], parts=parts)
    except Exception as e:
        _abort_chunk_session(session_dir)
        await quota_service.release_reservation(db, meta.get("owner_id"), meta.get("reserved_bytes", 0))
        raise HTTPException(status_code=500, detail=f"Failed to finalize upload in MinIO: {str(e)}")

    # The object is now final in MinIO — local session metadata can go.
    shutil.rmtree(session_dir, ignore_errors=True)

    try:
        actual_size = s3_service.client.head_object(Bucket=s3_service.bucket_name, Key=s3_key)["ContentLength"]
    except Exception:
        actual_size = req.size_bytes

    # Detect file type
    name_lower = req.filename.lower()
    file_type = "other"
    is_markdown = False
    if name_lower.endswith(".md"):
        file_type = "note"
        is_markdown = True
    elif name_lower.endswith(".pdf"):
        file_type = "pdf"
    elif name_lower.endswith((".docx", ".doc")):
        file_type = "docx"
    elif name_lower.endswith((".xlsx", ".xls")):
        file_type = "xlsx"
    elif name_lower.endswith((".txt", ".json", ".csv", ".py", ".js", ".html", ".css", ".yaml", ".yml")):
        file_type = "text"
    elif name_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp")):
        file_type = "image"
    elif name_lower.endswith((".mp4", ".webm", ".mov", ".avi", ".mkv")):
        file_type = "video"
    elif name_lower.endswith((".mp3", ".wav", ".ogg", ".m4a", ".flac")):
        file_type = "audio"
    elif name_lower.endswith((".zip", ".tar", ".gz", ".7z", ".rar")):
        file_type = "archive"

    # Use the workspace/folder resolved and permission-checked at /chunk/init
    # (recorded in meta.json), not whatever req carries now — the quota was
    # reserved against that workspace's owner, so filing the resulting file
    # under a different one here would leave that reservation stranded as
    # phantom "used" storage while the real target workspace's quota was
    # never checked at all.
    workspace_id = uuid.UUID(meta["workspace_id"]) if meta.get("workspace_id") else None
    folder_id = uuid.UUID(meta["folder_id"]) if meta.get("folder_id") else None

    async def _fail_and_cleanup(status_code: int, detail: str):
        try:
            await run_in_threadpool(s3_service.delete_object, s3_key)
        except Exception:
            pass
        await quota_service.release_reservation(db, meta.get("owner_id"), meta.get("reserved_bytes", 0))
        raise HTTPException(status_code=status_code, detail=detail)

    if folder_id and not await access_service.can_access_folder(db, current_user, folder_id):
        await _fail_and_cleanup(403, "폴더에 접근할 권한이 없습니다.")
    if workspace_id and not await access_service.is_workspace_member(db, current_user, workspace_id):
        await _fail_and_cleanup(403, "이 워크스페이스에 접근할 권한이 없습니다.")
    if folder_id:
        # A large upload's parts can take a while — long enough for the user
        # to trash the target folder before /chunk/complete runs. Without
        # this, the resulting FileItem would have is_trashed=False sitting
        # invisibly under a trashed parent: not in the folder view, not in
        # trash, still counted in stats.
        target_folder = await db.get(Folder, folder_id)
        if target_folder and target_folder.is_trashed:
            await _fail_and_cleanup(400, "업로드 대상 폴더가 휴지통으로 이동되어 업로드할 수 없습니다.")

    # The quota for this upload was already reserved at /chunk/init (see
    # quota_service.reserve_quota) and enforced per-part in /chunk/part, so
    # there's nothing left to check here — just turn the reservation into
    # real usage now that the final size is known.
    await quota_service.commit_reservation(
        db, meta.get("owner_id"), meta.get("reserved_bytes", req.size_bytes), actual_size
    )

    mime_type = req.mime_type or get_media_mime_type(req.filename)

    # Generate thumbnail for media files. Images are small enough to load
    # fully within this request. Videos are handled separately, after the
    # FileItem exists — see _generate_and_save_video_thumbnail above.
    thumbnail_s3_key = None
    if file_type == "image":
        try:
            image_bytes = await run_in_threadpool(s3_service.get_object_content, s3_key)
            if image_bytes:
                thumbnail_s3_key = await run_in_threadpool(
                    thumbnail_service.create_and_store_thumbnail,
                    file_uuid=str(file_uuid), filename=req.filename, file_bytes=image_bytes, file_type=file_type
                )
        except Exception as thumb_err:
            print(f"[Thumbnail Warning] Chunk thumbnail generation failed: {thumb_err}")

    # Read content for text/markdown
    content = None
    if is_markdown or file_type == "text":
        try:
            content_bytes = await run_in_threadpool(s3_service.get_object_content, s3_key)
            if content_bytes:
                content = content_bytes.decode("utf-8", errors="ignore")
        except Exception:
            pass

    file_item = FileItem(
        folder_id=folder_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        name=req.filename,
        file_type=file_type,
        mime_type=mime_type,
        size_bytes=actual_size,
        s3_key=s3_key,
        thumbnail_s3_key=thumbnail_s3_key,
        content=content,
        is_markdown=is_markdown
    )
    db.add(file_item)
    try:
        await db.commit()
    except Exception:
        # The object is already finalized in S3 with nothing pointing to it —
        # clean it up rather than leaving an orphaned blob nothing references.
        await run_in_threadpool(s3_service.delete_object, s3_key)
        if thumbnail_s3_key:
            await run_in_threadpool(s3_service.delete_object, thumbnail_s3_key)
        raise
    await db.refresh(file_item)

    if file_type == "video":
        background_tasks.add_task(_generate_and_save_video_thumbnail, file_item.id, s3_key, req.filename)

    # Index embeddings
    try:
        await document_service.index_file_chunks(db, file_item)
    except Exception as e:
        print(f"[Embedding Warning] Indexing failed for chunk file {file_item.id}: {e}")

    resp = FileResponse.model_validate(file_item)
    if file_item.thumbnail_s3_key:
        resp.thumbnail_url = f"/api/storage/thumbnail/{file_item.id}"
    return resp

@router.post("/chunk/abort")
async def abort_chunk_upload(
    req: ChunkAbortRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Abort a chunked upload: cancels the MinIO multipart upload (discarding
    any parts already streamed to it), releases its quota reservation, and
    removes the local session."""
    session_dir = TEMP_CHUNKS_DIR / req.upload_id
    if session_dir.exists():
        meta = _read_chunk_session_meta(session_dir)
        _abort_chunk_session(session_dir)
        if meta:
            await quota_service.release_reservation(db, meta.get("owner_id"), meta.get("reserved_bytes", 0))
    return {"status": "aborted"}


@router.post("/direct-upload", response_model=FileResponse)
async def direct_upload(
    file: UploadFile = File(...),
    workspace_id: Optional[uuid.UUID] = Form(None),
    folder_id: Optional[uuid.UUID] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Direct upload fallback route for smaller files or direct proxying."""
    file_bytes = await file.read()

    if folder_id:
        if not await access_service.can_access_folder(db, current_user, folder_id):
            raise HTTPException(status_code=403, detail="폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, folder_id)
        if folder:
            # A folder trashed while this file was still mid-upload (e.g. a
            # large background batch racing against the user deleting its
            # target folder) would otherwise leave a FileItem with
            # is_trashed=False sitting invisibly under a trashed parent —
            # not shown in the folder view, not shown in trash, still
            # counted in stats.
            if folder.is_trashed:
                raise HTTPException(status_code=400, detail="업로드 대상 폴더가 휴지통으로 이동되어 업로드할 수 없습니다.")
            if workspace_id and folder.workspace_id and workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")
            if not workspace_id:
                workspace_id = folder.workspace_id

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    # Reserve the size up front (atomically checked-and-claimed in one UPDATE)
    # rather than just checking it, so two direct uploads landing at nearly
    # the same moment can't both pass the check against the same stale
    # storage_used_bytes and together exceed quota — same reasoning as the
    # chunked-upload path's quota_service.reserve_quota.
    owner = await quota_service.reserve_quota(db, workspace_id, current_user, len(file_bytes))
    file_uuid = uuid.uuid4()
    s3_key = build_storage_key("uploads", file_uuid, file.filename)

    try:
        await run_in_threadpool(s3_service.put_object, s3_key, file_bytes, file.content_type or "application/octet-stream")
    except Exception as e:
        # Storage write failed — do not create a FileItem row for content that
        # doesn't actually exist in S3. Swallowing this here (as it used to)
        # left a phantom file counted in stats/listings with a s3_key nothing
        # was ever written to.
        await quota_service.release_reservation(db, owner.id, len(file_bytes))
        raise HTTPException(status_code=502, detail=f"파일을 스토리지에 저장하지 못했습니다: {e}")

    name_lower = file.filename.lower()
    is_markdown = name_lower.endswith(".md")
    file_type = "other"
    if is_markdown:
        file_type = "note"
    elif name_lower.endswith(".pdf"):
        file_type = "pdf"
    elif name_lower.endswith((".docx", ".doc")):
        file_type = "docx"
    elif name_lower.endswith((".xlsx", ".xls")):
        file_type = "xlsx"
    elif name_lower.endswith((".txt", ".json", ".csv", ".py", ".js", ".html", ".css", ".yaml", ".yml")):
        file_type = "text"
    elif name_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp")):
        file_type = "image"
    elif name_lower.endswith((".mp4", ".webm", ".mov", ".avi", ".mkv")):
        file_type = "video"
    elif name_lower.endswith((".zip", ".tar", ".gz", ".7z", ".rar")):
        file_type = "archive"

    content = None
    if is_markdown or file_type == "text":
        try:
            content = file_bytes.decode("utf-8")
        except Exception:
            pass

    # Generate thumbnail for media files
    thumbnail_s3_key = None
    if file_type in ("image", "video"):
        try:
            thumbnail_s3_key = await run_in_threadpool(
                thumbnail_service.create_and_store_thumbnail,
                file_uuid=str(file_uuid),
                filename=file.filename,
                file_bytes=file_bytes,
                file_type=file_type
            )
        except Exception as thumb_err:
            print(f"[Thumbnail Warning] Direct upload thumbnail failed: {thumb_err}")

    file_item = FileItem(
        folder_id=folder_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        name=file.filename,
        file_type=file_type,
        mime_type=file.content_type,
        size_bytes=len(file_bytes),
        s3_key=s3_key,
        thumbnail_s3_key=thumbnail_s3_key,
        content=content,
        is_markdown=is_markdown
    )
    db.add(file_item)
    try:
        await db.commit()
    except Exception:
        # The object is already sitting in S3 with nothing pointing to it —
        # clean it up rather than leaving an orphaned blob nothing references.
        await run_in_threadpool(s3_service.delete_object, s3_key)
        if thumbnail_s3_key:
            await run_in_threadpool(s3_service.delete_object, thumbnail_s3_key)
        await quota_service.release_reservation(db, owner.id, len(file_bytes))
        raise
    await db.refresh(file_item)

    # Turn the reservation into real usage now that the FileItem row exists.
    await quota_service.commit_reservation(db, owner.id, len(file_bytes), len(file_bytes))

    try:
        await document_service.index_file_chunks(db, file_item, raw_bytes=file_bytes)
    except Exception as e:
        print(f"[Embedding Warning] Indexing failed for direct file {file_item.id}: {e}")

    resp = FileResponse.model_validate(file_item)
    if file_item.thumbnail_s3_key:
        resp.thumbnail_url = f"/api/storage/thumbnail/{file_item.id}"
    return resp

def get_media_mime_type(filename: str, stored_mime: Optional[str] = None) -> str:
    if stored_mime and stored_mime != "application/octet-stream":
        return stored_mime
    name_lower = filename.lower()
    if name_lower.endswith(".png"): return "image/png"
    if name_lower.endswith((".jpg", ".jpeg")): return "image/jpeg"
    if name_lower.endswith(".gif"): return "image/gif"
    if name_lower.endswith(".webp"): return "image/webp"
    if name_lower.endswith(".svg"): return "image/svg+xml"
    if name_lower.endswith(".mp4"): return "video/mp4"
    if name_lower.endswith(".webm"): return "video/webm"
    if name_lower.endswith(".mov"): return "video/quicktime"
    if name_lower.endswith(".pdf"): return "application/pdf"
    if name_lower.endswith(".md"): return "text/markdown; charset=utf-8"
    if name_lower.endswith(".txt"): return "text/plain; charset=utf-8"
    return stored_mime or "application/octet-stream"

@router.get("/preview/{file_id}")
async def preview_file(
    file_id: uuid.UUID,
    range: Optional[str] = Header(None),
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user_query_or_header)
):
    """Serve file inline for browser preview (images, videos with range seek, pdf, etc.)."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 접근 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="File or storage key not found")

    mime_type = get_media_mime_type(file_item.name, file_item.mime_type)
    safe_name = urllib.parse.quote(file_item.name)
    is_svg = mime_type == "image/svg+xml"

    # SVG is XML and can carry <script>/event-handler attributes that the browser
    # executes when rendered inline in the app's own origin. Never serve raw SVG
    # bytes inline — always sanitize first (small documents, so skip range-serving).
    if range and not is_svg:
        res = await run_in_threadpool(s3_service.get_object_range, file_item.s3_key, range)
        if res:
            headers = {
                "Content-Range": res["content_range"] or f"bytes 0-{len(res['body'])-1}/{file_item.size_bytes}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(res["body"])),
                "Content-Disposition": f"inline; filename*=UTF-8''{safe_name}",
                "Content-Type": mime_type,
                "Cache-Control": "public, max-age=3600"
            }
            return Response(
                content=res["body"],
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                headers=headers,
                media_type=mime_type
            )

    if is_svg:
        # SVGs are small documents that need full-buffer sanitization anyway,
        # so there's no streaming benefit to skip here.
        raw_bytes = await run_in_threadpool(s3_service.get_object_content, file_item.s3_key)
        if raw_bytes is None:
            raise HTTPException(status_code=404, detail="파일 데이터를 찾을 수 없습니다.")

        content_disposition = f"inline; filename*=UTF-8''{safe_name}"
        sanitized = sanitize_svg(raw_bytes)
        if sanitized is None:
            # Couldn't safely parse/sanitize it — fall back to a forced download
            # instead of ever rendering unsanitized SVG inline.
            content_disposition = f"attachment; filename*=UTF-8''{safe_name}"
        else:
            raw_bytes = sanitized

        return Response(
            content=raw_bytes,
            status_code=status.HTTP_200_OK,
            headers={
                "Content-Disposition": content_disposition,
                "Content-Type": mime_type,
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(raw_bytes)),
                "Cache-Control": "public, max-age=3600"
            },
            media_type=mime_type
        )

    # No Range header (e.g. a browser's first request for a <video> element)
    # — stream straight from S3/MinIO instead of buffering the whole object
    # into memory first. For a several-hundred-MB video, buffering meant
    # nothing reached the client until the entire file had been downloaded
    # backend-side, which is what made playback feel like it was fetching
    # the whole file up front instead of streaming.
    return StreamingResponse(
        _stream_s3_object(file_item.s3_key),
        status_code=status.HTTP_200_OK,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{safe_name}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_item.size_bytes) if file_item.size_bytes else "",
            "Cache-Control": "public, max-age=3600"
        },
        media_type=mime_type
    )

@router.get("/download/{file_id}")
async def direct_file_download(
    file_id: uuid.UUID,
    range: Optional[str] = Header(None),
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user_query_or_header)
):
    """Directly download file with attachment header."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 다운로드 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="File or storage key not found")

    safe_name = urllib.parse.quote(file_item.name)

    if range:
        res = await run_in_threadpool(s3_service.get_object_range, file_item.s3_key, range)
        if res:
            headers = {
                "Content-Range": res["content_range"] or f"bytes 0-{len(res['body'])-1}/{file_item.size_bytes}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(res["body"])),
                "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}",
                "Content-Type": "application/octet-stream"
            }
            return Response(
                content=res["body"],
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                headers=headers,
                media_type="application/octet-stream"
            )

    # No Range header — stream straight from S3/MinIO instead of buffering
    # the whole object into memory first (see preview_file for why).
    return StreamingResponse(
        _stream_s3_object(file_item.s3_key),
        status_code=status.HTTP_200_OK,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}",
            "Content-Length": str(file_item.size_bytes) if file_item.size_bytes else "",
            "Accept-Ranges": "bytes"
        },
        media_type="application/octet-stream"
    )

@router.get("/thumbnail/{file_id}")
async def get_file_thumbnail(
    file_id: uuid.UUID,
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user_query_or_header)
):
    """Serve the WebP thumbnail for an image/video file."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 접근 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.thumbnail_s3_key:
        raise HTTPException(status_code=404, detail="썸네일이 존재하지 않습니다.")

    thumb_bytes = await run_in_threadpool(s3_service.get_object_content, file_item.thumbnail_s3_key)
    if not thumb_bytes:
        raise HTTPException(status_code=404, detail="썸네일 데이터를 불러올 수 없습니다.")

    return Response(
        content=thumb_bytes,
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Type": "image/webp"
        }
    )

