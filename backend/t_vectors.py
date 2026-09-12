"""
Give the chunks that already exist the vectors they never got.

The text was extracted and stored all along; only the embedding call failed,
because the backend was asking a service it could not reach. Nothing is
re-extracted here — the expensive part is already done.
"""
import asyncio, time
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.services.embedding_service import embedding_service

BATCH = 200

async def main():
    done = failed = 0
    t0 = time.time()
    while True:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(text(
                "select id, content from kb_document_chunks "
                "where embedding is null and content is not null and length(content) > 0 limit :n"
            ), {"n": BATCH})).all()
            if not rows:
                break
            for chunk_id, content in rows:
                vector = await embedding_service.get_embedding(content)
                if vector is None:
                    failed += 1
                    # Mark nothing: a failure now should be retried later, not
                    # remembered as an answer.
                    continue
                await db.execute(
                    text("update kb_document_chunks set embedding = :v where id = :i"),
                    {"v": str(vector), "i": chunk_id},
                )
                done += 1
            await db.commit()
        print(f"  {done} embedded, {failed} failed, {time.time()-t0:.0f}s", flush=True)
        if failed > 50 and done == 0:
            print("  giving up: nothing is succeeding")
            break

    async with AsyncSessionLocal() as db:
        left = (await db.execute(text(
            "select count(*) from kb_document_chunks where embedding is null"))).scalar_one()
        total = (await db.execute(text("select count(*) from kb_document_chunks"))).scalar_one()
    print(f"\ndone: {done} embedded in {time.time()-t0:.0f}s · {total - left} of {total} chunks now searchable")

asyncio.run(main())
