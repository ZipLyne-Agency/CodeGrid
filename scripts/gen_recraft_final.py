#!/usr/bin/env python3
"""Generate final CodeGrid icon + OG image using Recraft V3 with exact brand colors."""

import os, threading, urllib.request
import fal_client
from pathlib import Path
from PIL import Image

os.environ["FAL_KEY"] = "b6cd0539-4595-4676-b35b-e94d4105bf00:8d5839b8e8576a6e405ae566ffe4fa85"

OUT = Path(__file__).parent.parent / "src-tauri" / "icons" / "candidates"
OG_OUT = Path(__file__).parent.parent / "public"
OUT.mkdir(parents=True, exist_ok=True)

# Exact brand colors passed to Recraft's color palette control
BRAND_COLORS = [
    {"r": 10,  "g": 10,  "b": 10},   # #0A0A0A near-black background
    {"r": 255, "g": 140, "b": 0},    # #FF8C00 brand orange
    {"r": 0,   "g": 200, "b": 83},   # #00C853 terminal green
]

ICON_PROMPT = (
    "Flat front-facing square app icon. STRICT 2D — absolutely no 3D perspective, "
    "no tilt, no rotation, no shadows, no depth. "
    "Pure flat design viewed straight-on. "
    "Black background (#0A0A0A). "
    "A precise 3x3 grid of equal rectangular cells with clean thin orange (#FF8C00) lines — "
    "like a tic-tac-toe board filling the entire icon. "
    "The center cell contains the bold monospace text 'CG' in bright orange, large and centered. "
    "The bottom-right cell contains a small solid bright green (#00C853) circle — a terminal cursor dot. "
    "All other cells are empty black. "
    "Thin orange square border around the entire icon edge. "
    "Completely flat. Vector-clean. No gradients, no blur, no noise, no perspective whatsoever."
)

OG_PROMPT = (
    "Wide flat horizontal banner, strictly 2D, no perspective, no 3D. "
    "Pure matte black background (#0A0A0A). "
    "A very faint 3x3 grid texture in dark gray (#1A1A1A) across the entire background. "
    "Left half: "
    "Large bold all-caps wordmark 'CODEGRID' in bright orange (#FF8C00), monospace font, glowing slightly. "
    "Below it in smaller monospace gray text: 'Terminal workspace manager for AI coding'. "
    "Right half: "
    "Four terminal window panels arranged in a 2x2 grid. Each panel has a dark (#111) background "
    "with orange and green monospace code text lines inside. Panels have thin orange borders. "
    "Top-right corner of the banner: small square badge with thin orange border, 'CG' in orange inside. "
    "Clean flat developer aesthetic. No 3D, no shadows, no perspective."
)

results = {}
lock = threading.Lock()

def run(label, model_id, args, out_path):
    print(f"  → Generating {label}...")
    try:
        r = fal_client.subscribe(model_id, arguments=args, with_logs=False)
        url = r["images"][0]["url"]
        urllib.request.urlretrieve(url, out_path)
        # Convert webp → png if needed
        img = Image.open(out_path)
        if img.format == "WEBP" or out_path.suffix != ".png":
            png_path = out_path.with_suffix(".png")
            img.convert("RGBA").save(png_path, "PNG")
            os.remove(out_path)
            out_path = png_path
        with lock:
            results[label] = ("ok", out_path)
        print(f"  ✓ {label} → {out_path.name}")
    except Exception as e:
        with lock:
            results[label] = ("err", str(e))
        print(f"  ✗ {label} FAILED: {e}")

jobs = [
    (
        "icon-recraft-v3-flat",
        "fal-ai/recraft-v3",
        {
            "prompt": ICON_PROMPT,
            "image_size": "square_hd",
            "style": "vector_illustration/sharp_contrast",
            "colors": BRAND_COLORS,
        },
        OUT / "icon_recraft_flat.webp",
    ),
    (
        "og-recraft-v3",
        "fal-ai/recraft-v3",
        {
            "prompt": OG_PROMPT,
            "image_size": {"width": 1200, "height": 630},
            "style": "digital_illustration/neon_calm",
            "colors": BRAND_COLORS,
        },
        OG_OUT / "og_recraft.webp",
    ),
]

threads = [threading.Thread(target=run, args=j) for j in jobs]
print("Firing icon + OG in parallel via Recraft V3...\n")
for t in threads:
    t.start()
for t in threads:
    t.join()

print("\n=== Done ===")
for label, (status, info) in results.items():
    print(f"  {status.upper()} {label}: {info}")
