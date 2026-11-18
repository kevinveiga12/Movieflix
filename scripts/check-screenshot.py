#!/usr/bin/env python3
"""
Verifica que um screenshot de app NÃO é uma tela preta.

Motivo: "compilou" não prova que o app abre. A tela preta é o sintoma exato do
bug que este projeto teve, e ela passa em qualquer teste que só olhe o build.
Aqui a evidência é o pixel.

Uso:  python3 scripts/check-screenshot.py tela.png [rotulo]
Sai com código 1 se a imagem for praticamente toda preta.
"""
import sys

try:
    from PIL import Image
except ImportError:
    print("FALHA: Pillow não instalado (pip install pillow)")
    sys.exit(2)


def main(path: str, label: str = "") -> int:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()

    # Amostra uma grade ampla: centro, quadrantes e bordas.
    points = [
        (w // 2, h // 2),
        (w // 4, h // 2),
        (3 * w // 4, h // 2),
        (w // 2, h // 4),
        (w // 2, 3 * h // 4),
        (w // 8, h // 8),
        (7 * w // 8, 7 * h // 8),
        (w // 2, h // 8),
    ]
    samples = [px[x, y] for x, y in points]
    bright = sum(1 for c in samples if sum(c) > 60)

    print(f"=== {label or path} ({w}x{h}) ===")
    print(f"  amostras: {samples}")
    print(f"  amostras não-pretas: {bright}/{len(samples)}")

    if bright == 0:
        print(f"FALHA: {label or path} é uma tela preta — o app não desenhou nada.")
        return 1

    print(f"  OK: {label or path} desenhou interface")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("uso: check-screenshot.py <imagem.png> [rotulo]")
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""))
