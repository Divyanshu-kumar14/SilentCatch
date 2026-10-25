"""Deterministic synthetic clinical imagery (zero PHI) — PRD FR-1.1 inputs.

Generates grayscale PNGs with a NumPy-free (pure zlib/struct) writer:
seeded noise + a radiopaque spherical lesion + ROI annotation box, sized to
the PRD Fallback A dimension (768 max edge — fixtures at 256 for repo weight).

Usage: python -m backend.fixtures.generate_images  (idempotent)
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np

OUT_DIR = Path(__file__).resolve().parent / "images"
SIZE = 256
SEED = 20261025  # stable across re-runs -> stable SHA-256 vision cache keys


def write_png(path: Path, gray: np.ndarray) -> None:
    """Minimal valid 8-bit grayscale PNG (filter 0 per row)."""
    height, width = gray.shape
    raw = b"".join(b"\x00" + gray[y].astype(np.uint8).tobytes() for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    body = chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + body)


def canvas(rng: np.random.Generator, base: int = 40, noise: int = 8) -> np.ndarray:
    return np.clip(rng.normal(base, noise, (SIZE, SIZE)), 0, 255).astype(np.uint8)


def add_lesion(img: np.ndarray, cy: int, cx: int, radius: int, brightness: int) -> np.ndarray:
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    dist = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    lesion = np.clip(radius - dist, 0, None) / radius  # soft-edged sphere falloff
    out = img.astype(float) + lesion * brightness
    annot = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2).round() == radius + 24
    return out, annot  # type: ignore[return-value]


def compose(rng: np.random.Generator, lesion: tuple[int, int, int, int] | None) -> np.ndarray:
    img = canvas(rng)
    if lesion:
        out, ring = add_lesion(img, *lesion)
        out[ring] = 255
    else:
        out = img
    return np.clip(out, 0, 255).astype(np.uint8)


def main() -> None:
    rng = np.random.default_rng(SEED)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = {
        # (cy, cx, radius, brightness) — None = clean film
        "ankle_xray_28m.png": None,
        "cxr_rll_consolidation_54f.png": (150, 120, 26, 70),  # RLL consolidation region
        "ct_abd_stone_3mm_41m.png": None,
        "ct_chest_rul_nodule_7mm.png": (90, 170, 4, 110),  # 7.2 mm RUL caliper target
    }
    for name, lesion in targets.items():
        write_png(OUT_DIR / name, compose(rng, lesion))
    print(f"wrote {len(targets)} PNGs to {OUT_DIR}")


if __name__ == "__main__":
    main()
