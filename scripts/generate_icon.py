#!/usr/bin/env python3
"""Render the Atlas app icon.

Design:
  - Solid deep-teal squircle background — picks up the Everforest hue family
    and gives the icon a single recognizable colour at small sizes.
  - Globe glyph drawn in a vertical green→aqua→blue gradient (Everforest
    accents). The gradient is applied to the strokes (not the background),
    matching the modern Apple/Material icon convention of "solid bg + bright
    accented glyph".
  - Globe geometry uses thin, properly-foreshortened latitude ellipses so
    the sphere reads correctly instead of looking puffed.

Renders at 1024×1024 then downsamples for the sizes Tauri needs on macOS
(32, 128, 256, 1024 PNGs + .icns).
"""
from pathlib import Path
from PIL import Image, ImageDraw

# Background — deep teal with a subtle "lit from upper-left" radial fall-off.
# BG_HI sits in the top-left, BG_LO bottom-right. Same trick CMUX/Compass use:
# the bg itself carries the lighting cue, then the globe (which sits on top
# in its own colour) reads as a 3D object resting on a curved surface.
BG_HI = (0x2a, 0x55, 0x5f)   # lit teal
BG_LO = (0x12, 0x2e, 0x36)   # shadowed teal

# Gradient stops for the globe strokes — diagonal "light from upper-left"
# look. The TL stop is a bright, slightly warm highlight; the BR stop is
# a deeper, cooler shadow tone. The midpoint stays inside the Everforest
# hue arc so the icon still ties back to the in-app palette.
HI  = (0xd8, 0xe6, 0xb4)   # warm pale highlight (TL — "lit" side)
MID = (0x83, 0xc0, 0x92)   # Everforest aqua
LO  = (0x4f, 0x82, 0x96)   # deep blue-teal shadow (BR — "unlit" side)

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
SIZE = 1024
# macOS squircle radius — Apple uses ~22.4% of side length.
RADIUS = int(SIZE * 0.224)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def squircle_mask(size: int, radius: int) -> Image.Image:
    """Anti-aliased rounded-rect mask, super-sampled then downscaled."""
    scale = 2
    big = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return big.resize((size, size), Image.LANCZOS)


def diagonal_gradient(size: int) -> Image.Image:
    """Top-left → mid → bottom-right gradient, simulating a light source
    in the upper-left. The parameter t advances along the TL→BR diagonal,
    so iso-colour bands run perpendicular to that diagonal."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    max_d = (size - 1) * 2  # x + y at bottom-right
    for y in range(size):
        for x in range(size):
            t = (x + y) / max_d
            if t < 0.5:
                px[x, y] = lerp(HI, MID, t * 2)
            else:
                px[x, y] = lerp(MID, LO, (t - 0.5) * 2)
    return img


def draw_globe_mask(size: int, cx: int, cy: int, diameter: int,
                    stroke: int) -> Image.Image:
    """Render the globe glyph into a grayscale alpha mask.

    Super-samples by 4× so every curve antialiases cleanly when downsampled
    to 32×32. The shape is composed of:
      - outer circle (sphere outline)
      - thin equator ellipse
      - two thin latitude ellipses at ±30°
      - vertical centre line (prime meridian)
      - two side meridians as narrow vertical ellipses
    """
    scale = 4
    s = diameter * scale
    st = stroke * scale
    g = Image.new("L", (size * scale, size * scale), 0)
    d = ImageDraw.Draw(g)

    # working-area bbox in super-sampled coords
    gx = cx * scale
    gy = cy * scale
    r = s // 2
    left, top, right, bot = gx - r, gy - r, gx + r, gy + r
    inset = st // 2
    bbox = (left + inset, top + inset, right - inset, bot - inset)

    # Outer sphere
    d.ellipse(bbox, outline=255, width=st)

    # Equator — very thin horizontal ellipse (sphere viewed front-on)
    eq_h = int(s * 0.015)
    d.ellipse((bbox[0], gy - eq_h, bbox[2], gy + eq_h),
              outline=255, width=st)

    # Two latitudes at ~±30°. y-offset = r·sin(30°) = 0.5r.
    # Width foreshortened by cos(30°) ≈ 0.866. Ellipse "height" is the
    # tilt of the latitude ring — thin to avoid puffing.
    import math
    for sign in (-1, 1):
        lat_y = gy + sign * int(r * math.sin(math.radians(30)))
        lat_w = int(r * math.cos(math.radians(30)))
        lat_h = int(s * 0.012)
        d.ellipse(
            (gx - lat_w, lat_y - lat_h, gx + lat_w, lat_y + lat_h),
            outline=255, width=st,
        )

    # Prime meridian — straight vertical chord through centre
    d.line((gx, bbox[1], gx, bbox[3]), fill=255, width=st)

    # Two side meridians at ±60° rotation — narrow vertical ellipses
    for w_ratio in (0.35, 0.70):
        e_w = int(w_ratio * r)
        d.ellipse(
            (gx - e_w, bbox[1], gx + e_w, bbox[3]),
            outline=255, width=st,
        )

    return g.resize((size, size), Image.LANCZOS)


def background_with_shadow(size: int) -> Image.Image:
    """Squircle background with a soft radial gradient — light source
    upper-left. Distance is measured from (0,0); the lower-right corner
    sits in shadow. An ease-out curve makes the highlight read as a soft
    pool rather than a hard streak."""
    import math
    img = Image.new("RGB", (size, size))
    px = img.load()
    max_d = math.hypot(size - 1, size - 1)
    for y in range(size):
        for x in range(size):
            t = (math.hypot(x, y) / max_d) ** 0.85
            px[x, y] = lerp(BG_HI, BG_LO, t)
    return img


def render(size: int) -> Image.Image:
    radius = int(size * 0.224)

    # background: radial-lit teal, clipped to squircle
    bg = background_with_shadow(size).convert("RGBA")
    bg.putalpha(squircle_mask(size, radius))

    # globe scaled up to ~72% of the canvas (Apple-icon glyph proportion)
    cx = cy = size // 2
    diameter = int(size * 0.72)
    stroke = max(5, int(diameter * 0.055))
    glyph_mask = draw_globe_mask(size, cx, cy, diameter, stroke)

    glyph = diagonal_gradient(size).convert("RGBA")
    glyph.putalpha(glyph_mask)

    bg.alpha_composite(glyph)
    return bg


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Rendering master at {SIZE}×{SIZE}…")
    master = render(SIZE)

    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 1024,
    }
    for name, sz in sizes.items():
        img = master.resize((sz, sz), Image.LANCZOS) if sz != SIZE else master
        path = OUT / name
        img.save(path, "PNG", optimize=True)
        print(f"  → {path.name} ({sz}×{sz})")

    # .icns — build via iconutil from an .iconset directory
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as td:
        iconset = Path(td) / "Atlas.iconset"
        iconset.mkdir()
        icns_sizes = [
            ("icon_16x16.png", 16),
            ("icon_16x16@2x.png", 32),
            ("icon_32x32.png", 32),
            ("icon_32x32@2x.png", 64),
            ("icon_128x128.png", 128),
            ("icon_128x128@2x.png", 256),
            ("icon_256x256.png", 256),
            ("icon_256x256@2x.png", 512),
            ("icon_512x512.png", 512),
            ("icon_512x512@2x.png", 1024),
        ]
        for name, sz in icns_sizes:
            img = master.resize((sz, sz), Image.LANCZOS) if sz != SIZE else master
            img.save(iconset / name, "PNG")
        out_icns = OUT / "icon.icns"
        subprocess.run(["iconutil", "-c", "icns",
                        "-o", str(out_icns), str(iconset)], check=True)
        print(f"  → {out_icns.name}")
    print("Done.")


if __name__ == "__main__":
    main()
