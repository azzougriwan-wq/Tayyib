#!/usr/bin/env python3
"""Génère les icônes de Tayyib (site, APK, image de partage). Lancé une fois ; les PNG sont versionnés."""
import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEAL = (11, 107, 90, 255)
SAFFRON = (230, 160, 30, 255)
WHITE = (255, 255, 255, 255)
LIGHT_BG = (243, 246, 245, 255)
DARK_BG = (12, 20, 18, 255)


def star_points(cx, cy, half, angle):
    pts = []
    for k in range(4):
        a = math.radians(angle + 45 + 90 * k)
        r = half * math.sqrt(2)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw_star(img, cx, cy, size, color, dot=None):
    """Étoile à huit branches (deux carrés superposés) percée d'un cercle central."""
    s = 4
    big = Image.new("RGBA", (img.width * s, img.height * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    half = size * s / 2 / math.sqrt(2) * 1.0
    for ang in (0, 45):
        d.polygon(star_points(cx * s, cy * s, half, ang), fill=color)
    if dot:
        r = size * s * 0.1
        d.ellipse([cx * s - r, cy * s - r, cx * s + r, cy * s + r], fill=dot)
    big = big.resize(img.size, Image.LANCZOS)
    img.alpha_composite(big)


def square_icon(px, bg, star_ratio, rounded=False):
    img = Image.new("RGBA", (px, px), bg)
    if rounded:
        mask = Image.new("L", (px * 4, px * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, px * 4, px * 4], radius=px * 4 * 0.22, fill=255)
        img.putalpha(mask.resize((px, px), Image.LANCZOS))
    draw_star(img, px / 2, px / 2, px * star_ratio, WHITE, dot=bg)
    return img


def main():
    icons = os.path.join(ROOT, "www", "icons")
    res = os.path.join(ROOT, "resources")
    os.makedirs(icons, exist_ok=True)
    os.makedirs(res, exist_ok=True)

    square_icon(512, TEAL, 0.62).save(os.path.join(icons, "icon-512.png"))
    square_icon(192, TEAL, 0.62).save(os.path.join(icons, "icon-192.png"))
    square_icon(512, TEAL, 0.46).save(os.path.join(icons, "icon-maskable-512.png"))
    square_icon(180, TEAL, 0.58).convert("RGB").save(os.path.join(icons, "apple-touch-icon.png"))
    square_icon(64, TEAL, 0.7, rounded=True).save(os.path.join(icons, "favicon.png"))

    # Image de partage (réseaux sociaux, messageries)
    og = Image.new("RGBA", (1200, 630), TEAL)
    draw_star(og, 250, 315, 300, WHITE, dot=TEAL)
    d = ImageDraw.Draw(og)
    fdir = "/usr/share/fonts/truetype/google-fonts"
    try:
        big = ImageFont.truetype(os.path.join(fdir, "Poppins-Bold.ttf"), 120)
        small = ImageFont.truetype(os.path.join(fdir, "Poppins-Medium.ttf"), 42)
    except OSError:
        big = small = ImageFont.load_default()
    d.text((470, 190), "Tayyib", font=big, fill=WHITE)
    d.text((474, 350), "Restaurants halal", font=small, fill=(255, 255, 255, 235))
    d.text((474, 405), "Paris & petite couronne", font=small, fill=(255, 255, 255, 200))
    og.convert("RGB").save(os.path.join(icons, "og.png"))

    # Sources pour l'APK (@capacitor/assets)
    square_icon(1024, TEAL, 0.62).save(os.path.join(res, "icon-only.png"))
    fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw_star(fg, 512, 512, 1024 * 0.42, WHITE, dot=TEAL)
    fg.save(os.path.join(res, "icon-foreground.png"))
    Image.new("RGBA", (1024, 1024), TEAL).save(os.path.join(res, "icon-background.png"))
    for name, bg in (("splash.png", LIGHT_BG), ("splash-dark.png", DARK_BG)):
        sp = Image.new("RGBA", (2732, 2732), bg)
        draw_star(sp, 1366, 1366, 520, TEAL, dot=bg)
        sp.save(os.path.join(res, name))
    print("Icônes générées")


if __name__ == "__main__":
    main()
