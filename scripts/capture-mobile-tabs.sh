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
#
# O swipe anterior ia de 3/4 a 1/3 da tela e NAO rolava: a tela de Conta
# deslogada e curta (so o cartao "Voce nao esta logado" + botao Entrar), entao
# nao ha o que rolar e as tres capturas saiam identicas. Aqui o swipe e mais
# longo e, se a tela nao rolar, o resultado e o mesmo — mas o teste de Perfis
# abaixo nao depende mais dele.
echo "=== rolando a tela de Conta ==="
adb shell input swipe $((W / 2)) $((H * 4 / 5)) $((W / 2)) $((H / 5)) 400
sleep 2
adb exec-out screencap -p > "$OUT/mobile-conta-menu.png"
python3 scripts/check-screenshot.py "$OUT/mobile-conta-menu.png" "mobile conta menu"

# Perfis: acessivel pelo menu de Conta. Deslogado, a tela de Conta mostra
# apenas o botao "Entrar" — nao ha menu de itens para tocar. Entao a captura
# de Perfis e feita pelo botao Entrar -> tela de login, que e o que o usuario
# realmente ve nesse estado. Documentado aqui para nao parecer que a tela de
# Perfis foi testada quando nao foi.
echo "=== estado deslogado: Perfis leva ao login ==="
adb shell input tap $((W / 2)) $((H * 2 / 5))
sleep 3
adb exec-out screencap -p > "$OUT/mobile-perfis.png"
python3 scripts/check-screenshot.py "$OUT/mobile-perfis.png" "mobile perfis"

echo "OK: abas do mobile capturadas"

# ── Telas que exigem rota direta ────────────────────────────────────────────
# Planos e Player nao sao alcancaveis por toque simples no estado deslogado
# (Planos fica dentro de Conta, e o Player exige login). O app aceita o extra
# `mf_route` no intent justamente para o CI poder fotografar essas telas.
echo "=== Planos (rota direta) ==="
adb shell am force-stop run.velixir.movieflix
sleep 2
adb shell am start -n run.velixir.movieflix/.MainActivity --es mf_route plans
sleep 8
adb exec-out screencap -p > "$OUT/mobile-planos.png"
python3 scripts/check-screenshot.py "$OUT/mobile-planos.png" "mobile planos"

echo "=== Player (rota direta) ==="
adb shell am force-stop run.velixir.movieflix
sleep 2
adb shell am start -n run.velixir.movieflix/.MainActivity --es mf_route player
sleep 12
adb exec-out screencap -p > "$OUT/mobile-player.png"
python3 scripts/check-screenshot.py "$OUT/mobile-player.png" "mobile player" || echo "AVISO: player escuro (video) — nao falha o build"

echo "OK: telas extras do mobile capturadas"

# ── Diagnostico do embed ────────────────────────────────────────────────────
# Abre o provedor direto (sem login) para comprovar que o WebView entrega o
# player e nao a pagina de cloaking. A captura e comparada com a assinatura
# de cor da pagina branca do "Investidor.blog".
echo "=== Embed (diagnostico) ==="
adb shell am force-stop run.velixir.movieflix
sleep 2
adb shell am start -n run.velixir.movieflix/.MainActivity --es mf_route embed
sleep 16
adb exec-out screencap -p > "$OUT/mobile-embed.png"
python3 scripts/check-embed.py "$OUT/mobile-embed.png" "mobile embed" || echo "AVISO: embed nao confirmado"
