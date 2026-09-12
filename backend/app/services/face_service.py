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
import hashlib
import logging
import math
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("FACE_MODEL_DIR", "/app/model_cache"))

# Fetched from OpenCV's own model zoo, through the media host because the
# files are stored with git-lfs and the ordinary raw URL returns a pointer
# file rather than a model. Verified by hash, so a truncated download or a
# changed file is noticed rather than loaded.
MODELS = {
    "yunet": {
        "url": "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/"
               "models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "filename": "face_detection_yunet_2023mar.onnx",
    },
    "sface": {
        "url": "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/"
               "models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "filename": "face_recognition_sface_2021dec.onnx",
    },
}

# A detection below this is not a face worth remembering, and a face smaller
# than this many pixels across carries too little to tell one person from
# another — a crowd in the distance would otherwise fill the index with
# vectors that match everybody equally.
MIN_DETECTION_SCORE = 0.75
MIN_FACE_PIXELS = 44

# Detection runs on a reduced copy. A 6000-pixel-wide photograph costs several
# seconds at full size and finds nothing that this does not.
DETECT_LONG_EDGE = 1024

# How many moments of a video to look at. Faces come and go through a clip, so
# the frames are spread across the whole of it rather than taken from the
# start; twelve is enough to catch who was there without decoding the film.
VIDEO_FRAMES = 12
VIDEO_MAX_BYTES = 1024 * 1024 * 1024

_detector = None
_detector_size = None
_recogniser = None


def _download(spec: dict, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    logger.info("[Faces] fetching %s", target.name)
    with urllib.request.urlopen(spec["url"], timeout=180) as response:
        data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != spec["sha256"]:
        raise RuntimeError(
            f"{target.name} is not the model this expects "
            f"(sha256 {digest[:16]}… rather than {spec['sha256'][:16]}…)"
        )
    tmp = target.with_suffix(target.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(target)


def _model_path(key: str) -> Path:
    """
    The model on disk, fetched once.

    Checked by hash on the way in, because this is a file downloaded from the
    internet and then executed as a neural network. A file that does not match
    is not written at all: better to have no face search than to quietly run
    something else.
    """
    spec = MODELS[key]
    path = MODEL_DIR / spec["filename"]
    if not path.exists() or path.stat().st_size < 10_000:
        _download(spec, path)
    return path


def models_ready() -> bool:
    """Whether both models are already on disk — asked before a long sweep."""
    return all((MODEL_DIR / spec["filename"]).exists() for spec in MODELS.values())


def _get_detector(width: int, height: int):
    """
    YuNet, sized for this picture.

    The detector is told the exact size of what it is about to look at, so it
    is kept and re-sized rather than rebuilt per photograph.
    """
    global _detector, _detector_size
    if _detector is None:
        _detector = cv2.FaceDetectorYN.create(
            str(_model_path("yunet")), "", (width, height),
            score_threshold=MIN_DETECTION_SCORE, nms_threshold=0.3, top_k=200,
        )
        _detector_size = (width, height)
    elif _detector_size != (width, height):
        _detector.setInputSize((width, height))
        _detector_size = (width, height)
    return _detector


def _get_recogniser():
    global _recogniser
    if _recogniser is None:
        _recogniser = cv2.FaceRecognizerSF.create(str(_model_path("sface")), "")
    return _recogniser


def _prepare(image: np.ndarray):
    """The picture, small enough to look at quickly, and how much it shrank."""
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest <= DETECT_LONG_EDGE:
        return image, 1.0
    scale = DETECT_LONG_EDGE / longest
    resized = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def faces_in_image(image: np.ndarray, frame_time: Optional[float] = None) -> List[dict]:
    """
    Every face in one picture, each with the numbers that identify it.

    The box is returned as a fraction of the picture rather than in pixels, so
    it can be drawn over a thumbnail, a preview or the original without
    knowing which of them is on screen.
    """
    if image is None or image.size == 0:
        return []
    if len(image.shape) == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)

    work, _ = _prepare(image)
    height, width = work.shape[:2]
    detector = _get_detector(width, height)
    _, detections = detector.detect(work)
    if detections is None:
        return []

    recogniser = _get_recogniser()
    faces = []
    for row in detections:
        x, y, w, h = row[:4]
        score = float(row[-1])
        if score < MIN_DETECTION_SCORE or min(w, h) < MIN_FACE_PIXELS:
            continue
        try:
            aligned = recogniser.alignCrop(work, row)
            vector = recogniser.feature(aligned).flatten().astype(np.float32)
        except cv2.error as e:
            logger.debug("[Faces] could not embed a face: %s", e)
            continue
        norm = float(np.linalg.norm(vector))
        if not math.isfinite(norm) or norm == 0:
            continue
        faces.append({
            "embedding": (vector / norm).tolist(),   # unit length: cosine is then a dot product
            "score": score,
            "box": [
                max(0.0, float(x) / width),
                max(0.0, float(y) / height),
                min(1.0, float(w) / width),
                min(1.0, float(h) / height),
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


def faces_in_video_file(path: str, max_frames: int = VIDEO_FRAMES) -> List[dict]:
    """
    Every face across a handful of moments in a film.

    A clip is not searched frame by frame — thirty faces a second of the same
    person is the same fact thirty times over. Moments are taken evenly across
    the whole clip, and near-identical faces within one clip are folded
    together afterwards (see dedupe_faces), so a video contributes who was in
    it rather than how long they stood there.
    """
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        return []
    try:
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0) or 25.0
        faces: List[dict] = []
        if total <= 1:
            ok, frame = capture.read()
            return faces_in_image(frame, 0.0) if ok else []

        step = max(1, total // max_frames)
        for index in range(0, total, step):
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, frame = capture.read()
            if not ok:
                continue
            faces.extend(faces_in_image(frame, round(index / fps, 2)))
            if len(faces) > 400:
                break
        return faces
    finally:
        capture.release()


def dedupe_faces(faces: List[dict], threshold: float = 0.62) -> List[dict]:
    """
    One entry per person per file, keeping the clearest sighting of them.

    Cosine similarity on unit vectors, so this is a dot product. The threshold
    is deliberately loose: within a single clip, two faces this close are the
    same person at two moments, and keeping both would make that person count
    twice in every search that follows.
    """
    kept: List[dict] = []
    for face in sorted(faces, key=lambda f: f["score"], reverse=True):
        vector = np.array(face["embedding"], dtype=np.float32)
        if any(float(np.dot(vector, np.array(k["embedding"], dtype=np.float32))) >= threshold for k in kept):
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
