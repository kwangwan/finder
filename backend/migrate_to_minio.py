"""
Local-to-MinIO Migration Script

Finds FileItem/thumbnail records whose object is missing from the MinIO bucket
but still exists on local disk (backend/storage_data/<s3_key>), and uploads it.

Usage:
    python migrate_to_minio.py            # dry-run: report only, no uploads
    python migrate_to_minio.py --apply    # actually upload missing objects
    python migrate_to_minio.py --apply --delete-local   # upload, then verify and
                                                          # delete the local copy
"""
import argparse
import asyncio
from pathlib import Path
from botocore.exceptions import ClientError
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models import FileItem
from app.services.s3_service import s3_service
from app.routers.storage import get_media_mime_type

STORAGE_DIR = Path(__file__).resolve().parent / "storage_data"


def exists_in_minio(s3_key: str) -> bool:
    if not s3_service.client:
        raise RuntimeError("MinIO client is not initialized (check MINIO_* settings in .env)")
    try:
        s3_service.client.head_object(Bucket=s3_service.bucket_name, Key=s3_key)
        return True
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        # This MinIO deployment lacks s3:ListBucket for the configured credentials,
        # so HeadObject returns 403 (instead of 404) for keys that do not exist.
        # Verified against GetObject, which correctly returns NoSuchKey for the same keys.
        if code in ("404", "NoSuchKey", "403"):
            return False
        raise


async def collect_targets():
    """Return list of (s3_key, filename, note_content_fallback) for every key referenced in DB.

    note_content_fallback is the DB `content` text (or None) to re-materialize a markdown
    note's S3 backup from when neither MinIO nor the local disk has the object.
    """
    targets = []
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(FileItem.name, FileItem.s3_key, FileItem.thumbnail_s3_key, FileItem.is_markdown, FileItem.content)
        )
        for name, s3_key, thumb_key, is_markdown, content in res.all():
            if s3_key:
                targets.append((s3_key, name, content if is_markdown else None))
            if thumb_key:
                targets.append((thumb_key, f"{name}.thumbnail", None))
    return targets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually upload missing objects (default: dry-run)")
    parser.add_argument("--delete-local", action="store_true", help="After a verified successful upload, delete the local copy")
    args = parser.parse_args()

    async def run():
        targets = await collect_targets()
        print(f"Found {len(targets)} object references in DB (files + thumbnails).\n")

        already_in_minio = 0
        migrated = 0
        restored_from_db = 0
        missing_everywhere = 0
        failed = 0
        migrated_bytes = 0

        for s3_key, name, note_content_fallback in targets:
            try:
                if exists_in_minio(s3_key):
                    already_in_minio += 1
                    continue
            except Exception as e:
                print(f"[ERROR] Could not check MinIO for '{s3_key}': {e}")
                failed += 1
                continue

            local_path = STORAGE_DIR / s3_key
            if not local_path.exists() or not local_path.is_file():
                if note_content_fallback is not None:
                    print(f"[{'APPLY' if args.apply else 'DRY-RUN'}] '{s3_key}' ({name}) -> re-create S3 backup from DB note content ({len(note_content_fallback)} chars)")
                    if args.apply:
                        try:
                            s3_service.put_object(s3_key, note_content_fallback.encode("utf-8"), "text/markdown; charset=utf-8")
                        except Exception as e:
                            print(f"[FAILED] Could not restore note backup for '{s3_key}': {e}")
                            failed += 1
                            continue
                    restored_from_db += 1
                    continue
                print(f"[MISSING] '{s3_key}' ({name}) not found in MinIO or on local disk.")
                missing_everywhere += 1
                continue

            size = local_path.stat().st_size
            print(f"[{'APPLY' if args.apply else 'DRY-RUN'}] '{s3_key}' ({name}, {size / 1024:.1f} KB) -> upload to MinIO")

            if not args.apply:
                migrated += 1
                migrated_bytes += size
                continue

            content_type = get_media_mime_type(name)
            ok = s3_service.upload_file(s3_key=s3_key, local_path=str(local_path), content_type=content_type)
            if not ok:
                print(f"[FAILED] Upload failed for '{s3_key}'")
                failed += 1
                continue

            # Verify before touching the local copy
            try:
                head = s3_service.client.head_object(Bucket=s3_service.bucket_name, Key=s3_key)
                if head["ContentLength"] != size:
                    print(f"[FAILED] Size mismatch after upload for '{s3_key}' (local={size}, minio={head['ContentLength']})")
                    failed += 1
                    continue
            except Exception as e:
                print(f"[FAILED] Could not verify upload for '{s3_key}': {e}")
                failed += 1
                continue

            migrated += 1
            migrated_bytes += size

            if args.delete_local:
                try:
                    local_path.unlink()
                except Exception as e:
                    print(f"[WARN] Uploaded but could not delete local copy '{local_path}': {e}")

        print("\n" + "=" * 60)
        print("MIGRATION SUMMARY")
        print("=" * 60)
        print(f"Already in MinIO      : {already_in_minio}")
        print(f"{'Migrated' if args.apply else 'Would migrate'}     : {migrated} ({migrated_bytes / (1024*1024):.2f} MB)")
        print(f"Restored from DB content : {restored_from_db}  (markdown notes with no file object, backed by DB text)")
        print(f"Missing everywhere    : {missing_everywhere}  <-- data loss, cannot be recovered")
        print(f"Failed                : {failed}")
        if not args.apply and migrated:
            print("\nRe-run with --apply to actually upload the objects listed above.")

    asyncio.run(run())


if __name__ == "__main__":
    main()
