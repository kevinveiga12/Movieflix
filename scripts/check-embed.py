#!/usr/bin/env python3
"""
Verifica se a captura do embed mostra o player e nao a pagina de cloaking.

Contexto: o provedor myembed.biz devolve, quando nao recebe o Referer do site,
uma pagina branca do "Investidor.blog" (94.951 bytes de HTML). Essa pagina e
clara — fundo branco com texto escuro. O player real e escuro (fundo preto com
o video). Entao a assinatura que separa os dois casos e a luminosidade media:

  pagina de cloaking  -> luminosidade alta (fundo branco)
  player              -> luminosidade baixa (fundo preto)

Nao e um teste de "o video esta tocando" — e um teste de "nao e a pagina
errada". Se a captura for clara, o Referer nao chegou e o bug voltou.
"""
import sys
from PIL import Image


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: check-embed.py <png> [rotulo]")
        return 2

    path = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else path

    im = Image.open(path).convert("RGB")
    w, h = im.size
    small = im.resize((60, 60))

    pixels = list(small.getdata())
    lum = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in pixels]
    avg = sum(lum) / len(lum)

    # Proporcao de pixels claros: a pagina de cloaking e quase toda branca.
    bright = sum(1 for v in lum if v > 200) / len(lum)

    print(f"{label}: {w}x{h} luminosidade media={avg:.1f} pixels claros={bright:.1%}")

    if bright > 0.55:
        print(f"FALHA: {label} parece a pagina branca de cloaking (fundo claro).")
        print("       O Referer do site nao chegou ao provedor.")
        return 1

    print(f"OK: {label} tem fundo escuro — nao e a pagina de cloaking.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
