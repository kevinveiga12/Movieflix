#!/usr/bin/env python3
"""
Localiza as linhas de texto do menu lateral do app de TV num screenshot.

Por que existe: a captura por coordenada fixa quebrou duas vezes. Primeiro
porque os 10 itens do menu não cabiam em 1080px; depois porque, ao mudar o
padding e a fonte para caberem 11 itens, todas as coordenadas antigas
passaram a apontar para o item errado — e a captura da aba "Configurações"
saiu mostrando a tela de login.

Aqui a posição de cada item é MEDIDA na imagem, não presumida. Se o layout
mudar de novo, a captura continua correta sem ninguém recalcular nada.

Uso:
    python3 scripts/find-menu-rows.py tela.png [--min-y 190]

Imprime um centro de linha por linha de saída (y em pixels), de cima para
baixo. O `--min-y` corta o cabeçalho (logo + subtítulo), que também tem texto
na mesma coluna.
"""
import sys

try:
    from PIL import Image
except ImportError:
    print("FALHA: Pillow nao instalado (pip install pillow)", file=sys.stderr)
    sys.exit(2)

# Coluna do menu lateral. O menu tem 232dp de largura; em 1920px de tela isso
# fica em ~232px. Amostrar de 20 a 240 pega o texto sem encostar no conteudo.
X0, X1 = 20, 240

# Um pixel conta como "texto" acima deste brilho. O fundo do menu e #17171f
# (brilho ~23) e o texto e branco ou cinza claro (brilho > 150).
BRIGHT = 90

# Uma linha de texto precisa de pelo menos tantos pixels claros na faixa.
MIN_PX = 6

# Altura minima de uma faixa para ser considerada uma linha de texto.
MIN_H = 8


def find_rows(path: str, min_y: int = 190) -> list[int]:
    im = Image.open(path).convert("L")
    w, h = im.size
    px = im.load()

    counts = []
    for y in range(h):
        c = 0
        for x in range(X0, min(X1, w)):
            if px[x, y] > BRIGHT:
                c += 1
        counts.append(c)

    bands = []
    start = None
    for y, c in enumerate(counts):
        if c >= MIN_PX:
            if start is None:
                start = y
        else:
            if start is not None:
                if y - start >= MIN_H:
                    bands.append((start, y - 1))
                start = None
    if start is not None and h - start >= MIN_H:
        bands.append((start, h - 1))

    centers = [(a + b) // 2 for a, b in bands]
    return [c for c in centers if c >= min_y]


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: find-menu-rows.py <imagem.png> [--min-y N]", file=sys.stderr)
        return 2

    path = sys.argv[1]
    min_y = 190
    if "--min-y" in sys.argv:
        min_y = int(sys.argv[sys.argv.index("--min-y") + 1])

    rows = find_rows(path, min_y)
    for r in rows:
        print(r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
