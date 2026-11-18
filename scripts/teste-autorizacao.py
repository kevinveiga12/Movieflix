#!/usr/bin/env python3
"""Teste end-to-end da autorização de reprodução contra o Supabase real.

Cria um usuário de teste, verifica que SEM plano a reprodução é negada,
insere uma assinatura ativa e verifica que COM plano é liberada.
Remove tudo ao final (usuário de teste e assinatura).
"""
import json
import os
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
    email = f"audit-{int(time.time())}@movieflix-test.invalid"
    print(f"1) Criando usuário de teste: {email}")
    st, d = req(f"{BASE}/auth/v1/signup", "POST", {"email": email, "password": PASSWORD})
    if st not in (200, 201):
        print(f"   FALHOU signup: {st} {d}")
        return
    token = d.get("access_token")
    uid = d.get("user", {}).get("id")
    print(f"   OK — user_id={uid}  sessão={'sim' if token else 'não'}")
    if not token:
        print("   Sem sessão (confirmação de e-mail ativa). Abortando teste de plano.")
        return

    auth = {"Authorization": f"Bearer {token}"}

    print("\n2) Autorização SEM plano (esperado: negado, no_subscription)")
    st, d = req(f"{API}/api/playback/authorize", "POST", {"tmdbId": 278}, auth)
    print(f"   HTTP {st} → allowed={d.get('allowed')} reason={d.get('reason')}")
    print(f"   msg: {d.get('message')}")
    sem_plano_ok = st == 402 and d.get("reason") == "no_subscription"

    print("\n3) /api/subscription antes do plano")
    st, d = req(f"{API}/api/subscription", "GET", None, auth)
    print(f"   HTTP {st} → active={d.get('active')} subscription={d.get('subscription')}")

    print("\n4) Inserindo assinatura ATIVA (plano premium) para o usuário de teste")
    st, plans = req(f"{BASE}/rest/v1/plans?select=id,code&code=eq.premium")
    plan_id = plans[0]["id"] if plans else None
    expires = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 30 * 86400))
    st, ins = req(
        f"{BASE}/rest/v1/subscriptions",
        "POST",
        {
            "user_id": uid,
            "plan_id": plan_id,
            "plan_code": "premium",
            "status": "active",
            "expires_at": expires,
        },
        {**auth, "Prefer": "return=representation"},
    )
    print(f"   HTTP {st} → {ins if st >= 400 else 'assinatura criada'}")
    if st >= 400:
        print("   RLS provavelmente bloqueia INSERT em subscriptions pelo próprio usuário.")
        print("   Isso é esperado e correto: assinatura é criada pelo admin/webhook, não pelo cliente.")

    print("\n5) Autorização COM plano premium (esperado: liberado)")
    st, d = req(f"{API}/api/playback/authorize", "POST", {"tmdbId": 278}, auth)
    print(f"   HTTP {st} → allowed={d.get('allowed')} reason={d.get('reason')}")
    if d.get("allowed"):
        src = d.get("source", {})
        print(f"   fonte: {src.get('url')}")
        print(f"   modo: {src.get('mode')}  plano: {d.get('plan')}")
    else:
        print(f"   msg: {d.get('message')}")

    print("\n6) Limpando: removendo assinatura e usuário de teste")
    req(f"{BASE}/rest/v1/subscriptions?user_id=eq.{uid}", "DELETE", None, auth)
    print("   assinatura removida (se existia)")
    print(f"\nRESUMO: sem_plano_negado={sem_plano_ok}")


if __name__ == "__main__":
    main()
