#!/usr/bin/env python3
"""
generate-progression-sprites.py - draws the firm's props
(public/sprites/progression/) to sit with the office's own furniture: smooth
illustrated shapes, soft gradients lit from the upper left, a thin dark
outline and a soft shadow on the floor.

Everything is drawn here (PIL + numpy, no outside art): each prop is built on
a 2:1 isometric grid in CSS pixels, painted at 8x, and saved at 4x with
antialiasing. The page shows a sprite at its art size (the PNG's size / 4),
so it has the same density as the upstream desks and counter.

A prop that holds other things also writes where they go to
src/progressionArt.json (the cabinet's shelves, plate and XP groove, the
bin's pile, the planter's slots), as % of the sprite.

Re-run:  python3 scripts/generate-progression-sprites.py
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'sprites', 'progression')
SCALE = 4            # saved pixels per CSS pixel
SS = 2               # extra oversampling while painting
U = SCALE * SS       # painted pixels per CSS pixel
INK = (34, 28, 38)   # the outline: the upstream furniture's warm near-black
MANIFEST = {}

def rgb(h):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

# light, mid, dark, deep
WOOD = [rgb('d9a871'), rgb('b47e4f'), rgb('8a5b37'), rgb('5c3b23')]
WOOD_IN = [rgb('7c5231'), rgb('634026'), rgb('4b301c'), rgb('382314')]
BRASS = [rgb('fff3b8'), rgb('f1cc5c'), rgb('c9962e'), rgb('8c601a')]
STEEL = [rgb('f3f6fa'), rgb('ccd4de'), rgb('98a3b3'), rgb('667083')]
RED = [rgb('ff9585'), rgb('e9524f'), rgb('b83436'), rgb('7e2026')]
CARD = [rgb('f0d3a2'), rgb('d8b07b'), rgb('b58956'), rgb('82603a')]
TERRA = [rgb('eaa67a'), rgb('cf8152'), rgb('a35d38'), rgb('713f26')]
SOIL = [rgb('7a5537'), rgb('62432a'), rgb('4c3320'), rgb('3a2618')]
LEAF = [rgb('a3d47e'), rgb('6bb158'), rgb('3f8844'), rgb('285f33')]
PAPER = [rgb('ffffff'), rgb('eceef2'), rgb('cfd4dc'), rgb('a7aebb')]
BLUE = [rgb('8fa9f7'), rgb('5676ea'), rgb('3a52bd'), rgb('26367f')]
AMBER = [rgb('ffd98a'), rgb('f4b146'), rgb('c98424'), rgb('8a5714')]
TIERS = {
    'bronze': [rgb('ffd9b0'), rgb('e3a067'), rgb('b8713c'), rgb('7f4a25')],
    'silver': [rgb('ffffff'), rgb('dde4ec'), rgb('aab5c3'), rgb('747f90')],
    'gold': [rgb('fff6bd'), rgb('ffd653'), rgb('e2a524'), rgb('a97014')],
    'platinum': [rgb('ffffff'), rgb('d6f4ff'), rgb('9cd6ec'), rgb('5c9fbe')],
}

# ---------------------------------------------------------------------------
# Painting
# ---------------------------------------------------------------------------

class Art:
    """A canvas in CSS pixels, painted at U px each."""
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new('RGBA', (int(w * U), int(h * U)), (0, 0, 0, 0))

    def _pts(self, pts):
        return [(x * U, y * U) for x, y in pts]

    def _mask(self, pts):
        m = Image.new('L', self.im.size, 0)
        ImageDraw.Draw(m).polygon(self._pts(pts), fill=255)
        return m

    def poly(self, pts, fill, alpha=255, clip=None):
        self.grad(pts, fill, fill, (0, 0), (1, 0), alpha, clip)

    def grad(self, pts, c0, c1, a, b, alpha=255, clip=None):
        """Fill a polygon with a gradient running from point a (c0) to point b (c1)."""
        m = self._mask(pts)
        if clip is not None: m = ImageChops.multiply(m, clip)
        bb = m.getbbox()
        if not bb: return
        x0, y0, x1, y1 = bb
        xs, ys = np.meshgrid(np.arange(x0, x1), np.arange(y0, y1))
        ax, ay, bx, by = a[0] * U, a[1] * U, b[0] * U, b[1] * U
        d = (bx - ax) ** 2 + (by - ay) ** 2 or 1
        t = np.clip(((xs - ax) * (bx - ax) + (ys - ay) * (by - ay)) / d, 0, 1)[..., None]
        col = np.array(c0)[None, None, :] * (1 - t) + np.array(c1)[None, None, :] * t
        tile = np.concatenate([col, np.full(t.shape, alpha)], axis=2).astype(np.uint8)
        layer = Image.fromarray(tile, 'RGBA')
        mm = m.crop(bb)
        if alpha != 255: mm = mm.point(lambda v: v * alpha // 255)
        self.im.paste(layer, (x0, y0), mm) if alpha == 255 else self.im.alpha_composite(_with_alpha(layer, mm), (x0, y0))

    def line(self, pts, fill, w=0.5, alpha=255):
        layer = Image.new('RGBA', self.im.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).line(self._pts(pts), fill=fill + (alpha,), width=max(1, round(w * U)), joint='curve')
        self.im.alpha_composite(layer)

    def ellipse(self, cx, cy, rx, ry, c0, c1=None, alpha=255, clip=None):
        """An ellipse, shaded top-left (c0) to bottom-right (c1)."""
        n = 40
        pts = [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]
        self.grad(pts, c0, c1 or c0, (cx - rx, cy - ry), (cx + rx, cy + ry), alpha, clip)

    def clip_of(self, pts):
        return self._mask(pts)

def _with_alpha(layer, mask):
    out = layer.copy(); out.putalpha(mask); return out

class Iso:
    """2:1 isometric: +x runs right-down, +y runs left-down, +z up."""
    def __init__(self, art, ox, oy):
        self.a, self.ox, self.oy = art, ox, oy
    def p(self, x, y, z):
        return (self.ox + (x - y), self.oy + (x + y) / 2 - z)
    def fy(self, x0, x1, z0, z1, y):   # a face looking down-left
        P = self.p; return [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)]
    def fx(self, y0, y1, z0, z1, x):   # a face looking down-right
        P = self.p; return [P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)]
    def fz(self, x0, x1, y0, y1, z):   # a face looking up
        P = self.p; return [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)]
    def box(self, x0, y0, z0, dx, dy, dz, pal, edge=True):
        """A lit box: pal is light (top), mid (down-left face), dark (down-right face), deep (edges)."""
        a, P = self.a, self.p
        x1, y1, z1 = x0 + dx, y0 + dy, z0 + dz
        a.grad(self.fx(y0, y1, z0, z1, x1), mix(pal[2], pal[1], 0.25), pal[2], P(x1, y0, z1), P(x1, y1, z0))
        a.grad(self.fy(x0, x1, z0, z1, y1), mix(pal[1], pal[0], 0.35), mix(pal[1], pal[2], 0.35), P(x0, y1, z1), P(x1, y1, z0))
        a.grad(self.fz(x0, x1, y0, y1, z1), pal[0], mix(pal[0], pal[1], 0.5), P(x0, y0, z1), P(x1, y1, z1))
        if edge:
            # the lit edges where the top meets the faces, and the dark corner between the faces
            a.line([P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1)], mix(pal[0], (255, 255, 255), 0.35), 0.45, 200)
            a.line([P(x1, y1, z1), P(x1, y1, z0)], pal[3], 0.45, 150)

def finish(art, shadow=None, outline=0.4):
    """Outline what was painted, lay a soft shadow under it, scale to the saved size, trim.
    shadow: floor polygon (CSS px) the prop stands on, or None. Returns (image, (dx, dy) trimmed in CSS px)."""
    im = art.im
    alpha = im.getchannel('A')
    r = max(1, round(outline * U))
    grown = alpha.filter(ImageFilter.MaxFilter(2 * r + 1)).filter(ImageFilter.GaussianBlur(U * 0.12))
    base = Image.new('RGBA', im.size, INK + (0,)); base.putalpha(grown)
    if shadow:
        sh = Image.new('L', im.size, 0)
        ImageDraw.Draw(sh).polygon([(x * U, y * U) for x, y in shadow], fill=120)
        sh = sh.filter(ImageFilter.GaussianBlur(U * 1.6))
        under = Image.new('RGBA', im.size, (20, 14, 24, 0)); under.putalpha(sh)
        under.alpha_composite(base); base = under
    base.alpha_composite(im)
    small = base.resize((base.width // SS, base.height // SS), Image.LANCZOS)
    bb = small.getchannel('A').point(lambda v: 255 if v > 6 else 0).getbbox()
    # trim on whole CSS pixels so the art size is exact
    x0, y0 = bb[0] // SCALE * SCALE, bb[1] // SCALE * SCALE
    x1, y1 = -(-bb[2] // SCALE) * SCALE, -(-bb[3] // SCALE) * SCALE
    return small.crop((x0, y0, x1, y1)), (x0 / SCALE, y0 / SCALE)

def pct(pt, off, im):
    return {'x': round((pt[0] - off[0]) / (im.width / SCALE) * 100, 2), 'y': round((pt[1] - off[1]) / (im.height / SCALE) * 100, 2)}

def save(im, name, meta=None):
    im.save(os.path.join(OUT, name), optimize=True)
    MANIFEST[name] = {'w': im.width // SCALE, 'h': im.height // SCALE, **(meta or {})}

def floor(iso, x0, x1, y0, y1, dx=2.5, dy=1.5):
    """The floor under a footprint, pushed away from the light, for finish(shadow=)."""
    return [(x + dx, y + dy) for x, y in iso.fz(x0, x1, y0, y1, 0)]

# ---------------------------------------------------------------------------
# Props
# ---------------------------------------------------------------------------

def trophy_cabinet():
    """A wooden display cabinet with three open shelves; it faces down-left, like the counter beside it."""
    a = Art(130, 144); iso = Iso(a, 48, 98); P = iso.p
    W, D = 40, 11
    PL, CR = 6, 4                      # plinth and crown heights
    cav = [(PL + 1.5, PL + 16), (PL + 18, PL + 32.5), (PL + 34.5, PL + 49)]
    H = cav[-1][1] + 1.5
    # plinth first (the carcass stands on it), then the carcass; the crown goes on last
    iso.box(-1.5, -1.5, 0, W + 3, D + 3, PL, [WOOD[1], mix(WOOD[1], WOOD[2], 0.5), WOOD[2], WOOD[3]])
    # (its brass plate is lettered with the level by the page)
    iso.box(0, 0, PL, W, D, H - PL, WOOD)
    # the three openings, seen from above-right: back panel, shelf, the inner left wall
    for z0, z1 in cav:
        clip = a.clip_of(iso.fy(2.5, W - 2.5, z0, z1, D))
        a.grad(iso.fy(2.5, W - 2.5, z0, z1, 1.5), WOOD_IN[1], WOOD_IN[3], P(2.5, 1.5, z0), P(W - 2.5, 1.5, z1), clip=clip)
        a.grad(iso.fx(1.5, D, z0, z1, 2.5), WOOD_IN[2], WOOD_IN[3], P(2.5, D, z0), P(2.5, 1.5, z1), clip=clip)
        a.grad(iso.fz(2.5, W - 2.5, 1.5, D, z0), mix(WOOD[1], WOOD_IN[0], 0.5), WOOD[0], P(2.5, 1.5, z0), P(W - 2.5, D, z0), clip=clip)
        # the shade the shelf above throws on the back panel
        a.grad(iso.fy(2.5, W - 2.5, z1 - 5, z1, 1.5), WOOD_IN[3], WOOD_IN[3], P(0, 0, 0), P(1, 0, 0), alpha=110, clip=clip)
        # the opening's rim: dark above and to the left, lit along the shelf's front edge
        a.line([P(2.5, D, z0), P(2.5, D, z1), P(W - 2.5, D, z1), P(W - 2.5, D, z0)], WOOD[3], 0.5, 170)
        a.line([P(2.5, D, z0), P(W - 2.5, D, z0)], WOOD[0], 0.6, 230)
    # crown: a lipped top with a groove along its front (the XP bar sits in the groove)
    iso.box(-1.5, -1.5, H, W + 3, D + 3, CR, WOOD)
    g0, g1 = P(3, D + 1.5, H + CR / 2), P(W - 3, D + 1.5, H + CR / 2)
    a.poly(iso.fy(2.4, W - 2.4, H + 1, H + CR - 1, D + 1.5), WOOD_IN[3])
    plate = iso.fy(W / 2 - 8, W / 2 + 8, 0.8, PL - 0.8, D + 1.5)
    a.grad(plate, BRASS[0], BRASS[2], plate[3], plate[1])
    a.line(plate + [plate[0]], BRASS[3], 0.35, 200)
    im, off = finish(a, floor(iso, -1.5, W + 1.5, -1.5, D + 1.5, 2.5, 1.5))
    slots = [[pct(P(6.2 + k * 9.2, D - 3.4, z0), off, im) for k in range(4)] for z0, _ in reversed(cav)]
    centre = lambda q: ((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2)
    save(im, 'trophy-cabinet.png', {
        'shelves': slots,
        'plate': pct(centre(plate), off, im),
        'xp': {'from': pct(g0, off, im), 'to': pct(g1, off, im)},
        'top': pct(P(W / 2, D / 2, H + CR), off, im),
    })

def trophy(tier, pal):
    """A two-handled cup on a wooden foot, small enough to stand on a cabinet shelf."""
    a = Art(16, 18); cx = 8
    hi = mix(pal[0], (255, 255, 255), 0.5)
    # the shade it throws on the shelf
    a.ellipse(cx + 1.2, 15.6, 5.2, 1.5, (30, 18, 10), alpha=90)
    # foot: a dark wooden block
    a.grad([(cx - 3.6, 13), (cx + 3.6, 13), (cx + 4, 15.6), (cx - 4, 15.6)], rgb('7a5232'), rgb('4a2f1b'), (cx - 4, 13), (cx + 4, 15.6))
    a.ellipse(cx, 13, 3.6, 0.9, rgb('95683f'), rgb('6a4528'))
    # stem and knop
    a.grad([(cx - 1, 9.6), (cx + 1, 9.6), (cx + 1.6, 13), (cx - 1.6, 13)], pal[1], pal[3], (cx - 1.6, 11), (cx + 1.6, 11))
    a.ellipse(cx, 10.4, 1.9, 0.8, pal[0], pal[2])
    # handles: rings behind the bowl
    for s in (-1, 1):
        ring = Image.new('RGBA', a.im.size, (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse([(cx + s * 4.5 - 2.3) * U, 3.4 * U, (cx + s * 4.5 + 2.3) * U, 8.2 * U], outline=(pal[1] if s < 0 else pal[2]) + (255,), width=round(1.0 * U))
        a.im.alpha_composite(ring)
    # bowl: wide rim narrowing to the stem
    bowl = [(cx - 4.6, 2.6), (cx + 4.6, 2.6), (cx + 4.2, 6), (cx + 2.6, 9), (cx + 1, 10), (cx - 1, 10), (cx - 2.6, 9), (cx - 4.2, 6)]
    a.grad(bowl, pal[0], pal[3], (cx - 4.6, 4), (cx + 4.6, 8))
    a.grad([(cx - 3.4, 3.4), (cx - 2.2, 3.4), (cx - 1.6, 8.4), (cx - 2.4, 8.4)], hi, pal[0], (cx, 3.4), (cx, 8.4), alpha=210)
    a.ellipse(cx, 2.6, 4.6, 1.2, mix(pal[2], pal[3], 0.5), pal[3])
    a.ellipse(cx, 2.5, 4.6, 1.0, hi, pal[1], alpha=255)
    a.ellipse(cx, 2.8, 3.5, 0.65, pal[3], pal[2])
    im, _ = finish(a, outline=0.4)
    save(im, f'trophy-{tier}.png')

def mailbox(flag_up):
    """A kerbside mailbox on a post with a small foot, its door towards the room."""
    a = Art(60, 70); iso = Iso(a, 30, 58); P = iso.p
    # foot and post
    iso.box(-1.5, -1.5, 0, 7, 7, 1.6, WOOD[1:] + [WOOD[3]])
    iso.box(0.5, 0.5, 1.6, 3, 3, 21, WOOD)
    # body: a box with an arched roof, long along x; its door is the down-left... the +y end
    L, Wd, Hh, z = 15, 9, 6, 22.6
    x0, y0 = -5.5, -2.5
    iso.box(x0, y0, z, L, Wd, Hh, STEEL)
    # the arched roof: slices across the width
    n = 14
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        ya, yb = y0 + Wd * t0, y0 + Wd * t1
        za, zb = z + Hh + 3.4 * math.sin(math.pi * t0), z + Hh + 3.4 * math.sin(math.pi * t1)
        c = mix(STEEL[0], STEEL[2], t0 ** 1.5)
        a.poly([P(x0, ya, za), P(x0 + L, ya, za), P(x0 + L, yb, zb), P(x0, yb, zb)], c)
    # the right-hand end: the arch's cap
    cap = [P(x0 + L, y0 + Wd * i / n, z + Hh + 3.4 * math.sin(math.pi * i / n)) for i in range(n + 1)]
    a.grad(cap + [P(x0 + L, y0 + Wd, z + Hh), P(x0 + L, y0, z + Hh)], STEEL[1], STEEL[3], P(x0 + L, y0, z + Hh + 3), P(x0 + L, y0 + Wd, z + Hh))
    # door seam and handle on the long front, letter slot
    front_y = y0 + Wd
    a.line([P(x0 + 1.2, front_y, z + 1), P(x0 + 1.2, front_y, z + Hh - 0.4), P(x0 + L - 1.2, front_y, z + Hh - 0.4), P(x0 + L - 1.2, front_y, z + 1), P(x0 + 1.2, front_y, z + 1)], STEEL[3], 0.35, 150)
    a.poly(iso.fy(x0 + 4.5, x0 + L - 4.5, z + 2.6, z + 3.8, front_y), rgb('3b4252'))
    # flag on the right-hand end
    fxp = x0 + L + 0.01
    if flag_up:
        a.poly(iso.fx(y0 + 3.4, y0 + 4.4, z + 1, z + 15, fxp), RED[2])
        a.grad(iso.fx(y0 + 3.4, y0 + 8.6, z + 10.5, z + 15, fxp), RED[0], RED[1], P(fxp, y0 + 3.4, z + 15), P(fxp, y0 + 8.6, z + 10.5))
    else:
        a.poly(iso.fx(y0 + 2, y0 + 8.4, z + 2.4, z + 3.4, fxp), RED[2])
        a.grad(iso.fx(y0 + 5.6, y0 + 8.4, z + 1.2, z + 4.6, fxp), RED[1], RED[2], P(fxp, y0 + 5.6, z + 4.6), P(fxp, y0 + 8.4, z + 1.2))
    im, _ = finish(a, floor(iso, -1.5, 5.5, -1.5, 5.5, 3, 1.5))
    save(im, f"mailbox-{'up' if flag_up else 'down'}.png")

def shipped_bin():
    """An open-topped wooden crate; parcels pile inside it."""
    a = Art(110, 90); iso = Iso(a, 50, 60); P = iso.p
    W, D, H, T = 27, 19, 16, 1.6
    # inside: the two far walls and the floor
    a.grad(iso.fy(0, W, 0, H, T), WOOD_IN[0], WOOD_IN[2], P(0, T, H), P(W, T, 0))
    a.grad(iso.fx(0, D, 0, H, T), WOOD_IN[1], WOOD_IN[3], P(T, 0, H), P(T, D, 0))
    a.grad(iso.fz(T, W - T, T, D - T, 1), WOOD_IN[2], WOOD_IN[1], P(T, T, 1), P(W - T, D - T, 1))
    back = a.im.copy()
    # the two near walls, with slats
    iso.box(0, D - T, 0, W, T, H, WOOD)
    iso.box(W - T, 0, 0, T, D, H, WOOD)
    for z in (5.3, 10.6):
        a.line([P(0, D, z), P(W, D, z), P(W, 0, z)], WOOD[3], 0.45, 140)
    # the top rim all the way round
    a.grad(iso.fz(0, W, 0, T, H), WOOD[0], WOOD[1], P(0, 0, H), P(W, T, H))
    a.grad(iso.fz(0, T, 0, D, H), WOOD[0], WOOD[1], P(0, 0, H), P(T, D, H))
    # corner cleats
    for x in (0.4, W - 3):
        a.grad(iso.fy(x, x + 2.6, 0, H, D + 0.01), WOOD[0], WOOD[1], P(x, D, H), P(x + 2.6, D, 0), alpha=120)
    im, off = finish(a, floor(iso, 0, W, 0, D, 3.5, 2))
    save(im, 'shipped-bin.png', {'pile': pct(P(W / 2, D / 2, 3), off, im), 'tag': pct(P(W / 2, D, 7.8), off, im)})

def parcel():
    a = Art(30, 30); iso = Iso(a, 14, 20); P = iso.p
    iso.box(0, 0, 0, 7.5, 6.5, 5.5, CARD)
    # tape over the top and down the front
    a.poly([P(3.1, 0, 5.5), P(4.4, 0, 5.5), P(4.4, 6.5, 5.5), P(3.1, 6.5, 5.5)], CARD[3], 170)
    a.poly(iso.fy(3.1, 4.4, 0, 5.5, 6.51), CARD[3], 150)
    a.poly(iso.fy(0.9, 2.6, 2.6, 4.3, 6.51), PAPER[1])
    im, _ = finish(a, outline=0.4)
    save(im, 'parcel.png')

def planter():
    """A terracotta window box, long along the window wall."""
    a = Art(120, 80); iso = Iso(a, 76, 14); P = iso.p
    L, D, H = 66, 9, 8.5
    for yy in (4, L - 7):
        iso.box(1, yy, 0, D - 2, 3, 1.6, TERRA[1:] + [TERRA[3]], edge=False)
    iso.box(0, 0, 1.6, D, L, H, TERRA)
    # the rolled rim and the soil
    a.grad(iso.fz(0, D, 0, L, 1.6 + H), TERRA[0], TERRA[1], P(0, 0, 0), P(D, L, 0))
    a.grad(iso.fz(1.3, D - 1.3, 1.3, L - 1.3, 1.6 + H - 0.01), SOIL[1], SOIL[2], P(0, 0, 0), P(D, L, 0))
    a.line([P(D, 0, 1.6 + H - 1.6), P(D, L, 1.6 + H - 1.6), P(0, L, 1.6 + H - 1.6)], TERRA[3], 0.4, 110)
    im, off = finish(a, floor(iso, 0, D, 0, L, 3, 1.6))
    slots = [pct(P(D / 2, 4.5 + k * (L - 9) / 11, 1.6 + H), off, im) for k in range(12)]
    save(im, 'planter.png', {'slots': slots})

def _leaf(a, x, y, ang, ln, wd, pal):
    """A pointed leaf from (x, y), ang degrees from straight up."""
    r = math.radians(ang); ux, uy = math.sin(r), -math.cos(r); vx, vy = -uy, ux
    n = 10; left, right = [], []
    for i in range(n + 1):
        t = i / n; w = wd * math.sin(math.pi * t) ** 0.8
        px, py = x + ux * ln * t, y + uy * ln * t
        left.append((px - vx * w / 2, py - vy * w / 2)); right.append((px + vx * w / 2, py + vy * w / 2))
    tip = (x + ux * ln, y + uy * ln)
    a.grad(left + right[::-1], pal[0], pal[2], (x - wd, y - ln), (x + wd, y))
    a.line([(x, y), tip], pal[3], 0.3, 120)

def plants():
    """Four small plants for the window box: sprout, leafy, flower, little tree."""
    # sprout
    a = Art(16, 16)
    a.line([(8, 15), (8, 9)], LEAF[2], 0.9)
    _leaf(a, 8, 10, -52, 6.5, 3.6, LEAF); _leaf(a, 8, 9.4, 48, 6, 3.4, LEAF)
    im, _ = finish(a, outline=0.4); save(im, 'plant-0.png')
    # leafy
    a = Art(22, 22)
    for ang, ln, wd in ((-70, 9, 4), (70, 9, 4), (-38, 12, 4.6), (38, 12, 4.6), (-12, 14, 4.6), (14, 15, 4.8)):
        _leaf(a, 11, 21, ang, ln, wd, LEAF if abs(ang) < 50 else [LEAF[1], LEAF[1], LEAF[3], LEAF[3]])
    im, _ = finish(a, outline=0.4); save(im, 'plant-1.png')
    # flower
    a = Art(18, 26)
    a.line([(9, 25), (9, 9)], LEAF[2], 0.9)
    _leaf(a, 9, 19, -58, 7, 3.4, LEAF); _leaf(a, 9, 16.5, 56, 6.5, 3.2, LEAF)
    for k in range(6):
        ang = k * 60 + 20
        a.ellipse(9 + 3.3 * math.cos(math.radians(ang)), 6.4 + 3.3 * math.sin(math.radians(ang)), 2.5, 2.5, rgb('fff0b0'), rgb('ffc94f'))
    a.ellipse(9, 6.4, 2.2, 2.2, RED[0], RED[2])
    im, _ = finish(a, outline=0.4); save(im, 'plant-2.png')
    # little tree
    a = Art(24, 30)
    a.grad([(11, 16), (13, 16), (13.6, 29), (10.4, 29)], WOOD[1], WOOD[3], (10.4, 20), (13.6, 20))
    for cx, cy, r, c0, c1 in ((12.6, 11.5, 8.6, LEAF[2], LEAF[3]), (11, 10, 7.4, LEAF[1], LEAF[2]), (9.4, 8, 4.6, LEAF[0], LEAF[1])):
        a.ellipse(cx, cy, r, r * 0.92, c0, c1)
    im, _ = finish(a, outline=0.4); save(im, 'plant-3.png')

def binder():
    """Two lever-arch binders standing on the counter, a sheet lying across them."""
    a = Art(50, 50); iso = Iso(a, 22, 34); P = iso.p
    for k, pal in enumerate((BLUE, AMBER)):
        x0 = k * 5.6
        iso.box(x0, 0, 0, 5, 12, 16, pal)
        a.grad(iso.fy(x0 + 0.9, x0 + 4.1, 8.2, 13, 12.01), PAPER[0], PAPER[2], P(x0, 12, 13), P(x0 + 5, 12, 8))
        a.ellipse(*P(x0 + 2.5, 12.01, 3.6), 0.9, 0.9, pal[3], pal[3])
    a.grad(iso.fz(0.6, 10.4, 1.4, 10.4, 16.05), PAPER[0], PAPER[1], P(0, 0, 16), P(11, 11, 16))
    for i in range(3):
        a.line([P(2.2, 3 + i * 2.2, 16.06), P(8.6, 3 + i * 2.2, 16.06)], PAPER[3], 0.3, 180)
    im, _ = finish(a, floor(iso, 0, 10.6, 0, 12, 2, 1), outline=0.45)
    save(im, 'lessons-binder.png')

def padlock():
    a = Art(16, 20)
    ring = Image.new('RGBA', a.im.size, (0, 0, 0, 0))
    ImageDraw.Draw(ring).arc([3.6 * U, 1.6 * U, 12.4 * U, 12 * U], 180, 360, fill=STEEL[2] + (255,), width=round(1.7 * U))
    ImageDraw.Draw(ring).line([(4.45 * U, 6.6 * U), (4.45 * U, 10 * U)], fill=STEEL[2] + (255,), width=round(1.7 * U))
    ImageDraw.Draw(ring).line([(11.55 * U, 6.6 * U), (11.55 * U, 10 * U)], fill=STEEL[3] + (255,), width=round(1.7 * U))
    a.im.alpha_composite(ring)
    a.grad([(2, 9), (14, 9), (14, 18), (2, 18)], BRASS[0], BRASS[2], (2, 9), (14, 18))
    a.ellipse(8, 12.6, 1.3, 1.3, BRASS[3], INK); a.poly([(7.4, 13), (8.6, 13), (8.9, 15.6), (7.1, 15.6)], INK)
    im, _ = finish(a, outline=0.45); save(im, 'padlock.png')

def medal():
    a = Art(16, 26)
    a.grad([(3, 1), (7.4, 1), (9.4, 13), (6, 13)], BLUE[0], BLUE[2], (3, 1), (9, 13))
    a.grad([(8.6, 1), (13, 1), (10, 13), (6.6, 13)], RED[0], RED[2], (8.6, 1), (13, 13))
    a.ellipse(8, 17.6, 6, 6, BRASS[0], BRASS[3])
    a.ellipse(8, 17.6, 4.3, 4.3, BRASS[1], BRASS[2])
    star = [(8 + (2.9 if i % 2 == 0 else 1.25) * math.sin(math.pi * i / 5), 17.6 - (2.9 if i % 2 == 0 else 1.25) * math.cos(math.pi * i / 5)) for i in range(10)]
    a.grad(star, BRASS[0], BRASS[1], (5, 14.6), (11, 20.6))
    im, _ = finish(a, outline=0.45); save(im, 'medal.png')

def crown():
    a = Art(30, 22); pal = TIERS['gold']
    body = [(4, 18), (2.6, 6.4), (8.6, 11.6), (15, 2.6), (21.4, 11.6), (27.4, 6.4), (26, 18)]
    a.grad(body, pal[0], pal[3], (3, 4), (27, 18))
    a.grad([(4, 15), (26, 15), (26, 19.4), (4, 19.4)], pal[1], pal[3], (4, 15), (26, 19.4))
    a.line([(4.2, 15), (25.8, 15)], pal[0], 0.4, 200)
    for x, y in ((2.6, 6), (15, 2.4), (27.4, 6)):
        a.ellipse(x, y, 1.7, 1.7, pal[0], pal[2])
    for x, c in ((9, RED), (15, BLUE), (21, RED)):
        a.ellipse(x, 17.2, 1.4, 1.4, c[0], c[2])
    im, _ = finish(a, outline=0.45); save(im, 'crown.png')

def clover():
    a = Art(26, 32)
    a.line([(13, 16), (14.5, 24), (12.6, 31)], LEAF[3], 1.1)
    for k in range(4):
        ang = math.radians(k * 90 + 45)
        cx, cy = 13 + 5.6 * math.cos(ang), 12.6 + 5.6 * math.sin(ang)
        px, py = -math.sin(ang), math.cos(ang)
        for s in (-1, 1):
            a.ellipse(cx + px * s * 2.3, cy + py * s * 2.3, 3.5, 3.5, LEAF[0] if k in (2, 3) else LEAF[1], LEAF[2])
    im, _ = finish(a, outline=0.45); save(im, 'clover.png')

def gem():
    a = Art(28, 26); c = [rgb('e9fbff'), rgb('8fe3f5'), rgb('3fb4d9'), rgb('1f7fa8')]
    top, mid, tip = 4, 10, 24
    xs = [3, 9, 14, 19, 25]
    a.grad([(xs[1], top), (xs[3], top), (xs[4], mid), (xs[0], mid)], c[0], c[1], (xs[0], top), (xs[4], mid))
    a.poly([(xs[1], top), (xs[2], mid), (xs[0], mid)], c[1]); a.poly([(xs[3], top), (xs[4], mid), (xs[2], mid)], c[2])
    a.grad([(xs[0], mid), (xs[2], mid), (14, tip)], c[1], c[2], (xs[0], mid), (14, tip))
    a.grad([(xs[2], mid), (xs[4], mid), (14, tip)], c[2], c[3], (xs[2], mid), (xs[4], tip))
    a.poly([(10.4, mid), (17.6, mid), (14, tip)], c[0], 90)
    a.line([(xs[0], mid), (xs[4], mid)], c[0], 0.35, 220)
    im, _ = finish(a, outline=0.45); save(im, 'gem.png')

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    trophy_cabinet()
    for tier, pal in TIERS.items(): trophy(tier, pal)
    mailbox(True); mailbox(False); shipped_bin(); parcel(); planter(); plants(); binder()
    padlock(); medal(); crown(); clover(); gem()
    with open(os.path.join(ROOT, 'src', 'progressionArt.json'), 'w') as f:
        json.dump({'scale': SCALE, 'sprites': MANIFEST}, f, indent=1)
        f.write('\n')
    print(f'wrote {len(MANIFEST)} sprites to {OUT}')
