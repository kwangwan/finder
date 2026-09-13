"""
사진을 돌린다 — 되도록 픽셀을 건드리지 않고.

JPEG 은 "이 사진은 이렇게 들고 찍었다" 는 쪽지를 품고 있고, 보는 쪽은 전부
그 쪽지를 따른다. 그러니 돌리는 일은 쪽지만 고쳐 쓰면 된다. 픽셀을 다시
인코딩하면 돌릴 때마다 조금씩 상해서, 사진첩에서는 할 일이 아니다.

쪽지를 품지 못하는 형식(PNG, WebP)은 픽셀을 실제로 돌려 다시 쓴다. 둘 다
무손실이다.
"""
import io
from typing import Optional, Tuple

from PIL import Image

# 방향 값 1~8 을 "한 번 시계방향으로 돌리면 무엇이 되는가" 로 옮긴 표.
# EXIF 의 여덟 방향은 회전과 거울이 섞여 있어서, 셈이 아니라 표가 맞다.
_TURN_ONCE = {1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2}


def _after_turns(orientation: int, quarter_turns: int) -> int:
    value = orientation if orientation in _TURN_ONCE else 1
    for _ in range(quarter_turns % 4):
        value = _TURN_ONCE[value]
    return value


def rotate_bytes(data: bytes, quarter_turns: int) -> Optional[Tuple[bytes, int, int]]:
    """
    Returns the rotated file, and the width and height it is now seen at.
    """
    quarter_turns %= 4
    if not data or quarter_turns == 0:
        return None
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = (probe.format or "").upper()
            width, height = probe.width, probe.height
            orientation = 1
            try:
                orientation = (probe.getexif() or {}).get(274, 1) or 1
            except Exception:
                orientation = 1
    except Exception:
        return None

    seen_w, seen_h = (height, width) if orientation in (5, 6, 7, 8) else (width, height)
    now_w, now_h = (seen_h, seen_w) if quarter_turns in (1, 3) else (seen_w, seen_h)

    if fmt in ("JPEG", "MPO"):
        import piexif
        try:
            exif = piexif.load(data)
        except Exception:
            exif = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": None}
        exif.setdefault("0th", {})
        exif["0th"][piexif.ImageIFD.Orientation] = _after_turns(orientation, quarter_turns)
        # A thumbnail inside the file would still face the old way; it is not
        # worth carrying around, and nothing here reads it.
        exif["thumbnail"] = None
        exif["1st"] = {}
        try:
            # piexif writes rather than returns: handed bytes, it still wants
            # somewhere to put them.
            out = io.BytesIO()
            piexif.insert(piexif.dump(exif), data, out)
            return out.getvalue(), now_w, now_h
        except Exception:
            return None

    # No room for the note: the pixels themselves turn.
    try:
        with Image.open(io.BytesIO(data)) as img:
            turned = img.rotate(-90 * quarter_turns, expand=True)
            out = io.BytesIO()
            params = {"format": fmt or "PNG"}
            if fmt == "WEBP":
                params["lossless"] = True
            turned.save(out, **params)
            return out.getvalue(), now_w, now_h
    except Exception:
        return None
