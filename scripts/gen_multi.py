#!/usr/bin/env python3
"""Generate CodeGrid icon from 4 top models in parallel."""
import os, threading, urllib.request, traceback
import fal_client
from pathlib import Path

os.environ["FAL_KEY"] = "b6cd0539-4595-4676-b35b-e94d4105bf00:8d5839b8e8576a6e405ae566ffe4fa85"

OUT = Path(__file__).parent.parent / "src-tauri" / "icons" / "candidates"
OUT.mkdir(parents=True, exist_ok=True)

PROMPT = (
    "Minimalist square app icon for a macOS developer app called CodeGrid. "
    "Pure jet-black background (#0A0A0A). "
    "A bold 3x3 terminal grid made of crisp orange (#FF8C00) lines fills the icon. "
    "Dead-center of the grid: the bold monospace letters 'CG' in bright orange (#FF8C00), "
    "large, sharp, no blur. "
    "Bottom-right grid cell: a tiny glowing green dot (#00C853) like a terminal cursor. "
    "Sharp outer square border in orange. "
    "NO gradients, NO shadows, NO noise, NO photographic elements. "
    "Flat geometric vector aesthetic. Clean, iconic, professional macOS app icon. "
    "Square 1:1 aspect ratio."
)

OG_PROMPT = (
    "Wide horizontal banner 1200x630 for a macOS developer productivity app called CODEGRID. "
    "Deep matte black background (#0a0a0a) with faint dark-gray 3x3 grid texture. "
    "LEFT SIDE: large bold all-caps wordmark 'CODEGRID' in JetBrains Mono, glowing orange (#FF8C00). "
    "Below it in small monospace gray text: 'Terminal workspace manager for AI coding'. "
    "RIGHT SIDE: artistic arrangement of 4 glowing terminal windows in a 2x2 grid, "
    "each containing faint green and orange code text, like a real terminal workspace. "
    "Top-right corner: small square logo badge with 'CG' in orange. "
    "Clean dark developer aesthetic. Ultra sharp. No photorealism needed."
)

MODELS = [
    {
        "id": "fal-ai/recraft-v3",
        "name": "recraft-v3",
        "args": {
            "prompt": PROMPT,
            "image_size": {"width": 1024, "height": 1024},
            "style": "digital_illustration",
            "output_format": "png",
        },
    },
    {
        "id": "fal-ai/ideogram/v2",
        "name": "ideogram-v2",
        "args": {
            "prompt": PROMPT,
            "image_size": "square_hd",
            "style": "design",
            "output_format": "png",
            "num_images": 1,
        },
    },
    {
        "id": "fal-ai/flux-pro/v1.1",
        "name": "flux-pro-v1.1",
        "args": {
            "prompt": PROMPT,
            "image_size": {"width": 1024, "height": 1024},
            "output_format": "png",
            "num_images": 1,
        },
    },
    {
        "id": "fal-ai/gpt-image-1.5",
        "name": "gpt-image-1.5",
        "args": {
            "prompt": PROMPT,
            "image_size": "square_hd",
            "output_format": "png",
            "num_images": 1,
        },
    },
]

# Also generate OG from the best model (recraft)
OG_MODEL = {
    "id": "fal-ai/recraft-v3",
    "name": "og-recraft-v3",
    "args": {
        "prompt": OG_PROMPT,
        "image_size": {"width": 1200, "height": 630},
        "style": "digital_illustration",
        "output_format": "png",
    },
}

results = {}
lock = threading.Lock()

def run(model):
    name = model["name"]
    print(f"  → Starting {name}...")
    try:
        r = fal_client.subscribe(
            model["id"],
            arguments=model["args"],
            with_logs=False,
        )
        # extract image URL from various response shapes
        images = r.get("images") or r.get("output") or []
        if not images:
            raise ValueError(f"No images in response: {list(r.keys())}")
        url = images[0]["url"] if isinstance(images[0], dict) else images[0]
        out_path = OUT / f"icon_{name}.png"
        urllib.request.urlretrieve(url, out_path)
        with lock:
            results[name] = ("ok", out_path)
        print(f"  ✓ {name} saved → {out_path.name}")
    except Exception as e:
        with lock:
            results[name] = ("err", str(e))
        print(f"  ✗ {name} FAILED: {e}")
        traceback.print_exc()

all_models = MODELS + [OG_MODEL]
threads = [threading.Thread(target=run, args=(m,)) for m in all_models]
print(f"Firing {len(threads)} generations in parallel...\n")
for t in threads:
    t.start()
for t in threads:
    t.join()

print("\n=== Results ===")
for name, (status, info) in results.items():
    print(f"  {status.upper()} {name}: {info}")
