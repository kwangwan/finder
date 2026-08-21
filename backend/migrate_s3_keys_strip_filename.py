"""
Retroactive migration: strip the original filename out of existing s3_key
values, so renaming a file (PUT /api/files/{id}/rename) never leaves the old
name behind anywhere in storage (presigned URL paths, the s3_key field in API
responses, etc). New uploads already use build_storage_key() for this; this
script brings existing FileItem rows in line with the same format:
    "{prefix}/{object_id}/{object_id}{ext}"

For each row whose current key doesn't already match that shape:
  1. Copy the MinIO object (server-side copy_object, no re-upload) to the new key
  2. Move the local disk cache copy, if one exists
  3. Update FileItem.s3_key in the DB
  4. Delete the old MinIO object

Thumbnails are not touched — they're already named "thumbnails/{uuid}/thumb.webp"
with no original filename embedded.

Usage:
    python migrate_s3_keys_strip_filename.py            # dry-run: report only
    python migrate_s3_keys_strip_filename.py --apply     # actually migrate
"""
import argparse
import asyncio
from pathlib import Path
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models import FileItem
from app.services.s3_service import s3_service, build_storage_key

STORAGE_DIR = Path(__file__).resolve().parent / "storage_data"


def infer_prefix_and_id(old_key: str, fallback_id) -> tuple:
    """
    Extract the (prefix, object_id) already embedded in an existing key, e.g.
    "uploads/<uuid>/photo.jpg" -> ("uploads", "<uuid>"). This uuid is the one
    generated at upload time (a fresh uuid4(), independent of FileItem.id) —
    reusing it keeps the migrated key identical apart from dropping the
    filename, instead of introducing an unrelated new identifier.
    """
    parts = old_key.split("/") if old_key else []
    if len(parts) >= 2 and parts[1]:
        return parts[0], parts[1]
    prefix = parts[0] if parts and parts[0] else "uploads"
    return prefix, str(fallback_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually migrate keys (default: dry-run)")
    args = parser.parse_args()

    async def run():
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(FileItem))
            items = res.scalars().all()

        migrated = 0
        already_ok = 0
        missing = 0
        failed = 0

        async with AsyncSessionLocal() as db:
            for item in items:
                old_key = item.s3_key
                if not old_key:
                    continue

                prefix, object_id = infer_prefix_and_id(old_key, item.id)
                new_key = build_storage_key(prefix, object_id, item.name)
                if new_key == old_key:
                    already_ok += 1
                    continue

                print(f"[{'APPLY' if args.apply else 'DRY-RUN'}] {old_key} -> {new_key}")
                if not args.apply:
                    migrated += 1
                    continue

                found_somewhere = False

                # 1. Server-side copy in MinIO (no re-upload of bytes). Just
                # attempt the copy directly rather than pre-checking existence
                # with head_object — this MinIO deployment returns 403 (not
                # 404) for HeadObject on a missing key, which would wrongly
                # look like "doesn't exist" for objects that actually do.
                minio_copy_error = None
                if s3_service.client:
                    try:
                        s3_service.client.copy_object(
                            Bucket=s3_service.bucket_name,
                            CopySource={"Bucket": s3_service.bucket_name, "Key": old_key},
                            Key=new_key,
                        )
                        found_somewhere = True
                    except Exception as e:
                        # Could be "source key doesn't exist" (fine, fall through
                        # to the local-disk check) or a real transient failure —
                        # either way, don't abandon the local-disk check below.
                        minio_copy_error = e

                # 2. Move local disk cache copy, if present
                old_local = STORAGE_DIR / old_key
                if old_local.exists() and old_local.is_file():
                    new_local = STORAGE_DIR / new_key
                    new_local.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        old_local.rename(new_local)
                        found_somewhere = True
                    except Exception as e:
                        print(f"[WARN] Could not move local cache copy for '{old_key}': {e}")

                if not found_somewhere:
                    if minio_copy_error:
                        print(f"[ERROR] MinIO copy failed for '{old_key}' and no local cache copy exists: {minio_copy_error}")
                        failed += 1
                    else:
                        print(f"[MISSING] Object not found in MinIO or locally for '{old_key}', s3_key left unchanged")
                        missing += 1
                    continue

                # 3. Update DB
                db_item = await db.get(FileItem, item.id)
                if db_item:
                    db_item.s3_key = new_key
                    await db.commit()

                # 4. Best-effort cleanup of the old MinIO object
                if s3_service.client:
                    try:
                        s3_service.client.delete_object(Bucket=s3_service.bucket_name, Key=old_key)
                    except Exception:
                        pass

                migrated += 1

        print("\n" + "=" * 60)
        print("MIGRATION SUMMARY")
        print("=" * 60)
        print(f"Already in new format : {already_ok}")
        print(f"{'Migrated' if args.apply else 'Would migrate'}      : {migrated}")
        print(f"Missing everywhere    : {missing}  <-- s3_key left as-is, nothing to copy")
        print(f"Failed                : {failed}")
        if not args.apply and migrated:
            print("\nRe-run with --apply to actually perform the migration above.")

    asyncio.run(run())


if __name__ == "__main__":
    main()
