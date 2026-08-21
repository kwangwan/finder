import queue
import threading
import zipfile
from typing import List, Optional, Tuple

from app.services.s3_service import s3_service


def dedupe_archive_paths(paths: List[str]) -> List[str]:
    """
    This app intentionally allows two files with the same name to coexist in
    the same folder, but a ZIP archive can't hold two entries at the same
    path without one silently overwriting the other on extraction. Rewrite
    any repeat of a path (order-preserving) to "name (1).ext", "name (2).ext",
    etc., checked against every path already produced so a disambiguated name
    can never itself collide with something else in the archive.
    """
    used = set(paths)
    seen_count = {}
    result = []
    for p in paths:
        if p not in seen_count:
            seen_count[p] = 0
            result.append(p)
            continue

        dir_part, _, name_part = p.rpartition("/")
        stem, dot, ext = name_part.rpartition(".")
        while True:
            seen_count[p] += 1
            n = seen_count[p]
            new_name = f"{stem} ({n}).{ext}" if dot else f"{name_part} ({n})"
            candidate = f"{dir_part}/{new_name}" if dir_part else new_name
            if candidate not in used:
                used.add(candidate)
                result.append(candidate)
                break
    return result


class _QueueWriter:
    """Minimal file-like object for zipfile.ZipFile: has no tell()/seekable(),
    so zipfile falls back to its non-seekable-stream write path (data
    descriptors written after each entry instead of seeking back to patch
    size/CRC into the local file header) — exactly what's needed to produce
    valid output while only ever holding one queue item at a time."""

    def __init__(self, q: "queue.Queue"):
        self._q = q

    def write(self, data: bytes) -> int:
        self._q.put(data)
        return len(data)

    def flush(self):
        pass


_SENTINEL = object()


def stream_zip(entries: List[Tuple[str, Optional[bytes], Optional[str]]]):
    """
    Stream a ZIP archive as it's built, instead of buffering the whole thing
    in memory first (the previous approach could hold a multi-GB folder's
    worth of file content in RAM at once, and sent nothing to the client
    until every file had been fetched and compressed — long enough for a
    large folder to hit the Cloudflare Tunnel's request timeout, the same
    failure mode chunked uploads had before they were made to stream).

    entries: list of (archive_path, inline_content_bytes_or_None, s3_key_or_None).
    Exactly one of inline_content_bytes / s3_key should be set per entry; a
    file that fails to fetch is skipped (logged) rather than failing the
    whole archive.

    A background thread drives the actual (synchronous) zipfile writes and
    pushes output chunks into a small bounded queue; this generator just
    drains that queue. Starlette's StreamingResponse iterates a plain
    generator like this one in a thread pool, so the blocking queue.get()
    calls below don't block the server's event loop.
    """
    q: "queue.Queue" = queue.Queue(maxsize=8)

    def produce():
        try:
            with zipfile.ZipFile(_QueueWriter(q), "w", zipfile.ZIP_DEFLATED) as zf:
                for archive_path, content_bytes, s3_key in entries:
                    try:
                        if content_bytes is not None:
                            with zf.open(archive_path, "w") as dest:
                                dest.write(content_bytes)
                        elif s3_key:
                            # Peek the first chunk before opening the archive
                            # entry, so a missing/orphaned object (a DB record
                            # whose file no longer exists in storage) is left
                            # out of the archive entirely instead of adding a
                            # deceptive 0-byte file with the right name.
                            chunks = s3_service.stream_object(s3_key)
                            first_chunk = next(chunks, None)
                            if first_chunk is None:
                                print(f"[ZIP Warning] Skipping '{archive_path}': object not found in storage")
                                continue
                            with zf.open(archive_path, "w") as dest:
                                dest.write(first_chunk)
                                for chunk in chunks:
                                    dest.write(chunk)
                    except Exception as e:
                        print(f"[ZIP Warning] Skipping '{archive_path}': {e}")
        except Exception as e:
            print(f"[ZIP Error] Archive generation failed: {e}")
        finally:
            q.put(_SENTINEL)

    threading.Thread(target=produce, daemon=True).start()

    while True:
        chunk = q.get()
        if chunk is _SENTINEL:
            break
        yield chunk
