import io
import os
import tempfile
from typing import Optional
from PIL import Image
import cv2
from app.services.s3_service import s3_service

THUMBNAIL_MAX_SIZE = (400, 400)
THUMBNAIL_FORMAT = "WEBP"
THUMBNAIL_MIME = "image/webp"

class ThumbnailService:
    def generate_image_thumbnail(self, image_bytes: bytes) -> Optional[bytes]:
        """Generate a resized WebP thumbnail from image bytes using Pillow."""
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                # Convert RGBA / P modes to RGB if saving to RGB-only or preserve RGBA for WebP
                if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                    img = img.convert("RGBA")
                else:
                    img = img.convert("RGB")

                img.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)
                
                out_io = io.BytesIO()
                img.save(out_io, format=THUMBNAIL_FORMAT, quality=80, method=4)
                return out_io.getvalue()
        except Exception as e:
            print(f"[ThumbnailService Warning] Failed to generate image thumbnail: {e}")
            return None

    def generate_video_thumbnail(self, video_bytes: bytes) -> Optional[bytes]:
        """Extract a frame from video bytes and generate a WebP thumbnail using OpenCV and Pillow."""
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
                temp_file.write(video_bytes)
                temp_path = temp_file.name

            cap = cv2.VideoCapture(temp_path)
            if not cap.isOpened():
                print("[ThumbnailService Warning] OpenCV could not open video file.")
                return None

            # Try to grab frame around 1 sec or 10th frame if video is longer
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS) or 24
            target_frame = min(int(fps * 1.0), max(0, total_frames - 1)) if total_frames > 1 else 0
            cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)

            success, frame = cap.read()
            if not success or frame is None:
                # Fallback to first frame
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                success, frame = cap.read()

            cap.release()

            if not success or frame is None:
                return None

            # Convert BGR (OpenCV) to RGB
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(rgb_frame)
            img.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)

            out_io = io.BytesIO()
            img.save(out_io, format=THUMBNAIL_FORMAT, quality=80, method=4)
            return out_io.getvalue()
        except Exception as e:
            print(f"[ThumbnailService Warning] Failed to generate video thumbnail: {e}")
            return None
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    def create_and_store_thumbnail_from_path(self, file_uuid: str, filename: str, file_path: str, file_type: str) -> Optional[str]:
        """
        Generate thumbnail directly from a disk file path without loading large files into memory.
        """
        name_lower = filename.lower()
        thumb_bytes = None

        if file_type == "image" or name_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg")):
            try:
                with open(file_path, "rb") as f:
                    thumb_bytes = self.generate_image_thumbnail(f.read())
            except Exception as e:
                print(f"[ThumbnailService Warning] Failed to read image file: {e}")
        elif file_type == "video" or name_lower.endswith((".mp4", ".webm", ".mov", ".avi", ".mkv")):
            try:
                cap = cv2.VideoCapture(str(file_path))
                if cap.isOpened():
                    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    fps = cap.get(cv2.CAP_PROP_FPS) or 24
                    target_frame = min(int(fps * 1.0), max(0, total_frames - 1)) if total_frames > 1 else 0
                    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)

                    success, frame = cap.read()
                    if not success or frame is None:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        success, frame = cap.read()

                    cap.release()

                    if success and frame is not None:
                        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        img = Image.fromarray(rgb_frame)
                        img.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)

                        out_io = io.BytesIO()
                        img.save(out_io, format=THUMBNAIL_FORMAT, quality=80, method=4)
                        thumb_bytes = out_io.getvalue()
            except Exception as e:
                print(f"[ThumbnailService Warning] Direct video path thumbnail failed: {e}")

        if not thumb_bytes:
            return None

        thumb_s3_key = f"thumbnails/{file_uuid}/thumb.webp"
        try:
            s3_service.put_object(
                s3_key=thumb_s3_key,
                data=thumb_bytes,
                content_type=THUMBNAIL_MIME
            )
            print(f"[ThumbnailService] Generated and stored thumbnail: {thumb_s3_key} ({len(thumb_bytes)} bytes)")
            return thumb_s3_key
        except Exception as e:
            print(f"[ThumbnailService Error] Failed to upload thumbnail to S3: {e}")
            return None

    def create_and_store_thumbnail(self, file_uuid: str, filename: str, file_bytes: bytes, file_type: str) -> Optional[str]:
        """
        Generate thumbnail for media files (image/video) and store it in MinIO.
        Returns the s3_key of the thumbnail or None.
        """
        name_lower = filename.lower()
        thumb_bytes = None

        if file_type == "image" or name_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg")):
            thumb_bytes = self.generate_image_thumbnail(file_bytes)
        elif file_type == "video" or name_lower.endswith((".mp4", ".webm", ".mov", ".avi", ".mkv")):
            thumb_bytes = self.generate_video_thumbnail(file_bytes)

        if not thumb_bytes:
            return None

        thumb_s3_key = f"thumbnails/{file_uuid}/thumb.webp"
        try:
            s3_service.put_object(
                s3_key=thumb_s3_key,
                data=thumb_bytes,
                content_type=THUMBNAIL_MIME
            )
            print(f"[ThumbnailService] Generated and stored thumbnail: {thumb_s3_key} ({len(thumb_bytes)} bytes)")
            return thumb_s3_key
        except Exception as e:
            print(f"[ThumbnailService Error] Failed to upload thumbnail to S3: {e}")
            return None

thumbnail_service = ThumbnailService()
