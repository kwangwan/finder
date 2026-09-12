import asyncio, time
from sqlalchemy import select, text
from app.core.database import AsyncSessionLocal
from app.models import FileItem
from app.services.document_service import document_service

async def main():
    async with AsyncSessionLocal() as db:
        files = (await db.execute(
            select(FileItem).where(FileItem.is_trashed == False)  # noqa: E712
        )).scalars().all()
        print(f"{len(files)} files to look at")
        t0 = time.time(); done = chunks = failed = 0
        for i, f in enumerate(files, 1):
            try:
                n = await document_service.index_file_chunks_safely(db, f)
                if n:
                    done += 1; chunks += n
            except Exception as e:
                failed += 1
                print(f"  ! {f.name}: {type(e).__name__} {str(e)[:80]}")
            if i % 25 == 0:
                print(f"  {i}/{len(files)} · {chunks} chunks · {time.time()-t0:.0f}s")
        await db.commit()
        print(f"\nindexed {done} files into {chunks} chunks in {time.time()-t0:.0f}s ({failed} failed)")
        with_vec = (await db.execute(text("select count(*) from kb_document_chunks where embedding is not null"))).scalar_one()
        total = (await db.execute(text("select count(*) from kb_document_chunks"))).scalar_one()
        print(f"chunks with a vector now: {with_vec} of {total}")

asyncio.run(main())
