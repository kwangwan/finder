"""
Look at every photograph and film that has not been examined yet.

Run as a one-off in its own container so the sweep's CPU is not taken from
the app serving people:

    docker compose run --rm --no-deps backend python run_face_backlog.py

Safe to stop and start again — every file is marked as it is finished.
"""
import asyncio, time
from app.core.database import AsyncSessionLocal
from app.services import face_index_service

async def main():
    async with AsyncSessionLocal() as db:
        pending = await face_index_service.pending_count(db)
    print(f"{pending} files to look at", flush=True)

    done = faces = 0
    started = time.time()
    while True:
        result = await face_index_service.sweep(batch_size=12, limit=240)
        if not result["scanned"]:
            break
        done += result["scanned"]
        faces += result["faces"]
        elapsed = time.time() - started
        rate = done / elapsed
        left = (pending - done) / rate if rate else 0
        print(f"  {done}/{pending} · {faces} faces · {elapsed/60:.0f}m elapsed · "
              f"~{left/60:.0f}m left", flush=True)
    print(f"\ndone: {done} files, {faces} faces, {(time.time()-started)/60:.0f} minutes")

asyncio.run(main())
