from __future__ import annotations

import io
import os
import secrets
import warnings
from pathlib import PurePosixPath

import boto3
from cryptography.fernet import Fernet
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

from .config import Settings
from .security import digest

MAX_UPLOAD = 50 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 30_000_000


class ObjectStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.root = settings.data_dir / "objects"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if settings.backup_key:
            key = settings.backup_key.encode()
        else:
            key_file = settings.data_dir / "backup.key"
            try:
                fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                key = key_file.read_bytes()
            else:
                key = Fernet.generate_key()
                with os.fdopen(fd, "wb") as stream:
                    stream.write(key)
        self.cipher = Fernet(key)
        self.s3 = (
            boto3.client("s3", endpoint_url=settings.s3_endpoint, region_name=settings.s3_region)
            if settings.s3_bucket
            else None
        )

    def _path(self, key):
        if (
            not key
            or len(key) > 500
            or any(x in ("", ".", "..") for x in key.split("/"))
            or "\\" in key
            or PurePosixPath(key).is_absolute()
        ):
            raise ValueError("Invalid object key.")
        return self.root / key

    def put(self, key, data, media_type="application/octet-stream", encrypt=False):
        self._path(key)
        payload = self.cipher.encrypt(data) if encrypt else data
        if self.s3:
            self.s3.put_object(
                Bucket=self.settings.s3_bucket,
                Key=key,
                Body=payload,
                ContentType="application/octet-stream" if encrypt else media_type,
                ServerSideEncryption="AES256",
            )
        else:
            path = self._path(key)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = path.with_suffix(f".{secrets.token_hex(6)}.tmp")
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        return key

    def get(self, key, decrypt=False):
        self._path(key)
        if self.s3:
            data = self.s3.get_object(Bucket=self.settings.s3_bucket, Key=key)["Body"].read(MAX_UPLOAD + 1)
        else:
            data = self._path(key).read_bytes()
        return self.cipher.decrypt(data) if decrypt else data

    def delete(self, key):
        self._path(key)
        if self.s3:
            self.s3.delete_object(Bucket=self.settings.s3_bucket, Key=key)
        else:
            self._path(key).unlink(missing_ok=True)


def verified_image(data):
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Images must be smaller than 50 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in ("PNG", "JPEG", "WEBP", "BMP"):
                    raise ValueError("Use PNG, JPEG, WebP or BMP.")
                if image.width < 100 or image.height < 100:
                    raise ValueError("The image is too small to read.")
                image.verify()
                media = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "BMP": "image/bmp"}[
                    image.format
                ]
        return media, digest(data)
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
    ) as exc:
        raise HTTPException(400, f"Invalid or unsafe image: {exc}") from exc
