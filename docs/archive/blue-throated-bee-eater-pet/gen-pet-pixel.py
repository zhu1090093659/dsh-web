#!/usr/bin/env python3
"""
Blue-throated Bee-eater pet sprite generator (dsh-pet contribution) — pixel-art
pipeline (final route, repository-original, Apache-2.0).

The pet is drawn procedurally on a 64x68 logical pixel grid at 3x integer
scale (192x204, 2 px margins inside the 192x208 hatch-pet cell), with an
18-color palette derived from the blue-throated-bee-eater skin tokens. Every
figure part is a hand-authored pixel map (body with cream belly, head with
crown / mask / 2x2 eye and pitch variants, folded and raised wings, azure
tail streamers, twig perch, frontal and flight figures); animation articulates
parts by 1 px-level offsets (breath, head tilt/droop/raise, eye states, wing
beats, tail sway, single-sprite arc hop).

Outline pass: consistent 1 px ink outline where a part meets transparency;
eye glints are painted last.

Outputs: 8-column x 9-row atlas (rows idle / running-right / running-left /
waving / jumping / failed / waiting / running / review; frames
[6, 8, 8, 4, 5, 8, 6, 6, 6]) with 192x208 cells, plus per-track animated
preview GIFs. The superseded AI-illustration route is archived as
gen-pet-ai.py.

Re-run: python3 docs/archive/blue-throated-bee-eater-pet/gen-pet.py
"""

import os
from PIL import Image, ImageDraw, ImageFont

SS = 3  # integer pixel scale
CW, CH = 192, 208
GW, GH = 64, 68   # logical grid
LOY = (CH - GH * SS) // 2
COLUMNS = 8
ROWS = 9
BASE = os.path.dirname(os.path.abspath(__file__))

PAL = {
    'k': (12, 32, 41),        # ink outline #0c2029
    'c': (204, 136, 80),      # crown light #cc8850
    'C': (178, 106, 59),      # crown / iris #b26a3b
    'D': (143, 79, 43),       # crown dark #8f4f2b
    't': (92, 184, 165),      # teal light #5cb8a5
    'T': (63, 160, 143),      # teal #3fa08f
    'u': (46, 125, 111),      # teal dark #2e7d70
    'v': (70, 160, 141),      # covert mid #46a08d
    'a': (127, 196, 242),     # azure pale #7fc4f2
    'b': (65, 163, 232),      # azure light #41a3e8
    'A': (43, 135, 216),      # azure #2b87d8
    'd': (28, 108, 176),      # azure deep #1c6cb0
    'w': (244, 249, 251),     # cream #f4f9fb
    'W': (215, 233, 240),     # cream shade #d7e9f0
    'e': (255, 255, 255),     # eye white
    'g': (138, 153, 166),     # legs #8a99a6
    'B': (150, 96, 47),       # branch #96602f
    'L': (90, 160, 107),      # leaf #5aa06b
}
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

# --- pixel maps (hand-authored; palette chars) --------------------------------

BODY = [
    "....TTTTT......",
    "...TTTTTTTT....",
    "..TTTTTttTT....",
    ".uuTTTTwwwwT...",
    ".uuTTwwwwwwT...",
    ".uuTTwwwwww....",
    ".uuTTwwwwww....",
    ".uuTTwwwww.....",
    "..uTTwwww......",
    "..uTTttwww.....",
    "..uTTtttt......",
    "...TTTT........",
    "...TTT.........",
    "....TT.........",
    "....gg.........",
    "....gg.........",
]

HEAD_N = [
    "...cccccc.......",
    "..ccCCCCk.......",
    "..ccCCCk........",
    "..ccCCk.........",
    "..ttTTk.........",
    ".kkkkkkkkkkk....",
    ".kkwwCkwkkkk....",
    ".kkkkkkkkkkk....",
    "..TTTTTAk.......",
    "..AAwAAk........",
    "..AAwAk.........",
    "...TTk..........",
    "...TT...........",
]

HEAD_UP = [
    "...cccccc.....",
    "..ccCCCCk.....",
    "..ccCCCk..k...",
    "..ccCCk..kk...",
    "..ttTTk..kk...",
    ".kkkkkkk..k...",
    ".kwwCkck......",
    ".kkkkkkk......",
    "..TTTTTAk.....",
    "..AAwAAk......",
    "..AAwA........",
    "...TT.........",
    "...TT.........",
]

HEAD_DOWN = [
    "...cccccc....",
    "..ccCCCCk....",
    "..ccCCCk.....",
    "..ccCCk......",
    "..ttTTk......",
    ".kkkkkkkk....",
    ".kwwCkck.....",
    ".kkkkkkkk....",
    "..TTTTTk.....",
    "..AAwAAk.....",
    "...AAwA......",
    "....kTT......",
    "..kk.TT......",
    ".kkk.........",
]

HEAD_BEAK_UP = [
    "...k....",
    "..kk....",
    "..kk....",
    "...k....",
    "....k...",
]

HEAD_BEAK_DOWN = [
    ".....k.",
    "....kk.",
    "...kk..",
    "..kk...",
    ".kk....",
]

TAIL = [
    "...AAAAAAAA.",
    "...AAAAAAAAA",
    "....bbbbbbbA",
    ".....bbbbbbb",
    "......aabbbb",
    "........aabb",
    "..........aa",
    "...........a",
    "..........a.",
    "..........a.",
    "...........a",
]

WING_FOLD = [
    "..vvvvv....",
    ".vvvvvvv...",
    ".vTTTTTv...",
    ".vTTTTTv...",
    "..vTTTv....",
    "..vvvvv....",
    ".bbAAAa....",
    ".bbAAAa....",
    "..bbAAA....",
    "..bbAA.....",
    "...bbd.....",
    "....bd.....",
]

WING_UP = [
    ".............",
    ".........vv..",
    "......vvvbb..",
    "...vvvvvAAa..",
    ".vvvvAAAa....",
    "vvvAAbb......",
    "AAbbAA.......",
    "bbAA.........",
    "AAa..........",
    "ab...........",
]

WING_FRONT_L = [
    "..........",
    "........v.",
    ".......vv.",
    "......vvv.",
    ".....vvbb.",
    "....vvbAA.",
    "...vbAAa..",
    "..vbAA....",
    ".vbAA.....",
    "vAA.......",
    "AA........",
]

FRONT = [
    "......TTTTTT......",
    "....TTTTTTTTTT....",
    "...TTTTTTTTTTTT...",
    "...uTTTTwwwwTTT...",
    "..uuTTwwwwwwwTT...",
    "..uuTTwwwwwwwwT...",
    "..uuTTwwwwwwww....",
    "..uTTTwwwwwww.....",
    "..uTTwWWWWWWW.....",
    "..uTTwWWWWWWW.....",
    "...TTWwwWWWWW.....",
    "...TTWWWWWWW......",
    "....TWWWWWW.......",
    "....ggWWWW........",
    "....gg............",
]

FLY_BODY = [
    ".........TTT.........",
    ".......TTTTTTT.......",
    ".....TTTTTTTTTT......",
    "....uTTTTTwwwwTTT....",
    "...uTTTwwwwwwwTT....",
    "...uTTwwwwwwww......",
    "...uTTwwwwwwww......",
    "....TTwwwwwww.......",
    "....TTtttwww........",
    "....TTttttt.........",
    ".....TTtttt.........",
    ".....ggTT...........",
    "......gg............",
]

FLY_TAIL = [
    ".................A",
    ".................A",
    "..........AAAAAAA",
    ".......AAAAAAAAA",
    "....bbbbbbbbAAA",
    "..bbbbbbbbAAAd",
    ".aabbbbbAAAA",
    "..aabbbbbAAb",
    "....aabbbbbA",
    "........aabb",
]

BRANCH = [
    ".....LL..............LL....",
    "....LLLL............LLLL...",
    "..BBBBBBBBBBBBBBBBBBBBBB....",
    ".BBBBBBBBBBBBBBBBBBBBBBBB...",
    "..BBBBBBBBBBBBBBBBBBBBBBB...",
]

EYE_N = [
    "ww",
    "wk",
]
EYE_GLINT = [
    ("e", 9, 5),
]


def blank():
    return [['.' for _ in range(GW)] for _ in range(GH)]


def paste_map(g, data, ox, oy, dx=0, dy=0, mirror=False):
    for y, row in enumerate(data):
        rev = row[::-1] if mirror else row
        for x, ch in enumerate(rev):
            if ch != '.':
                px, py = ox + x + dx, oy + y + dy
                if 0 <= px < GW and 0 <= py < GH:
                    g[py][px] = ch


def outline(g):
    marks = []
    for y in range(GH):
        for x in range(GW):
            ch = g[y][x]
            if ch == '.' or ch == 'k':
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= GW or ny >= GH or g[ny][nx] == '.':
                    marks.append((x, y))
                    break
    for x, y in marks:
        g[y][x] = 'k'


def render_cell(g):
    img = Image.new('RGBA', (GW, GH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(GH):
        for x in range(GW):
            ch = g[y][x]
            if ch != '.':
                d.point((x, y), PAL[ch])
    img = img.resize((GW * SS, GH * SS), Image.NEAREST)
    cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    cell.paste(img, (0, LOY))
    return cell


def head_frame(grid, head, hx, hy, eye='open'):
    paste_map(grid, head, hx, hy)
    # eye overlay (2x2)
    ex, ey = hx + 6, hy + 6
    for yy, row in enumerate(EYE_N):
        for xx, ch in enumerate(row):
            if eye == 'open':
                grid[ey + yy][ex + xx] = ch
            elif eye == 'blink':
                grid[ey + yy][ex + xx] = 'k'
            elif eye == 'sad':
                grid[ey + yy][ex + xx] = 'C' if yy == 0 else 'D'
    if eye == 'open':
        grid[ey][ex] = 'e'
        grid[ey][ex + 1] = 'C'
        grid[ey + 1][ex] = 'e'
        grid[ey + 1][ex + 1] = 'k'


def compose_perch(frame):
    g = blank()
    breath = frame.get('breath', 0)
    sway = frame.get('tail_sway', 0)
    crouch = frame.get('crouch', 0)
    dy = frame.get('dy', 0)
    # tail behind branch
    paste_map(g, TAIL, 10, 46 - (dy * 0), sway, dy)
    paste_map(g, BRANCH, 4, 56, dy=0)
    # legs
    rect = None
    for x in (27, 31):
        g[55 + dy][x] = 'g'
        g[54 + dy][x] = 'g'
    g[56][(27, 31)[0]] = 'k'
    g[56][31] = 'k'
    # body
    paste_map(g, BODY, 24, 40 - (dy or 0) - breath + crouch, dy=dy - breath + crouch)
    # folded / raised wing
    if frame.get('wing') == 'wave':
        raise_amp = frame.get('wing_angle', 0)
        paste_map(g, WING_UP, 34, 36 - raise_amp - dy, dy=dy)
        paste_map(g, WING_FOLD, 26, 38 + dy)
    else:
        paste_map(g, WING_FOLD, 25, 38 + dy - breath + frame.get('droop', 0))
    # head
    pitch = frame.get('pitch', 0)
    head = HEAD_UP if pitch > 0 else (HEAD_DOWN if pitch < 0 else HEAD_N)
    hx = 28
    hy = 26 + frame.get('head_dy', 0) + dy - breath
    head_frame(g, head, hx, hy, eye=frame.get('eye', 'open'))
    return g


def compose_fly(frame):
    g = blank()
    dy = frame.get('dy', 0)
    beat = frame.get('beat', 0)
    paste_map(g, FLY_TAIL, 7, 36 + dy)
    paste_map(g, FLY_BODY, 24, 30 + dy)
    paste_map(g, WING_FOLD, 24, 28 + dy)
    # two raised wings above the shoulders; beat raises them
    paste_map(g, WING_UP, 18, 23 + dy - beat * 2)
    paste_map(g, WING_UP, 34, 23 + dy - beat * 2, mirror=True)
    # head (forward-right)
    paste_map(g, HEAD_N, 38, 24 + dy)
    return g


def compose_front(frame):
    g = blank()
    dy = frame.get('dy', 0)
    beat = frame.get('beat', 0)
    paste_map(g, FRONT, 12, 26 + dy)
    paste_map(g, WING_FRONT_L, 2, 27 + dy - beat * 2)
    paste_map(g, WING_FRONT_L, 50, 27 + dy - beat * 2, mirror=True)
    # head front
    paste_map(g, HEAD_N, 25, 15 + dy)
    return g


def track_frames(mode, i):
    if mode == 'idle':
        f = {'mode': mode, 'breath': [0, 1, 0, 1, 0, 0][i],
             'tail_sway': [0, 1, 0, -1, 0, 0][i],
             'eye': 'blink' if i == 3 else 'open'}
    elif mode in ('running-right', 'running-left'):
        f = {'mode': mode, 'beat': [0, 1, 0, 2, 0, 1, 0, 2][i],
             'dy': [0, -1, 0, 1, 0, -1, 0, 1][i]}
    elif mode == 'waving':
        f = {'mode': mode, 'wing': 'wave', 'wing_angle': [2, 0, 3, 0][i],
             'breath': [1, 0, 1, 0][i]}
    elif mode == 'jumping':
        f = {'mode': mode, 'dy': [0, -3, -6, -3, 0][i],
             'crouch': [1, 0, 0, 0, 1][i],
             'wing': ('wave' if i in (2, 3) else 'folded')}
    elif mode == 'failed':
        f = {'mode': mode, 'pitch': -1, 'head_dy': [2, 3, 2, 3, 2, 3, 2, 3][i],
             'droop': [1, 2, 1, 2, 1, 2, 1, 2][i],
             'eye': 'sad', 'tail_sway': 0}
    elif mode == 'waiting':
        f = {'mode': mode, 'head_dy': [1, 0, 1, 0, 1, 0][i],
             'breath': [0, 1, 0, 1, 0, 0][i],
             'eye': 'blink' if i == 3 else 'open'}
    elif mode == 'running':
        f = {'mode': mode, 'beat': [0, 1, 0, 1, 0, 1][i],
             'dy': [0, -1, 0, 1, 0, -1][i]}
    elif mode == 'review':
        f = {'mode': mode, 'pitch': 1, 'head_dy': [-2, -2, -3, -2, -2, -3][i],
             'breath': [0, 1, 0, 1, 0, 0][i]}
    else:
        raise ValueError(mode)
    if mode in ('running-right', 'running-left'):
        g = compose_fly(f)
        cell = render_cell(g)
        return cell.transpose(Image.FLIP_LEFT_RIGHT) if mode == 'running-left' else cell
    if mode == 'running':
        return render_cell(compose_front(f))
    return render_cell(compose_perch(f))


def build_frames():
    return {
        name: [track_frames(name, i) for i in range(n)]
        for name, n in TRACKS
    }


def build_atlas(frames):
    atlas = Image.new('RGBA', (CW * COLUMNS, CH * ROWS), (0, 0, 0, 0))
    for row, (name, n) in enumerate(TRACKS):
        for col in range(n):
            atlas.paste(frames[name][col], (col * CW, row * CH))
    return atlas


def save_gif(frames, name, path):
    pal = [f.convert('P', palette=Image.Palette.ADAPTIVE, colors=128) for f in frames]
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
            cell = frames[name][col].resize((CW * scale, CH * scale), Image.NEAREST)
            sheet.paste(cell, (pad + col * CW * scale, y + lh), cell)
    return sheet


def main():
    out_dir = os.path.normpath(os.path.join(BASE, '..', '..', '..', 'packages', 'dsh-pet', 'assets', 'blue-throated-bee-eater'))
    frames = build_frames()
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
