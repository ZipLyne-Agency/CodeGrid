#!/usr/bin/env python3
"""Generate CodeGrid app icons and OG image via FAL AI."""

import os
import sys
import fal_client
import urllib.request
from pathlib import Path

FAL_KEY = "b6cd0539-4595-4676-b35b-e94d4105bf00:8d5839b8e8576a6e405ae566ffe4fa85"
os.environ["FAL_KEY"] = FAL_KEY

OUTPUT_DIR = Path(__file__).parent.parent / "src-tauri" / "icons" / "generated"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OG_DIR = Path(__file__).parent.parent / "public"
OG_DIR.mkdir(parents=True, exist_ok=True)

ICON_PROMPT = """A minimalist square app icon for a developer productivity app called "CodeGrid". 
Jet-black background. A bold, clean 3x3 terminal grid made of sharp orange (#FF8C00) lines. 
In the center cell of the grid: the two-character monogram "CG" rendered in a crisp monospace 
font, glowing orange. Bottom-right corner cell: a tiny bright green dot (terminal cursor). 
The outer edge of the icon has a thick, sharp orange square border. 
Ultra-sharp vector-like rendering, no gradients, no shadows, no noise. 
Pure geometric. The style is like a high-end macOS app icon — flat, bold, iconic.
1024x1024, square format, PNG quality."""

OG_PROMPT = """A dark horizontal banner for a developer app called "CodeGrid" — a terminal 
workspace manager for AI-assisted coding. 
Background: deep matte black (#0a0a0a) with a very subtle 3x3 grid texture of thin dark-gray 
(#1a1a1a) lines. 
Left side: the bold wordmark "CODEGRID" in JetBrains Mono, bright orange (#FF8C00), 
all caps, large, glowing slightly. Below it a tagline in small monospace gray text: 
"Terminal workspace manager for AI coding". 
Right side: an abstract representation of a 2x3 grid of terminal windows, each glowing 
orange and green with faint code text, arranged in a CodeGrid layout. 
Top-right: a small orange square logo mark with "CG" inside. 
1200x630 pixels wide format. 
Clean, modern, developer aesthetic. Very high quality, ultra-sharp."""

def download(url: str, path: Path):
    print(f"  Downloading → {path.name}")
    urllib.request.urlretrieve(url, path)

def generate(prompt: str, width: int, height: int, filename: str, out_dir: Path):
    print(f"\nGenerating: {filename} ({width}x{height})")
    result = fal_client.subscribe(
        "fal-ai/flux/dev",
        arguments={
            "prompt": prompt,
            "image_size": {"width": width, "height": height},
            "num_inference_steps": 50,
            "guidance_scale": 7.5,
            "num_images": 1,
            "output_format": "png",
            "enable_safety_checker": False,
        },
        with_logs=True,
        on_queue_update=lambda u: print(f"  [{u.status}]") if hasattr(u, "status") else None,
    )
    url = result["images"][0]["url"]
    download(url, out_dir / filename)
    print(f"  ✓ Saved to {out_dir / filename}")
    return out_dir / filename

if __name__ == "__main__":
    print("=== CodeGrid Logo Generator ===")
    icon_path = generate(ICON_PROMPT, 1024, 1024, "icon_raw.png", OUTPUT_DIR)
    og_path = generate(OG_PROMPT, 1200, 630, "og_image_raw.png", OG_DIR)
    print(f"\n✓ Icon → {icon_path}")
    print(f"✓ OG   → {og_path}")
