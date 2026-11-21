#!/usr/bin/env bash
# Captura as telas do app mobile (casca WebView) no emulador.
#
# O app mobile deixou de ser nativo: ele carrega o site publicado em um WebView.
# Por isso não existem mais rotas internas (`mf_route`) para dirigir — a
# navegação é a do próprio site, pela barra inferior. Aqui abrimos o app,
# esperamos a página carregar e tocamos nas abas por coordenada.
#
# Uso: bash scripts/capture-shell-tabs.sh screenshots
set -u

OUT="${1:-screenshots}"
PKG="run.velixir.movieflix"
ACTIVITY="$PKG/run.velixir.movieflix.shell.MainActivity"
mkdir -p "$OUT"

# Tamanho da tela do emulador (pixel_6 = 1080x2400).
SIZE=$(adb shell wm size | sed -n 's/.*: \([0-9]*x[0-9]*\).*/\1/p')
W=${SIZE%x*}
H=${SIZE#*x}
[ -z "${W:-}" ] && W=1080 && H=2400

# A barra inferior tem 6 itens distribuídos na largura; o centro de cada um é
# (i + 0.5) / 6 * W. A barra fica a ~40dp do fundo.
TAB_Y=$((H - 60))
tab_x() { echo $(( (W * (2 * $1 + 1)) / 12 )); }

shot() {
  bash scripts/screencap.sh "$OUT/$1.png"
  echo "capturado: $OUT/$1.png"
}

echo "=== Abrindo o app mobile (casca) ==="
adb shell am force-stop "$PKG" || true
adb shell am start -n "$ACTIVITY"
# A primeira carga baixa o site inteiro; 20s cobre rede lenta do runner.
sleep 20
shot mobile-home

echo "=== Processo vivo? ==="
adb shell pidof "$PKG" && echo "MOBILE VIVO" || echo "MOBILE MORTO"

echo "=== Log de crash ==="
adb logcat -d -b crash | tail -40 || true

# Abas: Início, Filmes, Séries, Favoritos, Histórico, Planos
i=0
for name in filmes series favoritos historico planos; do
  i=$((i + 1))
  adb shell input tap "$(tab_x $i)" "$TAB_Y"
  sleep 4
  shot "mobile-$name"
done

# Volta para o início.
adb shell input tap "$(tab_x 0)" "$TAB_Y"
sleep 3
shot mobile-inicio

echo "=== Fim das capturas do app mobile ==="
