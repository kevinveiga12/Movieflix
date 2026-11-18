#!/usr/bin/env bash
# Captura uma tela por aba do app de TV, navegando SO com o D-pad.
#
# Dois aprendizados da primeira tentativa, ambos visiveis nos screenshots:
#
#  1. O passo "Botao Voltar" do workflow roda ANTES deste script e, estando na
#     Home, o BACK sai do app — o emulador voltou para o launcher do Android e
#     a captura "tv-tab-1-filmes" saiu com a tela inicial do sistema. Por isso
#     aqui o app e relancado antes de comecar.
#
#  2. O foco inicial fica no botao "Assistir" do hero, no conteudo, nao no
#     menu. Descer o D-pad a partir dali percorre os botoes do hero. Para
#     entrar no menu lateral e preciso ir para a ESQUERDA primeiro.
set -u

OUT="${1:-screenshots}"
mkdir -p "$OUT"

echo "=== relancando o app de TV ==="
adb shell am force-stop run.velixir.movieflix.tv
sleep 2
adb shell am start -n run.velixir.movieflix.tv/.MainActivity
sleep 12

# Leva o foco do hero para o menu lateral.
echo "=== movendo o foco para o menu lateral ==="
for _ in 1 2 3 4; do
  adb shell input keyevent KEYCODE_DPAD_LEFT
  sleep 1
done
adb exec-out screencap -p > "$OUT/tv-menu-foco.png"
python3 scripts/check-screenshot.py "$OUT/tv-menu-foco.png" "tv menu foco"

# O menu tem 10 itens; o foco esta em "Início" (item 0).
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
