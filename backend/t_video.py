import asyncio, time
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.models import FileItem
from app.services import face_service
from app.services.s3_service import s3_service
from fastapi.concurrency import run_in_threadpool

async def main():
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text("""
            select id, name, size_bytes from kb_files
            where file_type='video' and is_trashed=false and s3_key is not null
              and size_bytes < 200000000
            order by random() limit 4"""))).all()
        big = (await db.execute(text("""
            select id, name, size_bytes from kb_files
            where file_type='video' and is_trashed=false and s3_key is not null
            order by size_bytes desc limit 1"""))).all()
        for r in list(rows) + list(big):
            item = await db.get(FileItem, r.id)
            url = await run_in_threadpool(s3_service.internal_presigned_get_url, item.s3_key)
            t = time.monotonic()
            faces = await run_in_threadpool(lambda: face_service.faces_in_video(url))
            took = time.monotonic() - t
            people = face_service.dedupe_faces(faces)
            times = sorted({f["frame_time"] for f in faces if f["frame_time"] is not None})
            span = f"{times[0]:.0f}s~{times[-1]:.0f}s ({len(times)}곳)" if times else "—"
            print(f"{(r.size_bytes or 0)/1e6:>8.0f}MB  얼굴 {len(faces):>4} → 사람 {len(people):>2}명  "
                  f"{span:>22}  {took:>6.1f}초  {r.name[:30]}", flush=True)
asyncio.run(main())
