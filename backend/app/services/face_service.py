"""
얼굴 — 사진과 영상에서 사람의 얼굴을 찾고, 그 얼굴을 숫자로 적어 둔다.

Finding a face and recognising one are two different jobs, and the library
that gets mentioned first for this — MediaPipe — only does the first. Its
landmarker returns the geometry of a face (478 points describing where the
mouth and eyes are, and what they are doing), which is what you want for an
avatar or a filter and not what you want for "show me the photographs with
her in them": expression and angle move those points far more than identity
does. Searching by face needs an *identity embedding* — a vector trained so
that two pictures of the same person land near each other and two pictures of
different people do not, whatever their expression.

So: detection by YuNet, identity by SFace, both of which OpenCV already
carries (cv2.FaceDetectorYN / cv2.FaceRecognizerSF) and this app already
installs OpenCV. That is the whole reason for choosing them over InsightFace,
which is more accurate and would have meant onnxruntime, a compiler in the
image, and 300MB of model. Here nothing is added but two ONNX files — 232KB
and 37MB — and they are small enough to run on this machine's CPU over a
library of twelve thousand photographs in an evening.

The embedding is 128 numbers, compared by cosine distance in Postgres, where
pgvector already lives for document search. Same infrastructure, same index
type, one more table.
"""
import logging
import math
import os
import tempfile
from pathlib import Path
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

import av
import cv2
import numpy as np

logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("FACE_MODEL_DIR", "/app/model_cache"))

# insightface's buffalo_l: SCRFD for finding faces, ArcFace (w600k_r50) for
# telling them apart. Fetched and cached by the library itself, into the same
# mounted directory the old models used so a restart does not fetch 280MB again.
#
# Why this rather than OpenCV's YuNet and SFace, which needed no extra
# dependency: SFace is built to be small, and it shows exactly where this
# library needed it not to. Measured on these photographs, the similarity of
# the same person seen in profile and seen face-on lands in the same range as
# two different people — so no threshold could separate them, and the search
# found only the frontal, obviously-alike faces. ArcFace is trained against
# precisely that (its benchmark is frontal-versus-profile), and SCRFD finds
# faces YuNet does not: turned away, small, at the edge of a group.
# Where the models live. Passed to the library explicitly rather than through
# INSIGHTFACE_HOME, which it does not read — left to itself it puts 280MB in
# the container's home directory, which is gone on the next restart.
FACE_HOME = str(MODEL_DIR / "insightface")

FACE_PACK = os.getenv("FACE_PACK", "buffalo_l")

# What the detector sees. This is the size the comparison against the old
# models was run at, and at this size SCRFD already found 42% more faces than
# YuNet did at twice the resolution — so there is nothing to buy by going
# larger, and the cost is squared.
DETECT_SIZE = int(os.getenv("FACE_DETECT_SIZE", "1024"))

# Each model gets two threads of its own. Without this every session helps
# itself to every core, and four of them on ten cores spend their time handing
# the cores back and forth.
os.environ.setdefault("OMP_NUM_THREADS", "2")

# A detection below this is not a face worth remembering, and a face smaller
# than this fraction of the picture carries too little to tell one person from
# another — a crowd in the distance would otherwise fill the index with
# vectors that match everybody equally.
#
# Kept as a fraction rather than a pixel count because the detector now reports
# boxes in the original picture's coordinates, and "44 pixels" means something
# different on a phone photograph than on a thumbnail.
#
# 0.60 rather than the detector's own 0.50, and this was looked at rather than
# guessed: below 0.60 the index fills with clouds, the backs of heads, tree
# bark and shop signs. That costs more than the few real faces it also holds,
# because the junk is alike enough to cluster with itself — one such box, when
# pressed, answered with five hundred files of nothing. From 0.60 up the
# detections are faces, profiles and masks included.
MIN_DETECTION_SCORE = float(os.getenv("FACE_MIN_SCORE", "0.60"))
MIN_FACE_FRACTION = 44 / 2048

# How many moments are taken from one clip, and how close together they may be
# before it is worth spreading them out instead of taking them all.
# Twenty moments of a clip rather than every keyframe it has. Measured, one
# frame costs about a second to look at — so the number of moments *is* the
# cost of a film, and forty of them meant a minute each. A clip's moments are
# the most redundant thing in the library: the same two people, over and over.
# Twenty spread across the whole of it says who was in it just as well.
VIDEO_MOMENTS = int(os.getenv("FACE_VIDEO_MOMENTS", "20"))
SECONDS_PER_MOMENT = 4
VIDEO_OPEN_TIMEOUT = 60
MAX_FACES_PER_VIDEO = 900
VIDEO_MAX_BYTES = 1024 * 1024 * 1024



def models_ready() -> bool:
    """
    Whether the models are already on disk — asked before a long sweep.

    They are fetched by the library on first use, into the mounted cache; this
    only says whether that has already happened, so a sweep does not start by
    pulling 280MB down a connection that may not be there.
    """
    pack = Path(FACE_HOME) / "models" / FACE_PACK
    return pack.is_dir() and any(pack.glob("*.onnx"))


def ensure_models() -> None:
    """Fetch them if they are not here yet. Slow, once."""
    _analyser()


# The models are shared objects with state — the detector is told the size of
# the picture it is about to look at, and then looks at it. Two threads sharing
# one is a thread setting the size for its photograph while another is midway
# through a different one: the network runs against a buffer shaped for
# somebody else's image, fails on the mismatch, and the file is written off as
# unreadable and marked as looked at. That last part is the quiet one — it is
# never examined again.
#
# A lock fixes that and costs the parallelism: detection is most of the work,
# so serialising it makes the whole sweep as fast as one core. Each thread gets
# its own models instead, and the threads are a pool of a known size, so the
# number of copies is a number we chose rather than however many threads the
# server happened to use. A copy is about 37MB, nearly all of it the
# recogniser.
_models = threading.local()
_build_lock = threading.Lock()

# ArcFace's weights are about 170MB per copy, so this stays small — but not as
# small as two. Under the old model the sweep spent nine tenths of its time
# waiting for storage and the looking was free; now the looking is the work,
# and four at a time is what turns a five-hour pass into an hour and a bit.
FACE_WORKERS = int(os.getenv("FACE_WORKERS", "0") or 0) or 4

# Everything that touches a model runs here, and only here.
cv_pool = ThreadPoolExecutor(max_workers=FACE_WORKERS, thread_name_prefix="face")


def _analyser():
    """
    This thread's own detector and recogniser.

    Loaded once per thread rather than shared, because these carry state
    through a call and two threads sharing one is a network run against a
    buffer shaped for somebody else's picture — which fails, and marks the file
    as looked at on the way out.
    """
    found = getattr(_models, "app", None)
    if found is None:
        import insightface
        # One at a time. Building these makes directories and, the first time,
        # fetches them; two threads doing that together race on the same mkdir
        # and one of them dies of FileExistsError. Only the building is
        # serialised — the looking afterwards is not.
        with _build_lock:
            found = insightface.app.FaceAnalysis(
                name=FACE_PACK,
                root=FACE_HOME,
                allowed_modules=["detection", "recognition"],   # no age, no gender, no landmarks
                providers=["CPUExecutionProvider"],
            )
            found.prepare(ctx_id=-1, det_size=(DETECT_SIZE, DETECT_SIZE))
        _models.app = found
    return found


def faces_in_image(image: np.ndarray, frame_time: Optional[float] = None) -> List[dict]:
    """
    Every face in one picture, each with the numbers that identify it.

    The box is returned as a fraction of the picture rather than in pixels, so
    it can be drawn over a thumbnail, a preview or the original without knowing
    which of them is on screen.
    """
    if image is None or image.size == 0:
        return []
    if len(image.shape) == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)

    height, width = image.shape[:2]
    smallest = MIN_FACE_FRACTION * max(height, width)

    faces = []
    for face in _analyser().get(image):
        score = float(getattr(face, "det_score", 0.0))
        if score < MIN_DETECTION_SCORE:
            continue
        x1, y1, x2, y2 = (float(v) for v in face.bbox)
        w, h = x2 - x1, y2 - y1
        if min(w, h) < smallest:
            continue
        vector = getattr(face, "normed_embedding", None)
        if vector is None:
            continue
        vector = np.asarray(vector, dtype=np.float32)
        norm = float(np.linalg.norm(vector))
        if not math.isfinite(norm) or norm == 0:
            continue
        faces.append({
            "embedding": (vector / norm).tolist(),   # unit length: cosine is then a dot product
            "score": score,
            "box": [
                max(0.0, x1 / width),
                max(0.0, y1 / height),
                min(1.0, w / width),
                min(1.0, h / height),
            ],
            "frame_time": frame_time,
        })
    return faces


def faces_in_image_bytes(data: bytes) -> List[dict]:
    """Every face in an encoded picture — what comes back from storage."""
    if not data:
        return []
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return []
    return faces_in_image(image)


# PyAV renamed this between versions and the old name is simply gone, which
# turns one bad seek into "module 'av' has no attribute 'AVError'" and loses
# the whole film — silently, because the caller treats a film it could not read
# as a film with nobody in it.
_AV_ERROR = getattr(av, "FFmpegError", getattr(av, "AVError", Exception))

# What the decoder is allowed to do over HTTP. `multiple_requests` is the one
# that matters: without it ffmpeg opens the URL once and cannot ask for another
# byte range, so every seek fails with an I/O error and the film is read as
# empty. The reconnects are for a long read across a home network.
HTTP_OPTIONS = {
    "multiple_requests": "1",
    "reconnect": "1",
    "reconnect_streamed": "1",
    "reconnect_on_network_error": "1",
    "reconnect_delay_max": "5",
}


def _keyframes_sequentially(container, stream, cap: int):
    """Every keyframe there is, up to a limit."""
    for index, frame in enumerate(container.decode(stream)):
        if index >= cap:
            return
        yield frame


def _keyframes_spread(container, stream, duration: float, cap: int):
    """
    A keyframe from each of `cap` moments spread across the whole clip.

    For anything long: reading a two-hour film's keyframes in order would be
    thousands of decodes, and stopping after the first few hundred would mean
    scanning the first ten minutes and calling it the film. Seeking is cheap
    when only keyframes are being decoded — it is what seeking lands on.
    """
    seen = set()
    for step in range(cap):
        at = duration * step / cap
        try:
            container.seek(int(at / stream.time_base), stream=stream)
            frame = next(container.decode(stream), None)
        except (_AV_ERROR, StopIteration, ValueError):
            continue
        if frame is None or frame.pts is None or frame.pts in seen:
            continue
        seen.add(frame.pts)
        yield frame


# How a film is turned before it is looked at.
#
# A phone shoots portrait by writing a landscape picture plus "turn this a
# quarter". Players obey; a decoder hands you the picture as written. So a
# portrait film arrives on its side — faces lying sideways, which the detector
# is poor at, and boxes in coordinates nobody who watches the film would
# recognise. That is both halves of the same bug: few faces found, and the ones
# found drawn in the wrong place at the wrong size.
#
# The turn is written in a display matrix this build of the library will not
# read back. So it is settled by trying: look at one frame each way and keep
# the way that finds faces. Upright faces are found far more readily than
# sideways ones, which makes the detector itself the best available reader of
# the matrix. Decided once per film, from the first frame that shows anybody.
# Upside down is not a way anybody holds a camera; it is in the list only
# because the matrix can say it, and trying it costs a quarter of every
# decision.
_TURNS = (0, 90, 270)

# How many frames may be spent settling which way up a film is. Every attempt
# costs a look in each of four directions, so a film with nobody in it used to
# pay four times over for every single moment — forty moments, a hundred and
# sixty looks, to learn nothing. After a few frames without a face, take the
# film as it comes: there is nobody in it to be the wrong way up.
TURN_TRIES = 3


def _turned(image: np.ndarray, turn: int) -> np.ndarray:
    if turn == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if turn == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if turn == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    return image


def _which_way_up(image: np.ndarray) -> Optional[int]:
    """The turn that finds the most face, or nothing if no turn finds any."""
    best, best_turn = 0.0, None
    for turn in _TURNS:
        found = faces_in_image(_turned(image, turn))
        weight = sum(f["score"] for f in found)
        if weight > best:
            best, best_turn = weight, turn
    return best_turn


def faces_in_video(source) -> List[dict]:
    """
    Every face across a film, at the moments the film itself is built from.

    A clip is not searched frame by frame — thirty faces a second of the same
    person is one fact repeated thirty times. But the twelve evenly spaced
    moments this used to take were twelve out of a hundred thousand, chosen
    with no regard for what was in them, and somebody who appeared for ten
    seconds of a five-minute clip was simply not in the library.

    Compressed video already carries the answer to "where are the moments":
    keyframes, the points it can start decoding from, usually every few
    seconds. Decoding only those gives dozens or hundreds of moments for less
    work than the twelve cost before — a keyframe needs nothing before it, so
    nothing before it is decoded. Each one knows its own timestamp, which is
    kept, so a face found here is a face found *at 2:47*.

    `source` may be a path or a URL: given a URL, the decoder asks for the
    byte ranges it needs and the rest of the file is never fetched, which is
    what lets a six-gigabyte clip be looked at at all.
    """
    try:
        is_url = isinstance(source, str) and source.startswith(("http://", "https://"))
        container = av.open(
            source,
            timeout=VIDEO_OPEN_TIMEOUT,
            options=HTTP_OPTIONS if is_url else None,
        )
    except Exception as e:
        logger.warning("[Faces] could not open a film: %s", e)
        return []
    try:
        if not container.streams.video:
            return []
        stream = container.streams.video[0]
        # The whole point: hand back only the frames that stand alone.
        stream.codec_context.skip_frame = "NONKEY"
        stream.thread_type = "AUTO"

        duration = 0.0
        if container.duration:
            duration = float(container.duration) / av.time_base
        elif stream.duration and stream.time_base:
            duration = float(stream.duration * stream.time_base)

        frames = (
            _keyframes_spread(container, stream, duration, VIDEO_MOMENTS)
            if duration > VIDEO_MOMENTS * SECONDS_PER_MOMENT
            else _keyframes_sequentially(container, stream, VIDEO_MOMENTS)
        )

        faces: List[dict] = []
        turn = None
        tries = 0
        for frame in frames:
            try:
                image = frame.to_ndarray(format="bgr24")
            except Exception:
                continue
            at = None
            if frame.pts is not None and stream.time_base:
                at = round(float(frame.pts * stream.time_base), 2)
            if turn is None:
                # Still deciding. Whichever way up finds somebody is the way
                # this film is meant to be watched.
                turn = _which_way_up(image)
                if turn is None:
                    tries += 1
                    if tries < TURN_TRIES:
                        continue
                    turn = 0        # nobody so far; take it as it comes
            found = faces_in_image(_turned(image, turn), at)
            for face in found:
                face["frame_turn"] = turn
            faces.extend(found)
            if len(faces) > MAX_FACES_PER_VIDEO:
                break
        return faces
    except Exception as e:
        logger.warning("[Faces] a film could not be read through: %s", e)
        return []
    finally:
        try:
            container.close()
        except Exception:
            pass


def faces_in_video_file(path: str, max_frames: int = None) -> List[dict]:
    """Kept for callers that already have the file on disk."""
    return faces_in_video(path)


def frame_at(source, seconds: Optional[float], turn: int = 0):
    """
    One frame of a film, at a moment, the right way up.

    Used to cut out a face long after the film was looked at, so it repeats the
    turning the sweep worked out rather than working it out again.
    """
    is_url = isinstance(source, str) and source.startswith(("http://", "https://"))
    container = av.open(source, timeout=VIDEO_OPEN_TIMEOUT,
                        options=HTTP_OPTIONS if is_url else None)
    try:
        stream = container.streams.video[0]
        stream.codec_context.skip_frame = "NONKEY"
        if seconds:
            container.seek(int(float(seconds) / stream.time_base), stream=stream)
        frame = next(container.decode(stream), None)
        if frame is None:
            return None
        return _turned(frame.to_ndarray(format="bgr24"), turn)
    finally:
        try:
            container.close()
        except Exception:
            pass


def which_way_up(image: np.ndarray) -> Optional[int]:
    """Public name for the turn-finding above."""
    return _which_way_up(image)


def dedupe_faces(faces: List[dict], threshold: float = float(os.getenv("FACE_SAME_FILE", "0.45"))) -> List[dict]:
    """
    One entry per person per clip, keeping the clearest sighting of them.

    For a film only. Thirty frames of one person is that person thirty times,
    and keeping them all would make them count thirty times in every search
    that follows — so faces this close *at different moments* are folded into
    the clearest one.

    Two faces found in the *same* moment are never folded together, however
    alike. They are two faces standing in two places in one picture, which
    makes them two people by construction; the detector has already removed
    overlapping boxes of a single face. This is not a detail: applied to a
    still photograph, folding by likeness quietly deleted one of two babies
    sitting side by side, because babies resemble each other more than the
    threshold allows for — and it is a still photograph's second face that is
    most worth having.
    """
    kept: List[dict] = []
    for face in sorted(faces, key=lambda f: f["score"], reverse=True):
        vector = np.array(face["embedding"], dtype=np.float32)
        same_moment = face.get("frame_time")
        if any(
            k.get("frame_time") != same_moment
            and float(np.dot(vector, np.array(k["embedding"], dtype=np.float32))) >= threshold
            for k in kept
        ):
            continue
        kept.append(face)
    return kept


def write_temp_video(data_iter) -> str:
    """A film on disk, because a decoder needs to seek and a stream cannot."""
    handle = tempfile.NamedTemporaryFile(prefix="faces-", suffix=".mp4", delete=False)
    try:
        for chunk in data_iter:
            handle.write(chunk)
    finally:
        handle.close()
    return handle.name
