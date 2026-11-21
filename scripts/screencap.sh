#!/usr/bin/env bash
# Captura uma tela do emulador, com retry.
#
# `adb exec-out screencap -p` falha de vez em quando no emulador do runner
# ("error: closed") — é a GPU em swiftshader engasgando, não o app. Sem retry,
# uma falha dessas aborta o script inteiro e o build perde as capturas (e, antes
# do continue-on-error, perdia os APKs também).
#
# Uso: bash scripts/screencap.sh screenshots/mobile-home.png
set -u

OUT="${1:?uso: screencap.sh <arquivo.png>}"
mkdir -p "$(dirname "$OUT")"

for attempt in 1 2 3 4 5; do
  if adb exec-out screencap -p > "$OUT" 2>/dev/null && [ -s "$OUT" ]; then
    # Um PNG válido começa com a assinatura \x89PNG.
    if head -c 4 "$OUT" | grep -q $'\x89PNG'; then
      echo "capturado: $OUT (tentativa $attempt)"
      exit 0
    fi
  fi
  echo "screencap falhou (tentativa $attempt), tentando de novo…"
  sleep 3
done

echo "AVISO: não foi possível capturar $OUT — seguindo sem esta imagem"
rm -f "$OUT"
# Sai com 0: a captura é evidência, não pré-requisito do build.
exit 0
