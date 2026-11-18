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
#     conteudo. Por isso o clique passou a ser por COORDENADA.
#  4. As coordenadas eram FIXAS (228, passo 84). Quando o menu ganhou o item
#     "Perfis" e o padding/fonte mudaram para caber 11 itens, todas as
#     coordenadas antigas passaram a apontar para o item errado — a captura da
#     aba "Configuracoes" saiu mostrando a tela de login.
#
# Agora a posicao de cada item e MEDIDA na imagem por find-menu-rows.py, que
# detecta as faixas de texto claro na coluna do menu. Se o layout mudar de
# novo, a captura continua correta sem ninguem recalcular nada.
set -u

OUT="${1:-screenshots}"
mkdir -p "$OUT"

# O emulador as vezes mostra "Pixel Launcher isn't responding" por cima do app.
# Nao e defeito do MovieFlix, mas polui a evidencia visual. Desligar os
# dialogos de erro do sistema resolve.
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put secure anr_show_background 0 >/dev/null 2>&1 || true

echo "=== relancando o app de TV ==="
adb shell am force-stop run.velixir.movieflix.tv
sleep 2
adb shell am start -n run.velixir.movieflix.tv/.MainActivity
sleep 12

# Captura de referencia para medir o menu.
adb exec-out screencap -p > "$OUT/_tv-menu-ref.png" 2>/dev/null

# Mede as linhas do menu. O --min-y 190 corta o cabecalho (logo + subtitulo).
ROWS=$(python3 scripts/find-menu-rows.py "$OUT/_tv-menu-ref.png" --min-y 190)
COUNT=$(echo "$ROWS" | grep -c . || true)
echo "=== itens de menu detectados: $COUNT ==="
echo "$ROWS" | tr '\n' ' '
echo

if [ "$COUNT" -lt 11 ]; then
  echo "AVISO: esperados 11 itens (Inicio..Configuracoes), detectados $COUNT."
  echo "       O menu pode estar cortando itens — verificar o layout."
fi

# x=110 cai sobre o texto do menu (o menu tem 232dp de largura).
X=110

N=0
for LABEL in filmes series categorias buscar favoritos historico planos conta perfis configuracoes; do
  N=$((N + 1))
  Y=$(echo "$ROWS" | sed -n "${N}p")
  if [ -z "$Y" ]; then
    echo "AVISO: sem coordenada para a aba $LABEL (item $N) — pulando"
    continue
  fi
  echo "=== aba $LABEL em ($X,$Y) ==="
  adb shell input tap "$X" "$Y"
  sleep 4
  adb exec-out screencap -p > "$OUT/tv-tab-$N-$LABEL.png"
  python3 scripts/check-screenshot.py "$OUT/tv-tab-$N-$LABEL.png" "tv $LABEL"
done

rm -f "$OUT/_tv-menu-ref.png"
echo "OK: abas da TV capturadas"
