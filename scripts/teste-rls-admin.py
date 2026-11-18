#!/usr/bin/env python3
"""Verifica se um usuário comum consegue se promover a administrador.

Se `profiles.is_admin` for gravável pelo próprio usuário, o painel
administrativo inteiro está exposto — é a falha mais grave possível aqui.
"""
import json
import time
import urllib.request
import urllib.error

BASE = "https://mntyanfhxiqspdedmddb.supabase.co"
KEY = open("/workspace/analysis/anon.txt").read().strip()
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
    email = f"adm-{int(time.time())}@movieflix-test.invalid"
    st, d = req(f"{BASE}/auth/v1/signup", "POST", {"email": email, "password": PASSWORD})
    token = d.get("access_token")
    uid = d.get("user", {}).get("id")
    auth = {"Authorization": f"Bearer {token}"}
    print(f"Usuário de teste: {uid}")

    print("\n=== 1) Perfil foi criado automaticamente pelo trigger? ===")
    st, prof = req(f"{BASE}/rest/v1/profiles?select=id,email,name,is_admin&id=eq.{uid}", "GET", None, auth)
    print(f"  HTTP {st} → {prof}")

    print("\n=== 2) Usuário consegue se promover a admin? ===")
    st, upd = req(
        f"{BASE}/rest/v1/profiles?id=eq.{uid}",
        "PATCH",
        {"is_admin": True},
        {**auth, "Prefer": "return=representation"},
    )
    print(f"  PATCH is_admin=true → HTTP {st}")
    if st in (200, 204):
        st2, check = req(f"{BASE}/rest/v1/profiles?select=is_admin&id=eq.{uid}", "GET", None, auth)
        print(f"  valor depois: {check}")
        if check and check[0].get("is_admin") is True:
            print("  ⚠️  VULNERÁVEL: usuário comum virou administrador.")
            req(f"{BASE}/rest/v1/profiles?id=eq.{uid}", "PATCH", {"is_admin": False}, auth)
            print("  revertido para false")
        else:
            print("  ✅ SEGURO: o valor não mudou (trigger/proteção de coluna).")
    else:
        print(f"  ✅ SEGURO: bloqueado ({upd})")

    print("\n=== 3) Usuário consegue ler perfis de OUTROS usuários? ===")
    st, allp = req(f"{BASE}/rest/v1/profiles?select=id,email,is_admin&limit=5", "GET", None, auth)
    n = len(allp) if isinstance(allp, list) else 0
    print(f"  HTTP {st} → {n} linha(s) visíveis")
    if n > 1:
        print("  ⚠️  ATENÇÃO: vê perfis de terceiros (vazamento de e-mails).")
    else:
        print("  ✅ Só vê o próprio perfil.")

    print("\n=== 4) Usuário consegue ler assinaturas de outros? ===")
    st, subs = req(f"{BASE}/rest/v1/subscriptions?select=user_id,plan_code,status&limit=5", "GET", None, auth)
    n = len(subs) if isinstance(subs, list) else 0
    print(f"  HTTP {st} → {n} linha(s) visíveis")
    if n > 1:
        print("  ⚠️  ATENÇÃO: vê assinaturas de terceiros.")
    else:
        print("  ✅ Só vê as próprias.")


if __name__ == "__main__":
    main()
