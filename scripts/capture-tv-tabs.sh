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

# ORDEM IMPORTA. "Conta" e "Perfis" levam a tela de LOGIN quando o app esta
# deslogado (comportamento correto: nao ha perfil para mostrar). A tela de
# login abre o teclado virtual, que cobre o rodape da tela — e o toque
# seguinte, que deveria cair no menu lateral, caia no teclado. Foi assim que a
# captura de "Configuracoes" saiu mostrando o login.
#
# Por isso as abas que NAO exigem login vem primeiro, e as duas que exigem
# ficam por ultimo. Antes de cada toque o teclado e fechado.
N=0
# Cada entrada e "indice_no_menu:rotulo". O indice e a posicao REAL do item no
# menu lateral (1=Inicio, 2=Filmes, ... 11=Configuracoes) — nao o contador do
# loop. A ordem de VISITA e outra: as abas que nao exigem login primeiro.
for PAIR in 2:filmes 3:series 4:categorias 5:buscar 6:favoritos 7:historico 8:planos 11:configuracoes 9:conta 10:perfis; do
  IDX=${PAIR%%:*}
  LABEL=${PAIR##*:}
  N=$((N + 1))
  Y=$(echo "$ROWS" | sed -n "${IDX}p")
  if [ -z "$Y" ]; then
    echo "AVISO: sem coordenada para a aba $LABEL (item $IDX) — pulando"
    continue
  fi
  # Fecha o teclado virtual, se estiver aberto, para nao engolir o toque.
  adb shell input keyevent KEYCODE_ESCAPE >/dev/null 2>&1 || true
  sleep 1
  echo "=== aba $LABEL (menu #$IDX) em ($X,$Y) ==="
  adb shell input tap "$X" "$Y"
  sleep 4
  adb exec-out screencap -p > "$OUT/tv-tab-$N-$LABEL.png"
  python3 scripts/check-screenshot.py "$OUT/tv-tab-$N-$LABEL.png" "tv $LABEL"
done

rm -f "$OUT/_tv-menu-ref.png"
echo "OK: abas da TV capturadas"

# ── Telas que exigem rota direta ────────────────────────────────────────────
echo "=== Planos (rota direta) ==="
adb shell am force-stop run.velixir.movieflix.tv
sleep 2
adb shell am start -n run.velixir.movieflix.tv/.MainActivity --es mf_route plans
sleep 10
bash scripts/shot.sh "$OUT/tv-planos.png" "tv planos"

echo "=== Player (rota direta) ==="
adb shell am force-stop run.velixir.movieflix.tv
sleep 2
adb shell am start -n run.velixir.movieflix.tv/.MainActivity --es mf_route player
sleep 14
bash scripts/shot.sh "$OUT/tv-player.png" "tv player" || echo "AVISO: player escuro (video) — nao falha o build"

echo "OK: telas extras da TV capturadas"
