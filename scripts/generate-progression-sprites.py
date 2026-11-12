#!/usr/bin/env python3
"""
generate-progression-sprites.py - draws the progression layer's props
(public/sprites/progression/) in Claude-Office's own sprite style: chunky
hi-bit pixel art, a one-pixel dark navy outline, three-tone cel shading lit
from the upper left, warm woods and brass to sit with the upstream desks,
counter and printer.

Two sources, both licence-clean (see docs/progression-credits.md):

  drawn here     trophy cabinet, mailbox (flag up / down), shipped bin, parcel,
                 window-box planter and its plants, lessons binder, dust sheets,
                 padlock - plain PIL polygons on an isometric 2:1 grid, no AA
  restyled CC0   Pixor library (pixor.art, CC0 1.0) trophy-small, medal, crown,
                 four-leaf clover, gem: one 32 px frame each, re-toned into
                 bronze / silver / gold / platinum where tiered, outlined in
                 the office navy, contrast lifted to match the upstream sprites

Every sprite is drawn on its art-pixel grid and saved at SCALE x with
nearest-neighbour, so it stays crisp; the page shows it at art size (1 art
pixel = 1 CSS pixel, the upstream furniture's own density). Re-run:

  python3 scripts/generate-progression-sprites.py [--pixor <dir of the Pixor packs>]
"""
import argparse, colorsys, glob, json, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'sprites', 'progression')
SCALE = 4
NAVY = (27, 31, 51, 255)        # the upstream outline
SHADOW = (0, 0, 0, 60)

def rgb(h, a=255):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

WOOD = [rgb('d39a5f'), rgb('b07a46'), rgb('86552f'), rgb('5c3820')]     # light, mid, dark, deep
BRASS = [rgb('fff0a8'), rgb('f2c94c'), rgb('c8922a'), rgb('8a5a17')]
STEEL = [rgb('eef2f7'), rgb('c3cbd6'), rgb('8d97a6'), rgb('5b6474')]
RED = [rgb('ff8a7a'), rgb('e5484d'), rgb('b0302f'), rgb('7a1d22')]
CARD = [rgb('f2d4a2'), rgb('d9b07a'), rgb('b38653'), rgb('7d5a35')]
CLOTH = [rgb('f4f1ea'), rgb('dcd6ca'), rgb('b9b1a3'), rgb('8f8778')]
TERRA = [rgb('e9a072'), rgb('c97a4b'), rgb('9c5733'), rgb('6b3a22')]
LEAF = [rgb('9be37a'), rgb('5cbf4f'), rgb('2f8f3d'), rgb('1d5e2c')]
NAVYBIND = [rgb('7f9cf5'), rgb('4c6ef5'), rgb('3049b8'), rgb('1f2f7a')]

# ---------------------------------------------------------------------------
# Canvas helpers
# ---------------------------------------------------------------------------

class Art:
    def __init__(self, w, h):
        self.im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)
        self.w, self.h = w, h
    def poly(self, pts, fill):
        self.d.polygon([(round(x), round(y)) for x, y in pts], fill=fill)
    def rect(self, x0, y0, x1, y1, fill):
        self.d.rectangle([x0, y0, x1, y1], fill=fill)
    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h: self.im.putpixel((int(x), int(y)), c)
    def line(self, pts, fill, width=1):
        self.d.line([(round(x), round(y)) for x, y in pts], fill=fill, width=width)

class Iso:
    """2:1 isometric: +x runs right-down, +y runs left-down, +z up."""
    def __init__(self, art, ox, oy):
        self.a, self.ox, self.oy = art, ox, oy
    def p(self, x, y, z):
        return (self.ox + (x - y), self.oy + (x + y) / 2 - z)
    def box(self, x0, y0, z0, dx, dy, dz, pal, faces='tlr'):
        """pal: (light, mid, dark): top, the +y face (front-left), the +x face (front-right)."""
        x1, y1, z1 = x0 + dx, y0 + dy, z0 + dz
        P = self.p
        if 'l' in faces: self.a.poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], pal[1])
        if 'r' in faces: self.a.poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], pal[2])
        if 't' in faces: self.a.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], pal[0])
    def face_y(self, x0, x1, z0, z1, y, fill):
        P = self.p; self.a.poly([P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)], fill)
    def face_x(self, y0, y1, z0, z1, x, fill):
        P = self.p; self.a.poly([P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)], fill)

def outline(im, color=NAVY):
    """A one-pixel navy outline around everything opaque (the upstream look), on a canvas one pixel larger each side."""
    w, h = im.size
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    out.paste(im, (1, 1), im)
    src = out.load()
    alpha = [[src[x, y][3] > 40 for y in range(h + 2)] for x in range(w + 2)]
    res = out.copy(); r = res.load()
    for x in range(w + 2):
        for y in range(h + 2):
            if alpha[x][y]: continue
            if any(0 <= x + dx < w + 2 and 0 <= y + dy < h + 2 and alpha[x + dx][y + dy] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                r[x, y] = color
    return res

def inner_edges(im, color=None, threshold=120):
    """Darken pixels where two strongly different fills meet (the internal line work upstream has)."""
    w, h = im.size
    src = im.load(); res = im.copy(); r = res.load()
    lum = lambda c: 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
    for x in range(w - 1):
        for y in range(h - 1):
            a, b, c = src[x, y], src[x + 1, y], src[x, y + 1]
            if a[3] < 200: continue
            for o in (b, c):
                if o[3] > 200 and abs(lum(a) - lum(o)) > threshold and lum(a) < lum(o):
                    r[x, y] = color or tuple(max(0, int(v * 0.55)) for v in a[:3]) + (255,)
    return res

def crop(im):
    """Trim to what was drawn; returns the image and the (dx, dy) it moved by."""
    bb = im.getbbox()
    return im.crop(bb), (bb[0], bb[1])

def canvas():
    """A roomy canvas with the iso origin well inside it (crop() trims it)."""
    a = Art(200, 200)
    return a, Iso(a, 100, 150)

def pct(pt, off, im):
    """A canvas point as % of the cropped, outlined sprite (the outline adds 1 px each side)."""
    return {'x': round((pt[0] - off[0] + 1) / im.width * 100, 2), 'y': round((pt[1] - off[1] + 1) / im.height * 100, 2)}

def save(im, name, meta=None):
    big = im.resize((im.width * SCALE, im.height * SCALE), Image.NEAREST)
    big.save(os.path.join(OUT, name), optimize=True)
    MANIFEST[name] = {'w': im.width, 'h': im.height, **(meta or {})}

MANIFEST = {}

# ---------------------------------------------------------------------------
# Drawn props
# ---------------------------------------------------------------------------

def trophy_cabinet():
    """An open wooden display cabinet, three shelves, against the back-right wall (front faces down-left)."""
    a, iso = canvas()
    W, D, H = 40, 12, 62          # along x (the wall), depth y, height
    # carcass
    iso.box(0, 0, 0, W, D, H, (WOOD[0], WOOD[1], WOOD[2]))
    # the open front: back panel and shelf cavities (recessed 2 deep, framed 2 px)
    cav = [(6, 20), (24, 38), (42, 56)]
    for z0, z1 in cav:
        iso.face_y(2, W - 2, z0, z1, D, WOOD[3])
        # back light strip and the shelf lip
        iso.face_y(2, W - 2, z0, z0 + 2, D, WOOD[2])
        iso.face_y(2, W - 2, z0, z0 + 1, D + 0.01, WOOD[0])
        # inner left wall of the cavity (light from the left)
        for z in range(z0 + 2, z1):
            pass
    # crown moulding and plinth
    iso.box(-1, -1, H, W + 2, D + 2, 3, (WOOD[0], WOOD[1], WOOD[2]))
    iso.box(-1, -1, 0, W + 2, D + 2, 3, (WOOD[1], WOOD[2], WOOD[3]))
    # brass plate on the plinth front
    iso.face_y(W / 2 - 6, W / 2 + 6, 0.5, 2.5, D + 1, BRASS[1])
    # a highlight down the front-left edge
    for z in range(4, H):
        x, y = iso.p(0, D, z); a.px(x, y, WOOD[0])
    im, off = crop(inner_edges(a.im, threshold=90))
    im = outline(im)
    # shelf slots: where a trophy's foot stands, as % of the outlined sprite (top shelf first, left->right)
    slots = [[pct(iso.p(6 + k * 9.5, D - 3, z0 + 1), off, im) for k in range(4)] for z0, _ in reversed(cav)]
    save(im, 'trophy-cabinet.png', {'shelves': slots})

def mailbox(flag_up):
    a, iso = canvas()
    # post
    iso.box(5, 5, 0, 3, 3, 24, (WOOD[1], WOOD[2], WOOD[3]))
    # box body (rounded top faked with a half-cylinder of rows)
    L, Wd, Hh = 12, 8, 7
    iso.box(0, 1, 24, L, Wd, Hh, (STEEL[0], STEEL[1], STEEL[2]))
    for i in range(4):
        iso.box(0, 1 + i, 24 + Hh + (1 if i in (1, 2) else 0), L, Wd - 2 * i if Wd - 2 * i > 0 else 1, 1, (STEEL[0], STEEL[1], STEEL[2]), faces='t')
    # door on the +y end
    iso.face_y(1, L - 1, 25, 24 + Hh, 1 + Wd, STEEL[1])
    iso.face_y(4, L - 4, 27, 29, 1 + Wd + 0.01, STEEL[3])
    # flag on the +x side
    if flag_up:
        iso.face_x(3, 4, 24, 40, L, RED[2]); iso.face_x(3, 8, 35, 40, L + 0.01, RED[1])
    else:
        iso.face_x(3, 12, 27, 28, L, RED[2]); iso.face_x(9, 12, 26, 29, L + 0.01, RED[1])
    im, _ = crop(inner_edges(a.im, threshold=90))
    save(outline(im), f"mailbox-{'up' if flag_up else 'down'}.png")

def shipped_bin():
    a, iso = canvas()
    W, D, H = 26, 18, 16
    # back walls (inside), floor, then front walls: an open-top crate
    iso.face_y(0, W, 0, H, 0, WOOD[2]); iso.face_x(0, D, 0, H, 0, WOOD[3])
    iso.box(0, 0, 0, W, D, 1, (WOOD[3], WOOD[2], WOOD[2]), faces='t')
    iso.face_y(0, W, 0, H, D, WOOD[1]); iso.face_x(0, D, 0, H, W, WOOD[2])
    # slats
    for z in (5, 10):
        iso.face_y(0, W, z, z + 0.6, D + 0.01, WOOD[3]); iso.face_x(0, D, z, z + 0.6, W + 0.01, WOOD[3])
    # rim
    P = iso.p
    a.line([P(0, D, H), P(W, D, H), P(W, 0, H)], WOOD[0])
    # stencil label "SHIPPED" as a light band
    iso.face_y(4, W - 4, 6.5, 9.5, D + 0.02, CARD[0])
    im, off = crop(inner_edges(a.im, threshold=90))
    im = outline(im)
    # where parcels pile (the inside floor, % of sprite)
    save(im, 'shipped-bin.png', {'pile': pct(P(W / 2, D / 2, 2), off, im)})

def parcel():
    a, iso = canvas()
    iso.box(0, 0, 0, 7, 6, 6, (CARD[0], CARD[1], CARD[2]))
    iso.face_y(3, 4, 0, 6, 6.01, CARD[3]); iso.box(3, 0, 6, 1, 6, 0.01, (CARD[3], CARD[3], CARD[3]), faces='t')
    save(outline(crop(a.im)[0]), 'parcel.png')

def planter():
    """A window-box planter, long along y (against the window wall; faces down-right)."""
    a, iso = canvas()
    L, D, H = 66, 9, 9
    iso.box(0, 0, 0, D, L, H, (TERRA[0], TERRA[1], TERRA[2]))
    # soil
    iso.box(1, 1, H - 1, D - 2, L - 2, 1.01, (rgb('6b4a2f'), rgb('5a3d26'), rgb('4a311e')), faces='t')
    # rim highlight + feet
    P = iso.p
    a.line([P(D, 0, H), P(D, L, H)], TERRA[0])
    for yy in (4, L - 6):
        iso.box(D - 2, yy, -2, 2, 2, 2, (TERRA[2], TERRA[2], TERRA[3]))
    im, off = crop(inner_edges(a.im, threshold=90))
    im = outline(im)
    # plant slots along the soil (% of sprite), back to front
    slots = [pct(P(D / 2, 4 + k * (L - 8) / 11, H), off, im) for k in range(12)]
    save(im, 'planter.png', {'slots': slots})

def plants():
    """Four small plants for the window box: sprout, leafy, flower, little tree."""
    def leaf(a, x, y, dx, dy, pal):
        a.poly([(x, y), (x + dx * 0.5 - dy * 0.35, y + dy * 0.5 + dx * 0.35), (x + dx, y + dy), (x + dx * 0.5 + dy * 0.2, y + dy * 0.5 - dx * 0.2)], pal)
    variants = []
    # sprout
    a = Art(12, 14); a.rect(5, 6, 6, 13, LEAF[2]); leaf(a, 6, 7, 5, -4, LEAF[1]); leaf(a, 5, 8, -5, -3, LEAF[0]); variants.append(a)
    # leafy
    a = Art(16, 18)
    for i, (dx, dy, c) in enumerate([(-7, -6, LEAF[1]), (7, -7, LEAF[1]), (-4, -11, LEAF[0]), (4, -12, LEAF[0]), (0, -14, LEAF[0]), (-8, -1, LEAF[2]), (8, -2, LEAF[2])]):
        leaf(a, 8, 16, dx, dy, c)
    variants.append(a)
    # flower
    a = Art(14, 20); a.rect(6, 7, 7, 19, LEAF[2]); leaf(a, 7, 14, -5, -3, LEAF[1]); leaf(a, 7, 12, 5, -3, LEAF[1])
    for dx, dy in ((0, -3), (3, 0), (0, 3), (-3, 0)): a.d.ellipse([6 + dx - 2, 5 + dy - 2, 6 + dx + 2, 5 + dy + 2], fill=rgb('ffd166'))
    a.d.ellipse([5, 4, 8, 7], fill=rgb('e5484d')); variants.append(a)
    # little tree
    a = Art(18, 24); a.rect(8, 13, 9, 23, WOOD[2])
    a.d.ellipse([2, 2, 16, 15], fill=LEAF[2]); a.d.ellipse([3, 1, 14, 11], fill=LEAF[1]); a.d.ellipse([5, 2, 11, 7], fill=LEAF[0])
    variants.append(a)
    for i, v in enumerate(variants):
        save(outline(crop(inner_edges(v.im, threshold=80))[0]), f'plant-{i}.png')

def binder():
    a, iso = canvas()
    # two binders standing, spine towards +y (front-left)
    for k, pal in enumerate((NAVYBIND, (rgb('ffcf70'), rgb('f2a93b'), rgb('c47a1c'), rgb('84500f')))):
        x0 = k * 6
        iso.box(x0, 0, 0, 5, 12, 16, (pal[0], pal[1], pal[2]))
        iso.face_y(x0 + 1, x0 + 4, 9, 13, 12.01, CLOTH[0])   # spine label
        iso.face_y(x0 + 2, x0 + 3, 3, 4, 12.01, STEEL[2])     # finger hole
    # a loose sheet on top
    iso.box(1, 2, 16, 10, 8, 0.01, (CLOTH[0], CLOTH[0], CLOTH[0]), faces='t')
    save(outline(crop(inner_edges(a.im, threshold=90))[0]), 'lessons-binder.png')

def dust_sheet(name, w, d, h):
    """A sheet thrown over something w x d x h: rounded drape, folds, a hem on the floor."""
    a, iso = canvas()
    # body: the box, slightly puffed, then folds
    iso.box(-1, -1, 0, w + 2, d + 2, h, (CLOTH[0], CLOTH[1], CLOTH[2]))
    # a softer top (the sheet sags): darker band near the top edge
    P = iso.p
    for i in range(3, int(w), 5):
        a.line([P(i, d + 1, h - 1), P(i + 1.5, d + 1, 1)], CLOTH[2])        # vertical folds on the front-left face
    for j in range(3, int(d), 5):
        a.line([P(w + 1, j, h - 1), P(w + 1, j + 1.5, 1)], CLOTH[3])        # on the front-right face
    # the hem flares on the floor
    a.poly([P(-2, d + 1, 0), P(w + 1, d + 1, 0), P(w + 2, d + 3, 0), P(-3, d + 3, 0)], CLOTH[1])
    a.poly([P(w + 1, -2, 0), P(w + 1, d + 1, 0), P(w + 3, d + 2, 0), P(w + 3, -3, 0)], CLOTH[2])
    # top highlight
    a.line([P(0, d, h), P(w, d, h)], CLOTH[0])
    save(outline(crop(inner_edges(a.im, threshold=60))[0]), f'dust-sheet-{name}.png')

def padlock():
    a = Art(12, 15)
    a.d.arc([2, 0, 9, 9], 180, 360, fill=STEEL[2], width=2)
    a.rect(2, 4, 3, 7, STEEL[2]); a.rect(8, 4, 9, 7, STEEL[2])
    a.rect(0, 6, 11, 14, BRASS[1]); a.rect(0, 6, 11, 7, BRASS[0]); a.rect(0, 12, 11, 14, BRASS[2])
    a.rect(5, 9, 6, 11, NAVY)
    save(outline(a.im), 'padlock.png')

# ---------------------------------------------------------------------------
# Restyled CC0 (Pixor)
# ---------------------------------------------------------------------------

TIER_RAMP = {
    'bronze': [rgb('ffd0a1'), rgb('e0985a'), rgb('b06a35'), rgb('7a4321'), rgb('4a2814')],
    'silver': [rgb('ffffff'), rgb('dfe6ee'), rgb('a9b5c4'), rgb('737f90'), rgb('454e5c')],
    'gold': [rgb('fff4b0'), rgb('ffd24a'), rgb('e0a020'), rgb('a86c12'), rgb('6b420c')],
    'platinum': [rgb('ffffff'), rgb('d9f6ff'), rgb('9fd8ec'), rgb('5ea3c2'), rgb('2f5f7a')],
}

def pixor_frame(pack_dir, name, size=32):
    fs = sorted(glob.glob(os.path.join(pack_dir, '**', name, 'sprites', 'selout', f'{name}-{size}px-8-sides.png'), recursive=True)) or \
         sorted(glob.glob(os.path.join(pack_dir, '**', name, 'sprites', 'selout', f'{name}-{size}px-4-sides.png'), recursive=True))
    if not fs: raise SystemExit(f'Pixor sprite {name} not found under {pack_dir}')
    im = Image.open(fs[0]).convert('RGBA').crop((0, 0, size, size))
    bb = im.getbbox()
    return im.crop(bb)

def lift(im, sat=1.15, contrast=1.1):
    px = im.load(); out = im.copy(); o = out.load()
    for x in range(im.width):
        for y in range(im.height):
            r, g, b, a = px[x, y]
            if a == 0: continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            l = min(1, max(0, 0.5 + (l - 0.5) * contrast)); s = min(1, s * sat)
            rr, gg, bb = colorsys.hls_to_rgb(h, l, s)
            o[x, y] = (int(rr * 255), int(gg * 255), int(bb * 255), 255 if a > 100 else 0)
    return out

def retone(im, ramp, keep_dark=True):
    """Map luminance onto a five-tone ramp (the gold cup becomes bronze, silver...); the plinth's dark wood stays."""
    px = im.load(); out = im.copy(); o = out.load()
    for x in range(im.width):
        for y in range(im.height):
            r, g, b, a = px[x, y]
            if a < 100: o[x, y] = (0, 0, 0, 0); continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if keep_dark and (s < 0.35 or not (0.04 < h < 0.2)): continue   # not the metal
            i = min(4, max(0, int((1 - l) * 5.5) - 1))
            o[x, y] = ramp[i]
    return out

def strip_outline(im):
    """Drop the source's own one-pixel rim so the navy one replaces it."""
    w, h = im.size; px = im.load(); out = im.copy(); o = out.load()
    for x in range(w):
        for y in range(h):
            if px[x, y][3] == 0: continue
            if any(not (0 <= x + dx < w and 0 <= y + dy < h) or px[x + dx, y + dy][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                lum = 0.3 * px[x, y][0] + 0.59 * px[x, y][1] + 0.11 * px[x, y][2]
                if lum < 90: o[x, y] = (0, 0, 0, 0)
    return out

def pixor_props(pack_dir):
    cup = strip_outline(pixor_frame(pack_dir, 'trophy-small'))
    for tier, ramp in TIER_RAMP.items():
        save(outline(retone(lift(cup), ramp)), f'trophy-{tier}.png')
    medal = strip_outline(pixor_frame(pack_dir, 'medal'))
    save(outline(lift(medal)), 'medal.png')
    for name in ('crown', 'four-leaf-clover', 'gem'):
        im = strip_outline(pixor_frame(pack_dir, name))
        save(outline(lift(im)), f"{'clover' if name == 'four-leaf-clover' else name}.png")

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--pixor', default='/workspace/claude-office-research/assets')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    trophy_cabinet(); mailbox(True); mailbox(False); shipped_bin(); parcel(); planter(); plants(); binder()
    dust_sheet('small', 12, 10, 12); dust_sheet('medium', 24, 14, 20); dust_sheet('tall', 16, 14, 46); dust_sheet('long', 9, 60, 9)
    padlock()
    pixor_props(args.pixor)
    with open(os.path.join(ROOT, 'src', 'progressionArt.json'), 'w') as f:
        json.dump({'scale': SCALE, 'sprites': MANIFEST}, f, indent=1)
        f.write('\n')
    print(f'wrote {len(MANIFEST)} sprites to {OUT}')
