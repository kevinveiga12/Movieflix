#!/usr/bin/env bash
# Captura uma tela por aba do app de TV, navegando SO com o D-pad.
#
# Mesmo motivo do capture-mobile-tabs.sh: a action do emulador roda cada linha
# do `script:` num `sh -c` separado, entao loops inline quebram. Aqui o loop
# roda inteiro dentro de um arquivo.
set -u

OUT="${1:-screenshots}"
mkdir -p "$OUT"

# O menu lateral tem 10 itens. O foco comeca em "Início" (item 0).
# Descer uma vez e apertar OK abre o proximo item.
N=0
for LABEL in filmes series categorias buscar favoritos historico planos conta configuracoes; do
  N=$((N + 1))
  echo "=== aba $LABEL (item $N) ==="
  adb shell input keyevent KEYCODE_DPAD_DOWN
  sleep 1
  adb shell input keyevent KEYCODE_DPAD_CENTER
  sleep 4
  adb exec-out screencap -p > "$OUT/tv-tab-$N-$LABEL.png"
  python3 scripts/check-screenshot.py "$OUT/tv-tab-$N-$LABEL.png" "tv $LABEL"
done

echo "OK: abas da TV capturadas"
