"""Normalize bounded profile uploads; preserve GIF frames without filesystem storage."""
import hashlib
import io
import time
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import ValidationError

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_FRAMES = 120
MAX_SOURCE_PIXELS = 16_000_000
MAX_SEQUENCE_PIXELS = 80_000_000
SIZES = {"avatar": (256, 256), "banner": (1280, 240)}
Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS


@dataclass(frozen=True)
class ProcessedImage:
    data: bytes
    poster: bytes
    content_type: str
    width: int
    height: int
    frames: int

    @property
    def version(self):
        return hashlib.sha256(self.data).hexdigest()


def webp(frame):
    output = io.BytesIO()
    frame.save(output, format="WEBP", quality=88, method=4)
    return output.getvalue()


def gif_frame(frame):
    # Reserve palette entry 255 for transparency. Each output frame is a full
    # composited canvas, so disposal=2 does not leave trails between frames.
    palette = frame.convert("RGB").quantize(colors=255, method=Image.Quantize.FASTOCTREE)
    transparent = frame.getchannel("A").point(lambda alpha: 255 if alpha < 128 else 0)
    palette.paste(255, mask=transparent)
    palette.info["transparency"] = 255
    return palette


def normalize_image(upload, kind):
    if not upload.size or upload.size > MAX_UPLOAD_BYTES:
        raise ValidationError({kind: "Choose an image up to 8 MB."})
    raw = upload.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValidationError({kind: "Choose an image up to 8 MB."})
    size = SIZES[kind]
    started = time.monotonic()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP", "GIF"}:
                    raise ValidationError({kind: "Use a PNG, JPG, WebP, or GIF image."})
                count = getattr(source, "n_frames", 1)
                if count > 1 and source.format != "GIF":
                    raise ValidationError({kind: "Use GIF for animated images."})
                if count > MAX_FRAMES:
                    raise ValidationError({kind: "Choose a GIF with no more than 120 frames."})
                loop = source.info.get("loop")
                frames, durations = [], []
                decoded_pixels = 0
                poster = b""
                for index in range(count):
                    source.seek(index)
                    pixels = source.width * source.height
                    decoded_pixels += pixels
                    if pixels > MAX_SOURCE_PIXELS or decoded_pixels > MAX_SEQUENCE_PIXELS or time.monotonic() - started > 20:
                        raise ValidationError({kind: "This image is too large or complex. Try a smaller image or shorter GIF."})
                    fitted = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGBA"), size, method=Image.Resampling.LANCZOS)
                    if index == 0:
                        poster = webp(fitted)
                    if count == 1:
                        return ProcessedImage(poster, b"", "image/webp", *size, 1)
                    durations.append(int(source.info.get("duration", 100)))
                    frames.append(gif_frame(fitted))
                output = io.BytesIO()
                options = {"save_all": True, "append_images": frames[1:], "duration": durations, "disposal": 2, "transparency": 255, "optimize": False}
                if loop is not None:
                    options["loop"] = loop
                frames[0].save(output, format="GIF", **options)
                data = output.getvalue()
                if len(data) > MAX_UPLOAD_BYTES:
                    raise ValidationError({kind: "The fitted GIF is too large. Try a shorter or simpler GIF."})
                return ProcessedImage(data, poster, "image/gif", *size, count)
    except ValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValidationError({kind: "Choose an image no larger than 16 megapixels."}) from None
    except (UnidentifiedImageError, OSError, EOFError, ValueError, SyntaxError):
        raise ValidationError({kind: "This file could not be read as an image. Use PNG, JPG, WebP, or GIF."}) from None
