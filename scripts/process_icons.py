#!/usr/bin/env python3
"""
Process CodeGrid icon into all required sizes:
- macOS Tauri bundle: 32, 128, 128@2x (256), 512, 1024 + icon.icns + icon.ico + icon.png
- Favicon set: 16, 32, 48, 180 (apple-touch-icon), 192, 512 (PWA)
- Web: favicon.ico (multi-size), og image copy

macOS app icon rounded corner spec:
  Apple uses a squircle (superellipse) with exponent ~5, covering ~90% of the bounding box.
  Standard formula: radius = 27.5% of icon width for the mask.
"""

import math
import struct
import zlib
import urllib.request
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SRC = Path(__file__).parent.parent / "src-tauri" / "icons" / "generated" / "icon_raw.png"
ICONS_DIR = Path(__file__).parent.parent / "src-tauri" / "icons"
PUBLIC_DIR = Path(__file__).parent.parent / "public"
WEB_DIR = Path(__file__).parent.parent  # index.html lives here; favicon goes to public

assert SRC.exists(), f"Missing source: {SRC}"

def squircle_mask(size: int, exponent: float = 5.0) -> Image.Image:
    """Create a squircle (superellipse) mask at 2x for anti-aliasing, then downsample."""
    scale = 4
    big = size * scale
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    cx = cy = big / 2
    r = big / 2 * 0.88  # ~88% fill — matches Apple's squircle coverage

    pixels = mask.load()
    for y in range(big):
        for x in range(big):
            nx = (x - cx) / r
            ny = (y - cy) / r
            val = abs(nx) ** exponent + abs(ny) ** exponent
            if val <= 1.0:
                pixels[x, y] = 255

    mask = mask.filter(ImageFilter.GaussianBlur(radius=scale * 0.5))
    mask = mask.resize((size, size), Image.LANCZOS)
    return mask

def apply_squircle(img: Image.Image, size: int) -> Image.Image:
    """Resize image to `size` and apply macOS squircle mask."""
    img = img.convert("RGBA").resize((size, size), Image.LANCZOS)
    mask = squircle_mask(size)
    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    result.paste(img, mask=mask)
    return result

def make_ico(images: dict[int, Image.Image]) -> bytes:
    """Build a .ico file from multiple sizes."""
    sizes = sorted(images.keys())
    header = struct.pack("<HHH", 0, 1, len(sizes))
    dir_entries = b""
    img_datas = b""
    offset = 6 + 16 * len(sizes)

    for s in sizes:
        img = images[s].convert("RGBA")
        import io
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()

        w = s if s < 256 else 0
        h = s if s < 256 else 0
        dir_entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        img_datas += data
        offset += len(data)

    return header + dir_entries + img_datas

print("Loading source icon...")
src = Image.open(SRC).convert("RGBA")

# ── macOS Tauri bundle sizes ──────────────────────────────────────────────────
tauri_sizes = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "512x512.png": 512,
    "1024x1024.png": 1024,
    "icon.png": 1024,
}

print("\nGenerating Tauri bundle icons (with macOS squircle mask)...")
masked_by_size: dict[int, Image.Image] = {}

for filename, size in tauri_sizes.items():
    masked = apply_squircle(src, size)
    out = ICONS_DIR / filename
    masked.save(out, "PNG", optimize=True)
    masked_by_size[size] = masked
    print(f"  ✓ {filename} ({size}x{size})")

# ── icon.ico — multi-size (16, 32, 48, 256) ──────────────────────────────────
print("\nGenerating icon.ico...")
ico_images = {}
for s in [16, 32, 48, 256]:
    ico_images[s] = apply_squircle(src, s)
ico_data = make_ico(ico_images)
with open(ICONS_DIR / "icon.ico", "wb") as f:
    f.write(ico_data)
print("  ✓ icon.ico (16, 32, 48, 256)")

# ── icon.icns — use iconutil if on macOS, else skip ───────────────────────────
icns_dir = ICONS_DIR / "AppIcon.iconset"
icns_dir.mkdir(exist_ok=True)
icns_map = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_64x64.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}
for fname, size in icns_map.items():
    img = apply_squircle(src, size)
    img.save(icns_dir / fname, "PNG")

result = subprocess.run(
    ["iconutil", "-c", "icns", str(icns_dir), "-o", str(ICONS_DIR / "icon.icns")],
    capture_output=True, text=True
)
if result.returncode == 0:
    print("  ✓ icon.icns")
else:
    print(f"  ⚠ iconutil failed: {result.stderr}")

# ── Web favicons ──────────────────────────────────────────────────────────────
print("\nGenerating web favicons...")

favicon_sizes = {
    "favicon-16x16.png": 16,
    "favicon-32x32.png": 32,
    "favicon-48x48.png": 48,
    "apple-touch-icon.png": 180,
    "icon-192x192.png": 192,
    "icon-512x512.png": 512,
}

for fname, size in favicon_sizes.items():
    img = apply_squircle(src, size)
    img.save(PUBLIC_DIR / fname, "PNG", optimize=True)
    print(f"  ✓ {fname}")

# favicon.ico at root (16, 32, 48)
print("\nGenerating root favicon.ico...")
fav_ico = make_ico({16: apply_squircle(src, 16), 32: apply_squircle(src, 32), 48: apply_squircle(src, 48)})
with open(WEB_DIR / "favicon.ico", "wb") as f:
    f.write(fav_ico)
print("  ✓ favicon.ico (root)")

# Copy OG image to canonical public/og.png
import shutil
og_src = PUBLIC_DIR / "og_image_raw.png"
og_dst = PUBLIC_DIR / "og.png"
shutil.copy(og_src, og_dst)
print(f"  ✓ og.png")

print("\n✅ All icons generated successfully!")
