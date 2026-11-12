#!/usr/bin/env python3
"""
make-ea-icons.py - restyles Kenney "Game Icons" (CC0, kenney.nl) into the
office's look for the EA scenes: the white glyph filled with a flat colour and
a lighter top band, a thick navy outline like the upstream sprites, a hard
drop shadow. Writes public/sprites/trading/ea/*.png (attribution: NOTICE.md).

  python3 scripts/make-ea-icons.py [<Kenney gameIcons PNG/White/2x folder>]
"""
import os
import sys
from PIL import Image, ImageFilter, ImageChops

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = sys.argv[1] if len(sys.argv) > 1 else '/workspace/claude-office-research/assets/kenney-game-icons/PNG/White/2x'
OUT = os.path.join(ROOT, 'public', 'sprites', 'trading', 'ea')
NAVY = (27, 36, 64, 255)

# output name: (Kenney icon, fill, highlight)
ICONS = {
    'risk-flag': ('warning', (245, 176, 38), (255, 220, 120)),
    'compile-ok': ('checkmark', (74, 190, 92), (150, 230, 150)),
    'compile-error': ('cross', (226, 72, 60), (255, 150, 140)),
    'tick-archive': ('barsHorizontal', (214, 168, 84), (245, 214, 150)),
}
SIZE = 48
OUTLINE = 3


def restyle(src, fill, light):
    icon = Image.open(src).convert('RGBA')
    icon.thumbnail((SIZE - 2 * OUTLINE - 4, SIZE - 2 * OUTLINE - 4), Image.LANCZOS)
    alpha = icon.split()[3].point(lambda a: 255 if a > 110 else 0)
    canvas = Image.new('L', (SIZE, SIZE), 0)
    ox = (SIZE - icon.width) // 2
    oy = (SIZE - icon.height) // 2 - 1
    canvas.paste(alpha, (ox, oy))
    outline = canvas.filter(ImageFilter.MaxFilter(2 * OUTLINE + 1))
    shadow = ImageChops.offset(outline, 0, 2)
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    img.paste(Image.new('RGBA', (SIZE, SIZE), (10, 14, 30, 110)), (0, 0), shadow)
    img.paste(Image.new('RGBA', (SIZE, SIZE), NAVY), (0, 0), outline)
    img.paste(Image.new('RGBA', (SIZE, SIZE), fill + (255,)), (0, 0), canvas)
    # The lighter top band (the upstream sprites' lit top edge)
    band = Image.new('L', (SIZE, SIZE), 0)
    top = oy + max(2, icon.height // 3)
    band.paste(255, (0, 0, SIZE, top))
    img.paste(Image.new('RGBA', (SIZE, SIZE), light + (255,)), (0, 0), ImageChops.multiply(canvas, band))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (src, fill, light) in ICONS.items():
        restyle(os.path.join(SRC, f'{src}.png'), fill, light).save(os.path.join(OUT, f'{name}.png'), optimize=True)
        print(os.path.join('public', 'sprites', 'trading', 'ea', f'{name}.png'))


if __name__ == '__main__':
    main()
