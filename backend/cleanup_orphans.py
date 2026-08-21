"""
Orphaned Files Cleanup Script
Scans backend/storage_data for files that do not exist in the PostgreSQL database and safely removes them.
"""
import os
import asyncio
from pathlib import Path
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models import FileItem

async def run_cleanup():
    storage_dir = Path(__file__).resolve().parent / "storage_data"
    uploads_dir = storage_dir / "uploads"
    thumbs_dir = storage_dir / "thumbnails"
    temp_chunks_dir = storage_dir / "temp_chunks"

    print("=" * 60)
    print("🔍 Scanning database for active FileItem s3_keys...")
    print("=" * 60)

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(FileItem.s3_key, FileItem.thumbnail_s3_key))
        rows = res.all()
        
        active_s3_keys = set()
        active_thumb_keys = set()
        for s3_k, thumb_k in rows:
            if s3_k:
                # Normalize relative path: e.g. "uploads/uuid/filename"
                active_s3_keys.add(s3_k.replace("\\", "/").strip("/"))
            if thumb_k:
                active_thumb_keys.add(thumb_k.replace("\\", "/").strip("/"))

    print(f"✅ Found {len(active_s3_keys)} active s3_keys and {len(active_thumb_keys)} active thumbnail_keys in DB.\n")

    # 1. Clean uploads
    deleted_uploads_count = 0
    deleted_uploads_bytes = 0
    kept_uploads_count = 0

    if uploads_dir.exists():
        print(f"🔍 Checking uploads directory: {uploads_dir}...")
        for root, dirs, files in os.walk(uploads_dir):
            for file_name in files:
                file_path = Path(root) / file_name
                rel_path = str(file_path.relative_to(storage_dir)).replace("\\", "/")
                
                if rel_path in active_s3_keys:
                    kept_uploads_count += 1
                else:
                    file_size = file_path.stat().st_size
                    file_path.unlink()
                    deleted_uploads_count += 1
                    deleted_uploads_bytes += file_size

        # Remove empty directories in uploads
        for root, dirs, files in os.walk(uploads_dir, topdown=False):
            for d in dirs:
                dir_path = Path(root) / d
                try:
                    dir_path.rmdir()
                except OSError:
                    pass

    # 2. Clean thumbnails
    deleted_thumbs_count = 0
    deleted_thumbs_bytes = 0
    kept_thumbs_count = 0

    if thumbs_dir.exists():
        print(f"🔍 Checking thumbnails directory: {thumbs_dir}...")
        for root, dirs, files in os.walk(thumbs_dir):
            for file_name in files:
                file_path = Path(root) / file_name
                rel_path = str(file_path.relative_to(storage_dir)).replace("\\", "/")
                
                if rel_path in active_thumb_keys:
                    kept_thumbs_count += 1
                else:
                    file_size = file_path.stat().st_size
                    file_path.unlink()
                    deleted_thumbs_count += 1
                    deleted_thumbs_bytes += file_size

        # Remove empty directories in thumbnails
        for root, dirs, files in os.walk(thumbs_dir, topdown=False):
            for d in dirs:
                dir_path = Path(root) / d
                try:
                    dir_path.rmdir()
                except OSError:
                    pass

    # 3. Clean temporary chunk remnants
    deleted_chunks_count = 0
    deleted_chunks_bytes = 0
    if temp_chunks_dir.exists():
        print(f"🔍 Cleaning temporary chunks directory: {temp_chunks_dir}...")
        for root, dirs, files in os.walk(temp_chunks_dir):
            for file_name in files:
                file_path = Path(root) / file_name
                file_size = file_path.stat().st_size
                file_path.unlink()
                deleted_chunks_count += 1
                deleted_chunks_bytes += file_size
        for root, dirs, files in os.walk(temp_chunks_dir, topdown=False):
            for d in dirs:
                dir_path = Path(root) / d
                try:
                    dir_path.rmdir()
                except OSError:
                    pass

    total_freed_bytes = deleted_uploads_bytes + deleted_thumbs_bytes + deleted_chunks_bytes
    total_freed_gb = total_freed_bytes / (1024 * 1024 * 1024)
    total_freed_mb = total_freed_bytes / (1024 * 1024)

    print("\n" + "=" * 60)
    print("🎉 CLEANUP COMPLETE!")
    print("=" * 60)
    print(f"📦 Uploads   : Kept {kept_uploads_count} valid files | Removed {deleted_uploads_count} orphaned files ({deleted_uploads_bytes / (1024*1024*1024):.2f} GB)")
    print(f"🖼️  Thumbnails: Kept {kept_thumbs_count} valid thumbs | Removed {deleted_thumbs_count} orphaned thumbs ({deleted_thumbs_bytes / (1024*1024):.2f} MB)")
    print(f"🧹 Temp Chunks: Removed {deleted_chunks_count} leftover chunks ({deleted_chunks_bytes / (1024*1024):.2f} MB)")
    print(f"✨ TOTAL FREED DISK SPACE: {total_freed_gb:.2f} GB ({total_freed_mb:.1f} MB)")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(run_cleanup())
