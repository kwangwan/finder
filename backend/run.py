import uvicorn
import os
import sys

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.config import settings

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8001"))
    # Auto-reload restarts the process (and its in-memory state, like the deletion
    # queue worker) on every file write — fine for local development, but in
    # production it means every edit made on the host interrupts live traffic.
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=settings.DEBUG)
