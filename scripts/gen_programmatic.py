#!/usr/bin/env python3
"""
Generate CodeGrid icon and OG image programmatically with Pillow.
Icon: bold "CG" monogram centered with lots of breathing room — looks great after squircle mask.
OG:   clean dark text-first design — wordmark + orange accent lines, nothing else.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, subprocess, struct, shutil, io

CANDIDATES = Path(__file__).parent.parent / "src-tauri" / "icons" / "candidates"
FINAL      = Path(__file__).parent.parent / "src-tauri" / "icons" / "final"
ICONS      = Path(__file__).parent.parent / "src-tauri" / "icons"
PUBLIC     = Path(__file__).parent.parent / "public"
for p in (CANDIDATES, FINAL, PUBLIC):
    p.mkdir(parents=True, exist_ok=True)

BG       = (10,  10,  10,  255)
ORANGE   = (255, 140, 0,   255)
ORANGE_D = (180, 98,  0,   255)   # darker orange for accent
GREEN    = (0,   200, 83,  255)
GRAY     = (80,  80,  80,  255)
DARKGRAY = (22,  22,  22,  255)
WHITE    = (255, 255, 255, 255)

def find_font(size, bold=True):
    bold_candidates = [
        "/Library/Fonts/JetBrainsMono-ExtraBold.ttf",
        "/Library/Fonts/JetBrainsMono-Bold.ttf",
        "/Library/Fonts/JetBrainsMonoNL-Bold.ttf",
        os.path.expanduser("~/Library/Fonts/JetBrainsMono-Bold.ttf"),
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Menlo.ttc",
    ]
    reg_candidates = [
        "/Library/Fonts/JetBrainsMono-Regular.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Monaco.ttf",
    ]
    for p in (bold_candidates if bold else reg_candidates):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


# ═══════════════════════════════════════════════════════════════════════════════
# APP ICON  — bold "CG" monogram, centered with ~20% padding on all sides
# The squircle mask will clip corners cleanly because the design lives in the center
# ═══════════════════════════════════════════════════════════════════════════════
def make_icon(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    # Solid black background (corners will be masked by squircle later)
    d.rectangle([0, 0, size, size], fill=BG)

    cx = size // 2
    cy = size // 2

    # Large bold "CG" — sized to fill ~60% of the icon width
    target_w = int(size * 0.60)
    font_size = int(size * 0.52)
    font = find_font(font_size)
    bbox = d.textbbox((0, 0), "CG", font=font)
    tw = bbox[2] - bbox[0]
    # Scale to hit target_w
    font_size = int(font_size * target_w / tw)
    font = find_font(font_size)
    bbox = d.textbbox((0, 0), "CG", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    tx = cx - tw // 2 - bbox[0]
    ty = cy - th // 2 - bbox[1] - int(size * 0.02)  # tiny optical lift

    # Subtle orange glow layer behind text
    for glow_r, glow_a in [(30, 18), (18, 30), (8, 50)]:
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gd   = ImageDraw.Draw(glow)
        gd.text((tx, ty), "CG", font=font, fill=(255, 140, 0, glow_a))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=glow_r))
        img  = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)

    # Main "CG" text
    d.text((tx, ty), "CG", font=font, fill=ORANGE)

    # Small green terminal-cursor dot below the letters
    dot_r  = int(size * 0.022)
    dot_cx = cx + tw // 2 + int(size * 0.01)
    dot_cy = ty + th + int(size * 0.018)
    d.ellipse([dot_cx - dot_r, dot_cy - dot_r,
               dot_cx + dot_r, dot_cy + dot_r], fill=GREEN)

    # Two thin orange horizontal rules — top and bottom accent lines
    line_y_top = int(size * 0.18)
    line_y_bot = int(size * 0.82)
    line_x0    = int(size * 0.18)
    line_x1    = int(size * 0.82)
    lw         = max(2, int(size * 0.006))
    d.line([(line_x0, line_y_top), (line_x1, line_y_top)], fill=ORANGE_D, width=lw)
    d.line([(line_x0, line_y_bot), (line_x1, line_y_bot)], fill=ORANGE_D, width=lw)

    return img


# ═══════════════════════════════════════════════════════════════════════════════
# OG IMAGE  1200×630 — clean, text-first
# Just the wordmark, tagline, and two orange accent lines. That's it.
# ═══════════════════════════════════════════════════════════════════════════════
def make_og(w=1200, h=630):
    img = Image.new("RGB", (w, h), BG[:3])
    d   = ImageDraw.Draw(img)

    cx = w // 2
    cy = h // 2

    # Two full-width horizontal orange rules
    rule_w = max(2, int(h * 0.007))
    rule_top = int(h * 0.22)
    rule_bot = int(h * 0.78)
    d.line([(0, rule_top), (w, rule_top)], fill=ORANGE,   width=rule_w)
    d.line([(0, rule_bot), (w, rule_bot)], fill=ORANGE_D, width=rule_w)

    # Wordmark "CODEGRID" — large, centered
    font_title = find_font(int(h * 0.22))
    title = "CODEGRID"
    bbox  = d.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = cx - tw // 2 - bbox[0]
    ty = cy - th // 2 - bbox[1] - int(h * 0.04)

    # Glow
    for glow_r, glow_a in [(40, 12), (20, 22), (8, 40)]:
        glow_layer = Image.new("RGB", (w, h), BG[:3])
        gd = ImageDraw.Draw(glow_layer)
        gd.text((tx, ty), title, font=font_title, fill=(255, 140, 0))
        glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=glow_r))
        # Blend: only the bright parts add
        import numpy as np
        base_arr = np.array(img, dtype=np.float32)
        glow_arr = np.array(glow_layer, dtype=np.float32)
        blended  = np.clip(base_arr + glow_arr * (glow_a / 255.0), 0, 255).astype(np.uint8)
        img = Image.fromarray(blended)
    d = ImageDraw.Draw(img)

    d.text((tx, ty), title, font=font_title, fill=ORANGE)

    # Tagline — small, centered, below wordmark
    font_tag = find_font(int(h * 0.055), bold=False)
    tagline  = "Terminal workspace manager for AI coding"
    tb       = d.textbbox((0, 0), tagline, font=font_tag)
    d.text((cx - (tb[2]-tb[0])//2 - tb[0],
            ty + th + int(h * 0.045)),
           tagline, font=font_tag, fill=GRAY)

    return img


# ── Generate ──────────────────────────────────────────────────────────────────
print("Generating icon...")
icon = make_icon(1024)
icon.save(CANDIDATES / "icon_programmatic.png", "PNG")
print("  ✓ icon (1024×1024 RGBA)")

print("Generating OG image...")
og = make_og(1200, 630)
og.save(CANDIDATES / "og_programmatic.png", "PNG")
print("  ✓ OG (1200×630 RGB)")

print("\nDone.")
