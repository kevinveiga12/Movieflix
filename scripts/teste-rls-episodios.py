#!/usr/bin/env python3
"""Verifica duas coisas no Supabase real:

1. SEGURANÇA: um usuário comum consegue criar a própria assinatura?
   Se sim, qualquer pessoa se dá um plano premium de graça — falha de RLS.
2. Episódios: a rota de autorização resolve temporada/episódio corretamente?
"""
import json
import time
import urllib.request
import urllib.error

BASE = "https://mntyanfhxiqspdedmddb.supabase.co"
KEY = open("/workspace/analysis/anon.txt").read().strip()
API = "http://localhost:3001"
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


def main():
    email = f"rls-{int(time.time())}@movieflix-test.invalid"
    st, d = req(f"{BASE}/auth/v1/signup", "POST", {"email": email, "password": PASSWORD})
    token = d.get("access_token")
    uid = d.get("user", {}).get("id")
    print(f"Usuário de teste: {uid}")
    auth = {"Authorization": f"Bearer {token}"}

    print("\n=== TESTE 1: usuário comum pode criar a própria assinatura? ===")
    st, plans = req(f"{BASE}/rest/v1/plans?select=id,code&code=eq.premium")
    plan_id = plans[0]["id"]
    expires = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 365 * 86400))
    st, ins = req(
        f"{BASE}/rest/v1/subscriptions",
        "POST",
        {"user_id": uid, "plan_id": plan_id, "plan_code": "premium", "status": "active", "expires_at": expires},
        {**auth, "Prefer": "return=representation"},
    )
    print(f"  INSERT próprio: HTTP {st}")
    if st in (200, 201):
        print("  ⚠️  VULNERÁVEL: o usuário criou a própria assinatura premium.")
        print(f"     linha criada: {ins}")
        # Confirma que o servidor agora libera
        st2, d2 = req(f"{API}/api/playback/authorize", "POST", {"tmdbId": 278}, auth)
        print(f"  E o servidor liberou? allowed={d2.get('allowed')} (HTTP {st2})")
        # limpa
        req(f"{BASE}/rest/v1/subscriptions?user_id=eq.{uid}", "DELETE", None, auth)
        print("  assinatura de teste removida")
    else:
        print("  ✅ SEGURO: RLS bloqueia a criação pelo próprio usuário.")

    print("\n=== TESTE 2: autorização de episódio (série órfã) ===")
    st, d = req(f"{API}/api/db/series/17/episodes")
    print(f"  /api/db/series/17/episodes → HTTP {st} {str(d)[:120]}")

    print("\n=== TESTE 3: episódio inexistente ===")
    st, d = req(f"{API}/api/playback/authorize", "POST", {"tmdbId": 278, "season": 1, "episode": 1}, auth)
    print(f"  HTTP {st} → allowed={d.get('allowed')} reason={d.get('reason')} msg={d.get('message')}")


if __name__ == "__main__":
    main()
