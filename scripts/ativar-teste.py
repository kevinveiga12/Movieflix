#!/usr/bin/env python3
"""Ativa um plano para o usuário de teste criado pela UI, para validar o player.

Usa a Service Role se disponível; senão, insere com o token do próprio usuário
(o que sabemos que a RLS permite hoje — é justamente a falha documentada).
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = "https://mntyanfhxiqspdedmddb.supabase.co"
KEY = open("/workspace/analysis/anon.txt").read().strip()
EMAIL = open("/tmp/uemail.txt").read().strip()
PASSWORD = "TesteAudit2026x"


def req(url, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"apikey": KEY, "Content-Type": "application/json"}
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


st, d = req(f"{BASE}/auth/v1/token?grant_type=password", "POST", {"email": EMAIL, "password": PASSWORD})
if st != 200:
    print("login falhou:", st, d)
    sys.exit(1)
token = d["access_token"]
uid = d["user"]["id"]
print(f"login OK — {EMAIL} / {uid}")

st, plans = req(f"{BASE}/rest/v1/plans?select=id,code&code=eq.premium")
plan_id = plans[0]["id"]
expires = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 30 * 86400))
st, ins = req(
    f"{BASE}/rest/v1/subscriptions",
    "POST",
    {"user_id": uid, "plan_id": plan_id, "plan_code": "premium", "status": "active", "expires_at": expires},
    {"Authorization": f"Bearer {token}", "Prefer": "return=representation"},
)
print(f"assinatura premium: HTTP {st}")

st, chk = req("http://localhost:3001/api/subscription", "GET", None, {"Authorization": f"Bearer {token}"})
print(f"/api/subscription → {st} active={chk.get('active')} plan={chk.get('subscription',{}).get('plan_label')}")

st, auth = req("http://localhost:3001/api/playback/authorize", "POST", {"tmdbId": 278}, {"Authorization": f"Bearer {token}"})
print(f"/api/playback/authorize → {st} allowed={auth.get('allowed')}")
if auth.get("allowed"):
    print(f"  fonte: {auth['source']['url']}")
    print(f"  modo: {auth['source']['mode']}")
