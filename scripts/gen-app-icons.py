#!/usr/bin/env python3
"""
Gera os icones dos apps Android a partir da LOGO REAL do site.

Fonte unica de verdade: public/icon-192.png (o mesmo arquivo que o site usa em
`<img src="/icon-192.png">` no Navbar e no manifest PWA). Nada e redesenhado:
o PNG do site e apenas reescalado para cada densidade, entao o icone do app e
literalmente a marca do site.

Saidas:
  mobile/android/app/src/main/res/mipmap-*/ic_launcher.png
  mobile/android/app/src/main/res/mipmap-*/ic_launcher_round.png
  mobile/android/app/src/main/res/drawable-*/ic_launcher_foreground.png  (adaptive)
  tv/android/...  (as mesmas)
  tv/android/app/src/main/res/drawable-nodpi/tv_banner.png               (320x180)
  mobile/android/app/src/main/res/drawable-nodpi/splash_logo.png
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "icon-192.png"

# Densidades Android: nome -> multiplicador sobre 48dp
DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}

BG = (10, 10, 15, 255)  # --bg do site: #0a0a0f


def load_logo() -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    return im


def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([0, 0, size - 1, size - 1], fill=255)
    return m


def make_launcher(logo: Image.Image, px: int, round_icon: bool) -> Image.Image:
    """Icone legado (pre-Android 8): logo sobre fundo da marca, recortado."""
    canvas = Image.new("RGBA", (px, px), BG)
    # A logo ocupa ~86% do quadrado, com respiro nas bordas.
    inner = int(px * 0.86)
    art = logo.resize((inner, inner), Image.LANCZOS)
    off = (px - inner) // 2
    canvas.alpha_composite(art, (off, off))
    mask = circle_mask(px) if round_icon else rounded_mask(px, int(px * 0.22))
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(canvas, (0, 0), mask)
    return out


def make_adaptive_foreground(logo: Image.Image, px: int) -> Image.Image:
    """
    Foreground do adaptive icon.

    O adaptive icon recorta ~18% de cada lado (a "safe zone" e o circulo
    central de 72dp em 108dp). Por isso a logo e desenhada a 62% do canvas,
    centralizada: assim ela nunca e cortada pela mascara do launcher.
    """
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    inner = int(px * 0.62)
    art = logo.resize((inner, inner), Image.LANCZOS)
    off = (px - inner) // 2
    canvas.alpha_composite(art, (off, off))
    return canvas


def make_tv_banner(logo: Image.Image, w: int = 320, h: int = 180) -> Image.Image:
    """Banner do Android TV (320x180 dp): logo + wordmark, fundo da marca."""
    canvas = Image.new("RGBA", (w, h), BG)
    d = ImageDraw.Draw(canvas)

    # Brilho sutil vermelho no canto, como o glow do site.
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-w * 0.35, h * 0.35, w * 0.55, h * 1.5], fill=(223, 10, 21, 46))
    canvas.alpha_composite(glow)

    # Logo a esquerda.
    size = int(h * 0.52)
    art = logo.resize((size, size), Image.LANCZOS)
    canvas.alpha_composite(art, (int(w * 0.07), (h - size) // 2))

    # Wordmark: MOVIE branco + FLIX vermelho, em fonte condensada.
    font = None
    for cand in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        if Path(cand).exists():
            font = ImageFont.truetype(cand, int(h * 0.20))
            break
    if font is None:
        font = ImageFont.load_default()

    x = int(w * 0.07) + size + int(w * 0.045)
    y = h // 2 - int(h * 0.10)
    d.text((x, y), "MOVIE", font=font, fill=(255, 255, 255, 255))
    wm = d.textlength("MOVIE", font=font)
    d.text((x + wm, y), "FLIX", font=font, fill=(223, 10, 21, 255))

    # Barrinha degradê vermelho→roxo embaixo, como o .section-title do site.
    bar_y = y + int(h * 0.24)
    bar_w = int(w * 0.30)
    for i in range(bar_w):
        t = i / max(1, bar_w - 1)
        r = int(223 + (139 - 223) * t)
        g = int(10 + (92 - 10) * t)
        b = int(21 + (246 - 21) * t)
        d.line([(x + i, bar_y), (x + i, bar_y + 3)], fill=(r, g, b, 255))

    return canvas


def make_splash(logo: Image.Image, px: int = 512) -> Image.Image:
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    inner = int(px * 0.55)
    art = logo.resize((inner, inner), Image.LANCZOS)
    off = (px - inner) // 2
    canvas.alpha_composite(art, (off, off))
    return canvas


def main() -> None:
    logo = load_logo()
    print(f"logo fonte: {SRC} {logo.size}")

    targets = [
        ROOT / "mobile" / "android" / "app" / "src" / "main" / "res",
        ROOT / "tv" / "android" / "app" / "src" / "main" / "res",
    ]

    for res in targets:
        for name, mult in DENSITIES.items():
            d = res / f"mipmap-{name}"
            d.mkdir(parents=True, exist_ok=True)

            px = int(48 * mult)
            make_launcher(logo, px, round_icon=False).save(d / "ic_launcher.png")
            make_launcher(logo, px, round_icon=True).save(d / "ic_launcher_round.png")

            # Foreground do adaptive icon: 108dp de canvas.
            fpx = int(108 * mult)
            fd = res / f"drawable-{name}"
            fd.mkdir(parents=True, exist_ok=True)
            make_adaptive_foreground(logo, fpx).save(fd / "ic_launcher_foreground.png")

        # Banner da TV e splash.
        nodpi = res / "drawable-nodpi"
        nodpi.mkdir(parents=True, exist_ok=True)
        make_tv_banner(logo).save(nodpi / "tv_banner.png")
        make_splash(logo).save(nodpi / "splash_logo.png")

        print(f"  ok: {res.relative_to(ROOT)}")

    # Icone do iOS: 1024x1024 sem alpha (exigencia da App Store).
    ios_icon = ROOT / "mobile" / "ios" / "MovieFlix" / "Assets.xcassets" / "AppIcon.appiconset"
    if ios_icon.exists():
        canvas = Image.new("RGB", (1024, 1024), BG[:3])
        art = logo.resize((880, 880), Image.LANCZOS)
        canvas.paste(art, (72, 72), art)
        canvas.save(ios_icon / "icon-1024.png")
        print(f"  ok: {ios_icon.relative_to(ROOT)}/icon-1024.png")


if __name__ == "__main__":
    main()
