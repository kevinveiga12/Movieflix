#!/usr/bin/env bash
# Captura uma tela por aba do app de TV.
#
# Historico do harness (cada tentativa ensinou algo):
#
#  1. Loop inline no `script:` do workflow quebrava: a action roda cada linha
#     num `sh -c` separado, entao o `for` chegava sem o `done`.
#  2. O passo "Botao Voltar" rodava antes e, na Home, o BACK saia do app — a
#     captura da aba 1 saiu com o launcher do Android. Agora o app e relancado.
#  3. DPAD_DOWN a partir do hero nao entrava no menu: o foco ficava no
#     conteudo. E os 10 itens do menu nao cabiam em 1080px (o item 10 ficava
#     fora da tela), o que tambem e um bug de design — corrigido reduzindo o
#     padding vertical de 11dp para 7dp.
#
# Agora o clique e por COORDENADA no menu lateral, que e deterministico e nao
# depende de onde o foco estava. O D-pad continua sendo testado a parte, no
# passo "foco do D-pad" do workflow.
set -u

OUT="${1:-screenshots}"
mkdir -p "$OUT"

echo "=== relancando o app de TV ==="
adb shell am force-stop run.velixir.movieflix.tv
sleep 2
adb shell am start -n run.velixir.movieflix.tv/.MainActivity
sleep 12

# Geometria do menu lateral, MEDIDA no screenshot real de 1920x1080
# (docs/apps-evidencias/tv-real-home.png) por deteccao das faixas de texto
# claro na coluna do menu. Os 10 itens ficam em:
#   228 315 399 483 567 651 735 819 903 987
# ou seja: primeiro em 228, passo de 84px. x=110 cai sobre o texto.
X=110
Y0=228
STEP=84

N=0
for LABEL in filmes series categorias buscar favoritos historico planos conta configuracoes; do
  N=$((N + 1))
  Y=$((Y0 + (N - 1) * STEP))
  echo "=== aba $LABEL em ($X,$Y) ==="
  adb shell input tap "$X" "$Y"
  sleep 4
  adb exec-out screencap -p > "$OUT/tv-tab-$N-$LABEL.png"
  python3 scripts/check-screenshot.py "$OUT/tv-tab-$N-$LABEL.png" "tv $LABEL"
done

echo "OK: abas da TV capturadas"
