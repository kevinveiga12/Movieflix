#!/usr/bin/env bash
# Captura as telas de DETALHES do app de TV: filme, serie e o seletor de
# temporadas/episodios.
#
# Por que existe: a tela de detalhes e um LazyColumn longo. O carrossel de
# relacionados fica no FIM da tela e o seletor de temporadas fica logo abaixo
# da sinopse — nenhum dos dois aparece na primeira dobra. Navegar ate la por
# D-pad a partir da home seria fragil (depende da ordem das fileiras), entao a
# captura usa a rota de diagnostico `mf_route detail`, que abre a tela de um
# tmdb_id especifico direto.
#
# Os ids vem do proprio catalogo de producao e foram conferidos:
#   1744462  Grand Theft Auto VI: Um Olhar Estendido  (filme, top 200)
#   93166    The Capture                              (serie, 3 temporadas x 6 eps)
set -u

OUT="${1:-screenshots}"
mkdir -p "$OUT"

adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put secure anr_show_background 0 >/dev/null 2>&1 || true

# Rola a tela de detalhes ate o fim. A tela de detalhes NAO tem menu lateral
# (e uma rota de tela cheia), entao o D-pad move o foco dentro do LazyColumn e
# rola a lista. 14 descidas cobrem o hero + sinopse + temporadas + episodios +
# relacionados.
scroll_to_bottom() {
  for _ in $(seq 1 14); do
    adb shell input keyevent KEYCODE_DPAD_DOWN >/dev/null 2>&1 || true
    sleep 0.4
  done
  sleep 2
}

# ── Filme ────────────────────────────────────────────────────────────────────
echo "=== Detalhes de FILME (1744462) ==="
adb shell am force-stop run.velixir.movieflix.tv
sleep 2
adb shell am start -n run.velixir.movieflix.tv/.MainActivity \
  --es mf_route detail --es mf_url 1744462
sleep 14
bash scripts/shot.sh "$OUT/tv-detail-movie-top.png" "tv detalhe filme topo"

echo "=== Detalhes de FILME: rolando ate os relacionados ==="
scroll_to_bottom
bash scripts/shot.sh "$OUT/tv-detail-movie-related.png" "tv detalhe filme relacionados"

# ── Serie ────────────────────────────────────────────────────────────────────
echo "=== Detalhes de SERIE (93166) ==="
adb shell am force-stop run.velixir.movieflix.tv
sleep 2
adb shell am start -n run.velixir.movieflix.tv/.MainActivity \
  --es mf_route detail --es mf_url 93166 --es mf_type tv
sleep 14
bash scripts/shot.sh "$OUT/tv-detail-series-top.png" "tv detalhe serie topo"

echo "=== Detalhes de SERIE: temporadas e episodios ==="
# 6 descidas chegam ao seletor de temporadas, logo abaixo da sinopse.
for _ in $(seq 1 6); do
  adb shell input keyevent KEYCODE_DPAD_DOWN >/dev/null 2>&1 || true
  sleep 0.4
done
sleep 2
bash scripts/shot.sh "$OUT/tv-detail-series-seasons.png" "tv serie temporadas"

# ── TROCA DE TEMPORADA ───────────────────────────────────────────────────────
# Prova que escolher outra temporada troca a LISTA DE EPISÓDIOS, e não só o
# rótulo do botão. O foco está na fileira de temporadas depois das descidas
# acima; uma seta à direita seleciona a Temporada 2 e OK confirma.
echo "=== Detalhes de SERIE: trocando para a Temporada 2 ==="
adb shell input keyevent KEYCODE_DPAD_RIGHT >/dev/null 2>&1 || true
sleep 1
adb shell input keyevent KEYCODE_DPAD_CENTER >/dev/null 2>&1 || true
sleep 3
bash scripts/shot.sh "$OUT/tv-detail-series-season2.png" "tv serie temporada 2"

echo "=== Detalhes de SERIE: rolando ate os relacionados ==="
scroll_to_bottom
bash scripts/shot.sh "$OUT/tv-detail-series-related.png" "tv serie relacionados"

adb shell pidof run.velixir.movieflix.tv && echo "TV VIVO NOS DETALHES" || echo "TV MORTO NOS DETALHES"
adb logcat -d -b crash | tail -40 || true

echo "OK: telas de detalhes da TV capturadas"
