#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Testes headless do controle remoto do player da TV.
#
# Compila a lógica PURA (tv/.../player/TvPlayerControls.kt) com o kotlinc e roda
# os testes em JVM. Não precisa de Android SDK, emulador nem TV.
#
#   bash scripts/test-tv-player.sh
#
# Sai com código 1 se algum teste falhar — é o que o CI usa.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/tv/android/app/src/main/java/run/velixir/movieflix/tv/player/TvPlayerControls.kt"
MOUSE="$ROOT/tv/android/app/src/main/java/run/velixir/movieflix/tv/player/VirtualMouse.kt"
TEST="$ROOT/scripts/tv-player-tests/TvPlayerControlsTest.kt"
OUT="${TMPDIR:-/tmp}/movieflix-tv-player-tests"

KOTLINC="${KOTLINC:-kotlinc}"
if ! command -v "$KOTLINC" >/dev/null 2>&1; then
  if [ -x /opt/kotlinc/kotlinc/bin/kotlinc ]; then
    KOTLINC=/opt/kotlinc/kotlinc/bin/kotlinc
  else
    echo "kotlinc não encontrado. Instale o compilador Kotlin ou defina KOTLINC=." >&2
    exit 2
  fi
fi

echo "kotlinc: $($KOTLINC -version 2>&1 | head -1)"
rm -rf "$OUT" && mkdir -p "$OUT"

echo "Compilando…"
"$KOTLINC" "$SRC" "$MOUSE" "$TEST" -include-runtime -d "$OUT/tests.jar" 2>&1 | grep -v '^warning:' || true

if [ ! -f "$OUT/tests.jar" ]; then
  echo "FALHOU: a compilação não gerou o jar." >&2
  exit 1
fi

echo "Executando…"
java -jar "$OUT/tests.jar"