import io
import pytest
from unittest.mock import patch
from PIL import Image
from app.services.thumbnail_service import thumbnail_service
from app.services.s3_service import s3_service
import uuid

def test_thumbnail_image_generation():
    # 1. Create a dummy PNG image in memory (800x600)
    img = Image.new("RGB", (800, 600), color=(73, 109, 137))
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="PNG")
    img_bytes = img_byte_arr.getvalue()

    # 2. Generate thumbnail
    thumb_bytes = thumbnail_service.generate_image_thumbnail(img_bytes)
    assert thumb_bytes is not None
    assert len(thumb_bytes) > 0

    # 3. Verify thumbnail dimensions (should be <= 400x400)
    with Image.open(io.BytesIO(thumb_bytes)) as thumb_img:
        assert thumb_img.format == "WEBP"
        assert thumb_img.width <= 400
        assert thumb_img.height <= 400

def test_thumbnail_s3_storage_and_cleanup():
    # Mock s3_service put_object, get_object_content, and delete_object
    mock_storage = {}

    def mock_put(s3_key, data, content_type="application/octet-stream"):
        mock_storage[s3_key] = data

    def mock_get(s3_key):
        return mock_storage.get(s3_key)

    def mock_delete(s3_key):
        mock_storage.pop(s3_key, None)

    with patch.object(s3_service, 'put_object', side_effect=mock_put), \
         patch.object(s3_service, 'get_object_content', side_effect=mock_get), \
         patch.object(s3_service, 'delete_object', side_effect=mock_delete):

        img = Image.new("RGB", (600, 400), color=(200, 50, 50))
        img_io = io.BytesIO()
        img.save(img_io, format="JPEG")
        raw_bytes = img_io.getvalue()

        file_uuid = str(uuid.uuid4())
        thumb_key = thumbnail_service.create_and_store_thumbnail(
            file_uuid=file_uuid,
            filename="photo.jpg",
            file_bytes=raw_bytes,
            file_type="image"
        )
        assert thumb_key is not None
        assert thumb_key == f"thumbnails/{file_uuid}/thumb.webp"
        assert thumb_key in mock_storage

        # Original upload
        orig_key = f"uploads/{file_uuid}/photo.jpg"
        s3_service.put_object(orig_key, raw_bytes, "image/jpeg")
        assert orig_key in mock_storage

        # Clean up both original and thumbnail on deletion
        s3_service.delete_object(orig_key)
        s3_service.delete_object(thumb_key)

        assert orig_key not in mock_storage
        assert thumb_key not in mock_storage
