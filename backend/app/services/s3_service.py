import os
import shutil
from pathlib import Path, PurePosixPath
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from typing import Optional, List, Dict
import urllib.parse
from app.core.config import settings

LOCAL_STORAGE_DIR = Path(__file__).resolve().parent.parent.parent / "storage_data"
LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_filename(filename: Optional[str]) -> str:
    """
    Reduce a user-supplied filename to a safe basename before it becomes part of
    an S3 key / local storage path segment. Without this, a filename like
    "../../../etc/cron.d/evil" would let an authenticated user write files
    outside storage_data on the local-disk fallback path (S3 has no real
    directory hierarchy, but the local filesystem does resolve ".." segments).
    """
    name = (filename or "").strip().replace("\\", "/")
    name = PurePosixPath(name).name
    name = name.strip()
    if name in ("", ".", ".."):
        name = "unnamed_file"
    return name


def build_storage_key(prefix: str, object_id, original_filename: Optional[str]) -> str:
    """
    Build a storage key of the form "{prefix}/{object_id}/{object_id}{ext}" —
    deliberately excluding the original filename (beyond its extension).
    FileItem.name (the user-visible name) can be renamed at any time via
    /api/files/{id}/rename, but a key built from the original filename would
    keep that old name baked into the storage path forever (visible in
    presigned URLs, DB s3_key values, etc.), which does not match a user's
    expectation that renaming a file changes it everywhere. Keeping the
    extension lets Content-Type/tooling still infer the file kind.
    """
    safe_name = sanitize_filename(original_filename)
    ext = ""
    if "." in safe_name:
        candidate_ext = safe_name.rsplit(".", 1)[-1]
        if candidate_ext and len(candidate_ext) <= 15:
            ext = f".{candidate_ext}"
    return f"{prefix}/{object_id}/{object_id}{ext}"

class S3Service:
    def __init__(self):
        endpoint = settings.MINIO_INTERNAL_URL if settings.MINIO_INTERNAL_URL else settings.MINIO_PUBLIC_URL
        self.endpoint_url = endpoint
        self.public_url = settings.MINIO_PUBLIC_URL.rstrip('/')
        self.bucket_name = settings.MINIO_BUCKET_NAME
        self.region_name = settings.MINIO_REGION
        self.local_dir = LOCAL_STORAGE_DIR

        try:
            self.client = boto3.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=settings.MINIO_PUBLIC_ROOT_USER,
                aws_secret_access_key=settings.MINIO_PUBLIC_ROOT_PASSWORD,
                region_name=self.region_name,
                config=Config(
                    signature_version="s3v4",
                    s3={"addressing_style": "path"}
                )
            )
            self._ensure_bucket()
        except Exception as e:
            print(f"[S3 Init Warning] Could not connect to S3 client: {e}")
            self.client = None

    def _get_local_path(self, s3_key: str) -> Path:
        """Get local filesystem path for a given s3_key.

        s3_key is frequently built from a user-supplied filename (e.g. "uploads/{uuid}/{filename}").
        Without this check, a filename containing "../" segments could resolve outside
        local_dir entirely, allowing an authenticated user to read or overwrite arbitrary
        files on the server (e.g. the repo's .env). Reject any key that would escape
        local_dir instead of silently following it.
        """
        p = (self.local_dir / s3_key).resolve()
        if self.local_dir.resolve() not in p.parents and p != self.local_dir.resolve():
            raise ValueError(f"Refusing to resolve s3_key outside storage directory: {s3_key!r}")
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def _ensure_bucket(self):
        """Create bucket if it does not exist."""
        try:
            self.client.head_bucket(Bucket=self.bucket_name)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code in ["404", "NoSuchBucket"]:
                try:
                    self.client.create_bucket(Bucket=self.bucket_name)
                    print(f"[S3] Bucket '{self.bucket_name}' created successfully.")
                except Exception as create_err:
                    print(f"[S3 Warning] Could not create bucket: {create_err}")
            else:
                print(f"[S3 Warning] Head bucket error ({error_code}): {e}")
        except Exception as e:
            print(f"[S3 Warning] Bucket check connection warning: {e}")

    def generate_presigned_put_url(self, s3_key: str, content_type: str = "application/octet-stream", expires_in: int = 3600) -> str:
        """Generate presigned PUT URL for single file upload."""
        try:
            url = self.client.generate_presigned_url(
                ClientMethod="put_object",
                Params={
                    "Bucket": self.bucket_name,
                    "Key": s3_key,
                    "ContentType": content_type
                },
                ExpiresIn=expires_in,
                HttpMethod="PUT"
            )
            # If endpoint differs from public URL, rewrite host
            return self._format_public_url(url)
        except Exception as e:
            print(f"[S3 Error] generate_presigned_put_url: {e}")
            raise

    def generate_presigned_get_url(self, s3_key: str, filename: Optional[str] = None, expires_in: int = 3600) -> str:
        """Generate presigned GET URL for file download/viewing."""
        try:
            params = {
                "Bucket": self.bucket_name,
                "Key": s3_key
            }
            if filename:
                safe_name = urllib.parse.quote(filename)
                params["ResponseContentDisposition"] = f"attachment; filename*=UTF-8''{safe_name}"

            url = self.client.generate_presigned_url(
                ClientMethod="get_object",
                Params=params,
                ExpiresIn=expires_in,
                HttpMethod="GET"
            )
            return self._format_public_url(url)
        except Exception as e:
            print(f"[S3 Error] generate_presigned_get_url: {e}")
            raise

    def create_multipart_upload(self, s3_key: str, content_type: str = "application/octet-stream") -> str:
        """Initiate S3 multipart upload session and return upload_id."""
        try:
            response = self.client.create_multipart_upload(
                Bucket=self.bucket_name,
                Key=s3_key,
                ContentType=content_type
            )
            return response["UploadId"]
        except Exception as e:
            print(f"[S3 Error] create_multipart_upload: {e}")
            raise

    def upload_part(self, s3_key: str, upload_id: str, part_number: int, data: bytes) -> str:
        """
        Stream a single part directly into an in-progress multipart upload
        and return its ETag. Used by the backend-proxied chunk upload route
        so each part reaches MinIO as it arrives, instead of accumulating on
        local disk and being re-uploaded as one giant object at the end (the
        latter is what made completing a large upload take long enough to
        hit the Cloudflare Tunnel's request timeout).
        """
        resp = self.client.upload_part(
            Bucket=self.bucket_name,
            Key=s3_key,
            UploadId=upload_id,
            PartNumber=part_number,
            Body=data,
        )
        return resp["ETag"]

    def generate_multipart_presigned_urls(
        self, s3_key: str, upload_id: str, part_numbers: List[int], expires_in: int = 3600
    ) -> List[Dict[str, any]]:
        """Generate presigned PUT URLs for each part in a multipart upload."""
        parts = []
        for part_num in part_numbers:
            url = self.client.generate_presigned_url(
                ClientMethod="upload_part",
                Params={
                    "Bucket": self.bucket_name,
                    "Key": s3_key,
                    "UploadId": upload_id,
                    "PartNumber": part_num
                },
                ExpiresIn=expires_in,
                HttpMethod="PUT"
            )
            parts.append({
                "part_number": part_num,
                "upload_url": self._format_public_url(url)
            })
        return parts

    def complete_multipart_upload(self, s3_key: str, upload_id: str, parts: List[Dict[str, any]]) -> dict:
        """Complete multipart upload with verified parts and ETags."""
        try:
            # Sort parts by PartNumber
            formatted_parts = [
                {"PartNumber": int(p["PartNumber"]), "ETag": p["ETag"].strip('"')}
                for p in sorted(parts, key=lambda x: int(x["PartNumber"]))
            ]
            response = self.client.complete_multipart_upload(
                Bucket=self.bucket_name,
                Key=s3_key,
                UploadId=upload_id,
                MultipartUpload={"Parts": formatted_parts}
            )
            return response
        except Exception as e:
            print(f"[S3 Error] complete_multipart_upload: {e}")
            raise

    def abort_multipart_upload(self, s3_key: str, upload_id: str):
        """Abort and cleanup an in-progress multipart upload."""
        try:
            self.client.abort_multipart_upload(
                Bucket=self.bucket_name,
                Key=s3_key,
                UploadId=upload_id
            )
        except Exception as e:
            print(f"[S3 Error] abort_multipart_upload: {e}")

    def put_object(self, s3_key: str, data: bytes, content_type: str = "text/markdown; charset=utf-8") -> bool:
        """
        Directly upload bytes to local storage and MinIO.

        Returns whether the bytes ended up somewhere they can be read back
        from. It used to return nothing at all, so a caller asking "did that
        work" — the avatar upload did — read the None as failure and refused
        every image it had just stored correctly.
        """
        local_ok = False
        # 1. Save to local storage cache
        try:
            local_path = self._get_local_path(s3_key)
            with open(local_path, "wb") as f:
                f.write(data)
            local_ok = True
        except Exception as e:
            print(f"[Local Storage Warning] Could not save to local path: {e}")

        # 2. Upload to MinIO if client is available
        remote_ok = False
        if self.client:
            try:
                self.client.put_object(
                    Bucket=self.bucket_name,
                    Key=s3_key,
                    Body=data,
                    ContentType=content_type
                )
                remote_ok = True
            except Exception as e:
                print(f"[S3 Warning] put_object to S3 failed (saved locally): {e}")

        return local_ok or remote_ok

    def get_object_content(self, s3_key: str) -> Optional[bytes]:
        """Download object content from S3 or local cache."""
        # Try S3 first
        if self.client:
            try:
                resp = self.client.get_object(Bucket=self.bucket_name, Key=s3_key)
                return resp["Body"].read()
            except Exception:
                pass

        # Fallback to local storage
        local_path = self._get_local_path(s3_key)
        if local_path.exists() and local_path.is_file():
            try:
                with open(local_path, "rb") as f:
                    return f.read()
            except Exception as e:
                print(f"[Local Storage Error] Could not read local file: {e}")

        return None

    def stream_object(self, s3_key: str, chunk_size: int = 1024 * 1024):
        """
        Yield an object's bytes in chunks instead of loading it fully into
        memory — used by ZIP downloads, which may otherwise need to hold an
        entire multi-GB file in RAM at once (see routers/folders.py, files.py).
        """
        if self.client:
            try:
                body = self.client.get_object(Bucket=self.bucket_name, Key=s3_key)["Body"]
                while True:
                    chunk = body.read(chunk_size)
                    if not chunk:
                        return
                    yield chunk
                return
            except Exception as e:
                print(f"[S3 Error] stream_object: {e}")

        local_path = self._get_local_path(s3_key)
        if local_path.exists() and local_path.is_file():
            try:
                with open(local_path, "rb") as f:
                    while True:
                        chunk = f.read(chunk_size)
                        if not chunk:
                            return
                        yield chunk
            except Exception as e:
                print(f"[Local Storage Error] Could not stream local file: {e}")

    def get_object_range(self, s3_key: str, range_header: str) -> Optional[dict]:
        """Download a byte range of an object from S3 or local storage."""
        # Try S3 first
        if self.client:
            try:
                resp = self.client.get_object(
                    Bucket=self.bucket_name,
                    Key=s3_key,
                    Range=range_header
                )
                return {
                    "body": resp["Body"].read(),
                    "content_length": resp.get("ContentLength"),
                    "content_range": resp.get("ContentRange"),
                    "content_type": resp.get("ContentType", "application/octet-stream")
                }
            except Exception:
                pass

        # Fallback to local storage
        local_path = self._get_local_path(s3_key)
        if local_path.exists() and local_path.is_file():
            try:
                total_size = local_path.stat().st_size
                # Parse range: "bytes=start-end"
                start = 0
                end = total_size - 1
                if range_header and range_header.startswith("bytes="):
                    parts = range_header.replace("bytes=", "").split("-")
                    if parts[0]:
                        start = int(parts[0])
                    if len(parts) > 1 and parts[1]:
                        end = int(parts[1])

                start = max(0, min(start, total_size - 1))
                end = max(start, min(end, total_size - 1))
                length = end - start + 1

                with open(local_path, "rb") as f:
                    f.seek(start)
                    chunk_bytes = f.read(length)

                return {
                    "body": chunk_bytes,
                    "content_length": len(chunk_bytes),
                    "content_range": f"bytes {start}-{end}/{total_size}",
                    "content_type": "application/octet-stream"
                }
            except Exception as e:
                print(f"[Local Storage Error] Range read failed: {e}")

        return None

    def upload_file(self, s3_key: str, local_path: str, content_type: str = "application/octet-stream") -> bool:
        """Upload a local file directly to MinIO S3."""
        if self.client:
            try:
                self.client.upload_file(
                    Filename=str(local_path),
                    Bucket=self.bucket_name,
                    Key=s3_key,
                    ExtraArgs={"ContentType": content_type}
                )
                return True
            except Exception as e:
                print(f"[S3 Error] upload_file to S3 failed: {e}")
        return False

    def copy_object(self, src_key: str, dst_key: str) -> bool:
        """
        Duplicate a stored object under a new key.

        Mirrors delete_object's dual-backend handling: the same object may live
        in S3, on local disk, or both, depending on which path stored it. The
        copy is done server-side by MinIO rather than by streaming the bytes
        through this process, so copying a large file costs no memory here.

        Returns whether either backend produced a copy — a caller creating a
        FileItem row for the copy must not do so if this is False, or the row
        would point at a key holding nothing.
        """
        copied = False

        if self.client:
            try:
                self.client.copy_object(
                    Bucket=self.bucket_name,
                    CopySource={"Bucket": self.bucket_name, "Key": src_key},
                    Key=dst_key,
                )
                copied = True
            except Exception as e:
                print(f"[S3 Error] copy_object {src_key} -> {dst_key}: {e}")

        try:
            src_path = self._get_local_path(src_key)
            if src_path.exists():
                shutil.copy2(src_path, self._get_local_path(dst_key))
                copied = True
        except Exception as e:
            print(f"[Local Storage Warning] Could not copy local file: {e}")

        return copied

    def delete_object(self, s3_key: str):
        """Delete object from MinIO and local storage."""
        # 1. Delete from S3
        if self.client:
            try:
                self.client.delete_object(Bucket=self.bucket_name, Key=s3_key)
            except Exception as e:
                print(f"[S3 Error] delete_object: {e}")

        # 2. Delete from local storage
        try:
            local_path = self._get_local_path(s3_key)
            if local_path.exists():
                local_path.unlink()
        except Exception as e:
            print(f"[Local Storage Warning] Could not delete local file: {e}")

    def delete_objects_batch(self, s3_keys: List[str]):
        """Delete multiple objects from S3 and local storage in batch."""
        if not s3_keys:
            return
        
        # 1. Delete from S3 in batches of up to 1000
        if self.client:
            for i in range(0, len(s3_keys), 1000):
                batch = s3_keys[i:i+1000]
                try:
                    self.client.delete_objects(
                        Bucket=self.bucket_name,
                        Delete={"Objects": [{"Key": k} for k in batch]}
                    )
                except Exception as e:
                    print(f"[S3 Error] delete_objects batch failed: {e}")

        # 2. Delete from local storage
        for k in s3_keys:
            try:
                local_path = self._get_local_path(k)
                if local_path.exists():
                    local_path.unlink()
            except Exception as e:
                print(f"[Local Storage Warning] Could not delete local file: {e}")

    def _format_public_url(self, presigned_url: str) -> str:
        """Ensure the presigned URL points to the public URL domain."""
        if not self.public_url or self.endpoint_url == self.public_url:
            return presigned_url
        
        parsed_endpoint = urllib.parse.urlparse(self.endpoint_url)
        parsed_public = urllib.parse.urlparse(self.public_url)
        
        return presigned_url.replace(
            f"{parsed_endpoint.scheme}://{parsed_endpoint.netloc}",
            f"{parsed_public.scheme}://{parsed_public.netloc}",
            1
        )

s3_service = S3Service()
