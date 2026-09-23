#!/usr/bin/env python3
"""
Blue-throated Bee-eater pet sprite generator (dsh-pet contribution) — v3 (AI route, ARCHIVED).

Superseded: the shipped assets are drawn by the pixel-art pipeline in gen-pet.py
(2026-09-07 review: the AI-illustration route was kept as a reviewed alternative;
sources ref-01..ref-08 remain part of the provenance record but are no longer
referenced by the shipped generator). This file is frozen for traceability.

Source-art composition pipeline. The animal art is a set of AI-generated
reference illustrations (see ./source/*.png, contributed by the repository
contributor with a declared license on record; not repository-authored),
already delivered as transparent-background RGBA portraits:

  ref-01  perched side view on a twig
  ref-02  flying side view, wings raised in a V
  ref-03  frontal hover, wings spread
  ref-04  perched side view, near wing partially raised (waving)

This generator keys nothing (sources are already transparent), fits each
sprite into the hatch-pet 8-column x 9-row atlas contract (192x208 cells,
row order idle / running-right / running-left / waving / jumping / failed /
waiting / running / review, frames [6, 8, 8, 4, 5, 8, 6, 6, 6]) and derives
the nine animation tracks with paper-doll transforms (breath, beat, sway,
tilt, droop, hop and mirroring), 4x supersampled and LANCZOS downscaled.

Outputs:
  packages/dsh-pet/assets/blue-throated-bee-eater/
    spritesheet.webp  1536x1872 lossless webp atlas
    previews/<track>.gif  one animated preview per track (192x208)
  docs/archive/blue-throated-bee-eater-pet/contact-sheet.png

Re-run: python3 docs/archive/blue-throated-bee-eater-pet/gen-pet.py
"""

import math
import os
from PIL import Image, ImageDraw, ImageFont

SS = 4  # supersample factor
CW, CH = 192, 208
COLUMNS = 8
ROWS = 9
BASE = os.path.dirname(os.path.abspath(__file__))

TRACKS = [
    ("idle", 6),
    ("running-right", 8),
    ("running-left", 8),
    ("waving", 4),
    ("jumping", 5),
    ("failed", 8),
    ("waiting", 6),
    ("running", 6),
    ("review", 6),
]

DURATIONS = {
    "idle": [500, 500, 600, 500, 500, 600],
    "running-right": [300, 300, 300, 300, 300, 300, 300, 400],
    "running-left": [300, 300, 300, 300, 300, 300, 300, 400],
    "waving": [450, 450, 450, 450],
    "jumping": [400, 400, 400, 450, 450],
    "failed": [550, 550, 550, 600, 650, 700, 550, 550],
    "waiting": [550, 550, 600, 550, 550, 600],
    "running": [330, 330, 330, 330, 330, 400],
    "review": [650, 650, 650, 650, 650, 650],
}

# --- sprite preparation -------------------------------------------------------

def strip_ghost(im, region, sat_max=0.22, feather=36):
    """Zero-way out low-saturation pixels inside a polygon region (the pale
    'ghost wing' overlapping the waving reference). Returns a copy."""
    from PIL import ImageFilter
    w, h = im.size
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(region, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    pix = im.load()
    mpix = mask.load()
    out = im.copy()
    opix = out.load()
    for y in range(h):
        for x in range(w):
            if mpix[x, y] > 0:
                r, g, b, a = pix[x, y]
                mx, mn = max(r, g, b), min(r, g, b)
                sat = 0.0 if mx == 0 else (mx - mn) / mx
                if sat < sat_max and mx > 80:
                    opix[x, y] = (r, g, b, 0)
    return out


def load_sprite(name, fit_h, anchor, cx=96.0, cy=None, max_w=190.0,
                region=None, strip_ghost_sat=0.0):
    """Load, bbox-trim, scale to fit_h (1x), return RGBA + anchor point."""
    im = Image.open(os.path.join(BASE, 'source', name)).convert('RGBA')
    if region is not None:
        im = strip_ghost(im, region, sat_max=strip_ghost_sat)
    bbox = im.getbbox()
    im = im.crop(bbox)
    scale = min(fit_h / im.height, max_w / im.width)
    if scale != 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    cy = cy if cy is not None else im.height / 2
    return im, (cx, cy)


def make_canvas():
    return Image.new('RGBA', (CW * SS, CH * SS), (0, 0, 0, 0))


def paste_sprite(canvas, sprite, anchor, scale=1.0, rot=0.0, dx=0.0, dy=0.0):
    """Paper-doll transform: rotate/scale about the sprite anchor, then paste
    so the anchor lands at cell position (anchor.x + dx, anchor.y + dy).
    The sprite is supersampled so the final downscale stays crisp."""
    ax, ay = anchor
    ring_img = sprite.rotate(rot, resample=Image.BICUBIC, expand=True, center=(ax, ay))
    if scale != 1.0:
        rw, rh = ring_img.size
        img = ring_img.resize((round(rw * scale), round(rh * scale)), Image.LANCZOS)
        nax, nay = ax * scale, ay * scale
    else:
        img = ring_img
        nax, nay = ax, ay
    step = SS
    img = img.resize((img.width * step, img.height * step), Image.LANCZOS)
    px = round((anchor[0] + dx - nax) * step)
    py = round((anchor[1] + dy - nay) * step)
    canvas.alpha_composite(img, (px, py))


def render_cell(sprite, anchor, scale=1.0, rot=0.0, dx=0.0, dy=0.0, mirror=False):
    canvas = make_canvas()
    paste_sprite(canvas, sprite, anchor, scale, rot, dx, dy)
    cell = canvas.resize((CW, CH), Image.LANCZOS)
    return cell.transpose(Image.FLIP_LEFT_RIGHT) if mirror else cell


# --- sprite set --------------------------------------------------------------

def build_sprites():
    perched, _ = load_sprite('ref-01.png', 188, 'bottom', cy=None)
    perched_anchor = (96.0, 200.0)  # branch base sits near the cell bottom
    # ref-04 carries a pale ghost wing overlapping the lower-left; erase it
    # with a saturation key inside that region
    wave, _ = load_sprite('ref-04.png', 188, 'bottom', cy=None,
                          region=[(0, 240), (420, 240), (420, 1484), (0, 1484)],
                          strip_ghost_sat=0.24)
    wave_anchor = (96.0, 200.0)
    droop, _ = load_sprite('ref-06-droop.png', 186, 'bottom', cy=None)
    droop_anchor = (96.0, 200.0)
    tilt, _ = load_sprite('ref-07-tilt.png', 186, 'bottom', cy=None)
    tilt_anchor = (96.0, 200.0)
    reviewp, _ = load_sprite('ref-08-review.png', 186, 'bottom', cy=None)
    review_anchor = (96.0, 200.0)
    crouch, _ = load_sprite('ref-05-crouch.png', 178, 'bottom', cy=None)
    crouch_anchor = (96.0, 200.0)
    flying, _ = load_sprite('ref-02.png', 172, 'center', cy=96.0)
    front, _ = load_sprite('ref-03.png', 178, 'center', cy=100.0)
    takeoff, _ = load_sprite('ref-09-takeoff.png', 186, 'center', cy=100.0)
    hop, _ = load_sprite('ref-10-hop.png', 184, 'center', cy=104.0)
    blink, _ = load_sprite('ref-11-blink.png', 188, 'bottom', cy=None)
    blink_anchor = (96.0, 200.0)
    blink_front, _ = load_sprite('ref-12-blink-front.png', 178, 'center', cy=100.0)
    blink_front_anchor = (96.0, 104.0)
    return {
        'perched': (perched, perched_anchor),
        'wave': (wave, wave_anchor),
        'crouch': (crouch, crouch_anchor),
        'droop': (droop, droop_anchor),
        'tilt': (tilt, tilt_anchor),
        'review': (reviewp, review_anchor),
        'flying': (flying, (96.0, 96.0)),
        'front': (front, (96.0, 104.0)),
        'takeoff': (takeoff, (96.0, 104.0)),
        'hop': (hop, (96.0, 112.0)),
        'blink': (blink, blink_anchor),
        'blink-front': (blink_front, blink_front_anchor),
    }


# --- track choreography (paper-doll transforms) ------------------------------

def track_frames(sprites, mode, i):
    perch, pa = sprites['perched']
    if mode == 'idle':
        sc = [1.0, 1.022, 1.010, 1.018, 1.010, 1.0][i]
        ro = [0.0, -1.2, 0.0, 1.2, 0.0, 0.0][i]
        dy = [0, -1, 0, -1, 0, 0][i]
        return render_cell(perch, pa, scale=sc, rot=ro, dy=dy)
    if mode == 'running-right':
        fly, fa = sprites['flying']
        sc = [0.97, 0.94, 0.96, 1.0, 1.04, 1.06, 1.04, 1.0][i]
        ro = [-3, -1.5, 0, 1.5, 3, 1.5, 0, -1.5][i]
        dy = [0, 2, 2, 0, -2, -2, 0, 0][i]
        return render_cell(fly, fa, scale=sc, rot=ro, dy=dy)
    if mode == 'running-left':
        fly, fa = sprites['flying']
        sc = [0.97, 0.94, 0.96, 1.0, 1.04, 1.06, 1.04, 1.0][i]
        ro = [-3, -1.5, 0, 1.5, 3, 1.5, 0, -1.5][i]
        dy = [0, 2, 2, 0, -2, -2, 0, 0][i]
        return render_cell(fly, fa, scale=sc, rot=ro, dy=dy, mirror=True)
    if mode == 'waving':
        wave, wa = sprites['wave']
        sc = [1.0, 1.012, 1.0, 1.012][i]
        ro = [1.5, -1.5, 1.8, -1.6][i]
        return render_cell(wave, wa, scale=sc, rot=ro)
    if mode == 'jumping':
        # landing (played on the done phase): cruise high -> descend ->
        # flare wings wide -> touchdown on the branch -> settle. Story order
        # matches gravity; the branch appears in the art as the bird closes in.
        fly, fa = sprites['flying']
        flare, ra = sprites['takeoff']
        touch, ta = sprites['hop']
        if i == 0:
            return render_cell(fly, fa, scale=1.02, rot=-8, dy=-16)
        if i == 1:
            return render_cell(fly, fa, scale=1.02, rot=-5, dy=-8)
        if i == 2:
            return render_cell(flare, ra, scale=1.02, rot=-3, dy=-2)
        if i == 3:
            return render_cell(touch, ta, scale=1.0, rot=0, dy=1)
        return render_cell(touch, ta, scale=0.99, rot=1, dy=2)
    if mode == 'failed':
        droop, da = sprites['droop']
        sc = [0.995, 1.0, 0.995, 0.99, 1.0, 0.995, 1.0, 0.99][i]
        ro = [0.8, 1.2, 0.8, 1.4, 0.8, 1.2, 0.8, 1.4][i]
        dy = [0, 1, 0, 1, 0, 1, 0, 1][i]
        return render_cell(droop, da, scale=sc, rot=ro, dy=dy)
    if mode == 'waiting':
        tilt, ta = sprites['tilt']
        blink, ba = sprites['blink']
        ro = [0.8, -0.8, 1.2, -1.2, 0.8, -0.8][i]
        sc = [1.0, 1.008, 1.0, 1.008, 1.0, 1.006][i]
        if i == 3:
            return render_cell(blink, ba, scale=sc, rot=ro)
        return render_cell(tilt, ta, scale=sc, rot=ro)
    if mode == 'running':
        front, fa = sprites['front']
        sc = [0.97, 1.0, 0.97, 1.0, 0.97, 1.0][i]
        ro = [0, 1.2, 0, -1.2, 0, 1.2][i]
        dy = [0, -1, 0, 1, 0, -1][i]
        return render_cell(front, fa, scale=sc, rot=ro, dy=dy)
    if mode == 'review':
        review, ra = sprites['review']
        ro = [0.6, -0.6, 0.9, -0.9, 0.6, -0.6][i]
        sc = [1.0, 1.008, 1.0, 1.008, 1.0, 1.006][i]
        return render_cell(review, ra, scale=sc, rot=ro)
    raise ValueError(mode)


def build_frames(sprites):
    return {
        name: [track_frames(sprites, name, i) for i in range(n)]
        for name, n in TRACKS
    }


def build_atlas(frames):
    atlas = Image.new('RGBA', (CW * COLUMNS, CH * ROWS), (0, 0, 0, 0))
    for row, (name, n) in enumerate(TRACKS):
        for col in range(n):
            atlas.paste(frames[name][col], (col * CW, row * CH))
    return atlas


def save_gif(frames, name, path):
    pal = [f.convert('P', palette=Image.Palette.ADAPTIVE, colors=192, dither=Image.Dither.FLOYDSTEINBERG)
           for f in frames]
    pal[0].save(path, save_all=True, append_images=pal[1:],
                duration=DURATIONS[name], loop=0, optimize=True, disposal=2)


def build_contact(frames):
    scale = 2
    pad = 10
    lh = 34
    w = CW * scale * 8 + pad
    h = (CH * scale + lh) * ROWS + pad
    sheet = Image.new('RGBA', (w, h), (245, 250, 252, 255))
    d = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=22)
    for row, (name, n) in enumerate(TRACKS):
        y = pad + row * (CH * scale + lh)
        d.text((pad, y + 4), name, fill=(8, 30, 40, 255), font=font)
        for col in range(n):
            cell = frames[name][col].resize((CW * scale, CH * scale), Image.LANCZOS)
            sheet.paste(cell, (pad + col * CW * scale, y + lh), cell)
    return sheet


def main():
    out_dir = os.path.normpath(os.path.join(BASE, '..', '..', '..', 'packages', 'dsh-pet', 'assets', 'blue-throated-bee-eater'))
    sprites = build_sprites()
    frames = build_frames(sprites)
    atlas = build_atlas(frames)
    os.makedirs(os.path.join(out_dir, 'previews'), exist_ok=True)
    atlas.save(os.path.join(out_dir, 'spritesheet.webp'), format='WEBP', lossless=True, quality=100, method=6)
    for name, _ in TRACKS:
        save_gif(frames[name], name, os.path.join(out_dir, 'previews', f'{name}.gif'))
    sheet = build_contact(frames)
    sheet.save(os.path.join(BASE, 'contact-sheet.png'))
    print('wrote', out_dir)
    for name, _ in TRACKS:
        g = os.path.join(out_dir, 'previews', f'{name}.gif')
        print(name, '->', os.path.getsize(g), 'bytes')
    print('spritesheet', os.path.getsize(os.path.join(out_dir, 'spritesheet.webp')), 'bytes')


if __name__ == '__main__':
    main()
