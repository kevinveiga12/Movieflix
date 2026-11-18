#!/usr/bin/env bash
# Captura de tela com retry.
#
# O emulador de TV as vezes falha ao compor o frame e o `screencap` devolve
# uma imagem toda preta, mesmo com o app vivo (o log mostra
# "Failed to find ColorBuffer" / "Failed to bind to texture"). Isso e um
# glitch de GPU do emulador, nao um defeito do app: na execucao anterior, com
# o MESMO APK, a captura da home saiu perfeita.
#
# Aqui a captura e repetida ate sair um frame com conteudo de verdade.
set -u

OUT="$1"
LABEL="${2:-tela}"
TRIES="${3:-6}"

for i in $(seq 1 "$TRIES"); do
  adb exec-out screencap -p > "$OUT" 2>/dev/null
  if python3 scripts/check-screenshot.py "$OUT" "$LABEL" >/dev/null 2>&1; then
    echo "  captura ok na tentativa $i"
    python3 scripts/check-screenshot.py "$OUT" "$LABEL"
    exit 0
  fi
  echo "  tentativa $i sem conteudo (glitch de GPU do emulador), repetindo…"
  sleep 3
done

echo "FALHA: $LABEL continuou sem conteudo apos $TRIES tentativas"
python3 scripts/check-screenshot.py "$OUT" "$LABEL"
exit 1
