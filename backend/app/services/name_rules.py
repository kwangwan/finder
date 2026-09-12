"""
What a file or folder may be called.

A name is a name, not a path. Nothing here writes to disk under a
user-supplied name — storage keys are built from ids (see build_storage_key) —
but a name does become a path in one place: the entry names inside a ZIP
export. An item called "../../../.bashrc" makes an archive that writes outside
the folder somebody extracts it into, on their machine, not ours. Most
extractors refuse that now; the name should never have been allowed to say it
in the first place.
"""
from typing import Optional

MAX_NAME_LENGTH = 255
_ILLEGAL = ("/", "\\", "\x00")


def validate_item_name(name: Optional[str], kind: str = "이름") -> str:
    """Return the cleaned name, or raise ValueError saying what is wrong."""
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError(f"{kind}을(를) 입력해 주세요.")
    if len(cleaned) > MAX_NAME_LENGTH:
        raise ValueError(f"{kind}이(가) 너무 깁니다. {MAX_NAME_LENGTH}자 이내로 지어 주세요.")
    if any(ch in cleaned for ch in _ILLEGAL):
        raise ValueError(f"{kind}에는 / 나 \\ 를 쓸 수 없습니다.")
    if any(ord(ch) < 32 for ch in cleaned):
        raise ValueError(f"{kind}에 쓸 수 없는 문자가 들어 있습니다.")
    if cleaned in (".", ".."):
        raise ValueError(f"'{cleaned}' 은(는) {kind}(으)로 쓸 수 없습니다.")
    return cleaned


def safe_archive_segment(segment: str) -> str:
    """
    One path component of a ZIP entry, made harmless.

    The names above are checked as they are set, which does nothing for the
    names already stored. This is the second line: whatever an entry is
    called, it stays inside the archive.
    """
    cleaned = (segment or "").replace("\\", "_").replace("\x00", "")
    cleaned = "".join(ch for ch in cleaned if ord(ch) >= 32).strip()
    if cleaned in ("", ".", ".."):
        return "_"
    return cleaned[:MAX_NAME_LENGTH]


def safe_archive_path(path: str) -> str:
    """Every component of a ZIP entry path, made harmless, joined back up."""
    parts = [safe_archive_segment(p) for p in (path or "").split("/") if p not in ("", ".")]
    return "/".join(parts) or "_"
