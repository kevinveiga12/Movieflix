#!/usr/bin/env bash
# Captura uma tela por aba do app mobile.
#
# Por que um script e nao um loop inline no workflow: a action
# reactivecircus/android-emulator-runner executa CADA LINHA do `script:` num
# `sh -c` separado. Um `for ... do ... done` inline chega ao shell sem o `done`
# e morre com "Syntax error: end of file unexpected". Num arquivo .sh o loop
# roda inteiro.
set -u

OUT="${1:-screenshots}"
mkdir -p "$OUT"

# O emulador as vezes mostra "Pixel Launcher isn't responding" por cima do app.
# Nao e defeito do MovieFlix, mas polui a evidencia visual.
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put secure anr_show_background 0 >/dev/null 2>&1 || true

# Tamanho real da tela do emulador (ex.: "1080x2400").
SIZE=$(adb shell wm size | sed 's/.*: //' | tr -d '\r')
W=${SIZE%x*}
H=${SIZE#*x}
echo "tela: ${W}x${H}"

# A barra inferior tem 5 abas de largura igual: o centro da aba i (0..4) fica
# em x = W*(2i+1)/10.
#
# A ALTURA importa: medindo o screenshot real (1080x2400), o fundo da barra
# (#121218) comeca em y~2150 e os ICONES ficam em y~2200-2290. Tocar em
# H-60 = 2340 cai no padding vazio abaixo dos icones e NAO troca de aba —
# foi exatamente o que aconteceu na primeira tentativa. H-150 = 2250 acerta
# o centro dos icones.
Y=$((H - 150))
echo "tocando na barra em y=$Y"

# Aba 0 (Inicio) ja foi capturada como mobile-home.png.
i=0
for TAB in filmes series buscar conta; do
  i=$((i + 1))
  X=$(( W * (2 * i + 1) / 10 ))
  echo "=== aba $TAB em ($X,$Y) ==="
  adb shell input tap "$X" "$Y"
  sleep 4
  adb exec-out screencap -p > "$OUT/mobile-$TAB.png"
  python3 scripts/check-screenshot.py "$OUT/mobile-$TAB.png" "mobile $TAB"
done

# Dentro de Conta, rola para baixo para mostrar o menu completo
# (Perfis, Favoritos, Historico, Planos, Configuracoes).
echo "=== rolando a tela de Conta ==="
adb shell input swipe $((W / 2)) $((H * 3 / 4)) $((W / 2)) $((H / 3)) 300
sleep 2
adb exec-out screencap -p > "$OUT/mobile-conta-menu.png"
python3 scripts/check-screenshot.py "$OUT/mobile-conta-menu.png" "mobile conta menu"

# Perfis: a partir do menu de Conta, o primeiro item e "Perfis". Tocar nele
# abre a tela de perfis — que antes nao tinha captura nenhuma.
echo "=== abrindo Perfis ==="
adb shell input tap $((W / 2)) $((H * 2 / 5))
sleep 3
adb exec-out screencap -p > "$OUT/mobile-perfis.png"
python3 scripts/check-screenshot.py "$OUT/mobile-perfis.png" "mobile perfis"

echo "OK: abas do mobile capturadas"
