"""Local media storage for image submissions.

In dev, images arrive as base64 and are written under LOCAL_MEDIA_DIR; the
returned relative path is stored in `submissions.content_url`. Production swaps
this for S3 behind the MEDIA_STORAGE flag (AWS migration) — same return shape.
"""
from __future__ import annotations

import base64
import binascii
import os
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status


# Reads the same env var the guide defines; defaults to a repo-local folder.
LOCAL_MEDIA_DIR = Path(os.environ.get('LOCAL_MEDIA_DIR', './media_uploads')).resolve()

def _strip_data_url(content: str) -> str:
    """Accept either a raw base64 string or a `data:image/...;base64,<data>` URL."""
    if content.startswith('data:') and ',' in content:
        return content.split(',', 1)[1]
    return content


def _extension_for(raw: bytes) -> str:
    """Cheap magic-byte sniff for image/video files so the file gets a usable
    extension (the frontend renders <img> vs <video> by extension)."""
    if raw[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if raw[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if raw[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if raw[:4] == b'RIFF':
        if raw[8:12] == b'WEBP':
            return 'webp'
        if raw[8:12] == b'AVI ':
            return 'avi'
    if raw[:4] == b'\x1aE\xdf\xa3':  # EBML header → WebM / Matroska
        return 'webm'
    if raw[4:8] == b'ftyp':  # ISO base media (MP4 / QuickTime)
        return 'mov' if raw[8:11] == b'qt ' else 'mp4'
    return 'bin'


def save_base64_image(content: str) -> str:
    """Decode a base64 image and persist it. Returns the stored relative path."""
    try:
        raw = base64.b64decode(_strip_data_url(content), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='content is not valid base64 image data',
        ) from exc
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='image content is empty',
        )

    LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    filename = f'{uuid4().hex}.{_extension_for(raw)}'
    (LOCAL_MEDIA_DIR / filename).write_bytes(raw)
    # Stored path is relative + namespaced so a future static mount can serve it.
    return f'media_uploads/{filename}'
