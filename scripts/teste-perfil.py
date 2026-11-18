#!/usr/bin/env python3
"""Testa se o usuário consegue criar a PRÓPRIA linha em profiles.

Se sim, o app pode se auto-reparar sem DDL (sem tocar no banco do proprietário).
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
    email = f"prof-{int(time.time())}@movieflix-test.invalid"
    st, d = req(f"{BASE}/auth/v1/signup", "POST", {"email": email, "password": PASSWORD})
    token = d.get("access_token")
    uid = d.get("user", {}).get("id")
    auth = {"Authorization": f"Bearer {token}"}
    print(f"Usuário: {uid}")

    print("\n1) INSERT do próprio perfil")
    st, ins = req(
        f"{BASE}/rest/v1/profiles",
        "POST",
        {"id": uid, "email": email, "name": "Teste Auditoria"},
        {**auth, "Prefer": "return=representation"},
    )
    print(f"   HTTP {st} → {ins}")

    print("\n2) LER o próprio perfil")
    st, prof = req(f"{BASE}/rest/v1/profiles?select=id,email,name,is_admin&id=eq.{uid}", "GET", None, auth)
    print(f"   HTTP {st} → {prof}")

    print("\n3) UPDATE do próprio nome")
    st, upd = req(
        f"{BASE}/rest/v1/profiles?id=eq.{uid}",
        "PATCH",
        {"name": "Nome Alterado"},
        {**auth, "Prefer": "return=representation"},
    )
    print(f"   HTTP {st} → {upd}")

    print("\n4) Tentar se promover a admin (deve falhar ou não mudar)")
    st, adm = req(
        f"{BASE}/rest/v1/profiles?id=eq.{uid}",
        "PATCH",
        {"is_admin": True},
        {**auth, "Prefer": "return=representation"},
    )
    print(f"   HTTP {st} → {adm}")
    st, chk = req(f"{BASE}/rest/v1/profiles?select=is_admin&id=eq.{uid}", "GET", None, auth)
    print(f"   is_admin depois: {chk}")

    print("\n5) Limpando perfil de teste")
    req(f"{BASE}/rest/v1/profiles?id=eq.{uid}", "DELETE", None, auth)
    print("   removido")


if __name__ == "__main__":
    main()
