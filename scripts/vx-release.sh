#!/usr/bin/env bash
# Espera o release da Velixir terminar e, se compilou, PUBLICA.
#
# Por que existe: o auto-deploy por push esbarra no 404 de retencao de fonte
# (docs/DEPLOY_VELIXIR.md). Publicar = POST /deployments com o releaseId de um
# release `Succeeded`. Fazer isso a mao a cada release e onde se erra; este
# script espera o build, publica e confirma o health — sem reenviar fonte e sem
# publicar nada se o build falhar.
#
# Uso:  VELIXIR_API_KEY=vx_... ./scripts/vx-release.sh [versao|latest]
# Exit: 0 publicado e Healthy | 2 build falhou (nada publicado) | 3 sem health
set -euo pipefail

: "${VELIXIR_API_KEY:?defina VELIXIR_API_KEY}"
BASE=https://velixir.net
APP=ff356224-47e9-44d4-b54b-499c4fe1f990
ALVO="${1:-latest}"
SITE=https://movieflix.velixir.run

TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

api() { curl -s -H "X-API-Key: $VELIXIR_API_KEY" "$@"; }
listar() { api "$BASE/api/v1/apps/$APP/releases" > "$TMP"; }
campo() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1',''))"; }

# Um release (linha JSON) do arquivo de releases.
pick() {
  python3 - "$1" "$2" > "$TMP.pick" <<'PY'
import json, sys
rels = json.load(open(sys.argv[1]))
alvo = sys.argv[2]
if alvo == 'latest':
    print(json.dumps(rels[0]) if rels else '{}')
else:
    achados = [r for r in rels if str(r['version']) == alvo]
    print(json.dumps(achados[0]) if achados else '{}')
PY
  cat "$TMP.pick"
}

listar
REL="$(pick "$TMP" "$ALVO")"
VER="$(printf '%s' "$REL" | campo version)"
RID="$(printf '%s' "$REL" | campo id)"
ST="$(printf '%s' "$REL" | campo buildStatus)"
SHA="$(printf '%s' "$REL" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commitSha","")[:7])')"

[ -n "$RID" ] || { echo "release nao encontrado"; exit 1; }
echo "release v$VER ($RID) status=$ST commit=$SHA"

# Espera sair de Uploading/Building/Queued (ate ~10 min).
for _ in $(seq 1 60); do
  case "$ST" in
    Uploading|Building|Queued|"") ;;
    *) break ;;
  esac
  sleep 10
  listar
  ST="$(pick "$TMP" "$VER" | campo buildStatus)"
  echo "  ... ${ST:-aguardando}"
done

if [ "$ST" != "Succeeded" ]; then
  echo "build NAO compilou ($ST) — nada foi publicado. Log:"
  api "$BASE/api/v1/releases/$RID/build-log" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("log") or "")[:800])'
  exit 2
fi

echo "publicando v$VER em production..."
api -H "Content-Type: application/json" -X POST \
  -d "{\"releaseId\":\"$RID\"}" "$BASE/api/v1/apps/$APP/deployments" | head -c 400
echo

# Confirma troca real de pods: status ok + uptime baixo.
for _ in $(seq 1 30); do
  H="$(curl -s "$SITE/api/health")"
  OK="$(printf '%s' "$H" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
  UP="$(printf '%s' "$H" | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("uptimeSeconds",9999)))' 2>/dev/null || echo 9999)"
  INI="$(printf '%s' "$H" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("startedAt",""))' 2>/dev/null || true)"
  if [ "$OK" = "ok" ] && [ "$UP" -lt 180 ]; then
    echo "healthy: status=$OK startedAt=$INI uptime=${UP}s"
    exit 0
  fi
  sleep 10
done
echo "deploy enviado, mas o health nao mostrou pods novos — conferir manualmente"
exit 3
