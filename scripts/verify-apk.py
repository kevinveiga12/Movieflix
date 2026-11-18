#!/usr/bin/env python3
"""
Verifica que o APK realmente contém a interface do app.

Motivo: o release usa R8 (isMinifyEnabled = true). Se as regras do ProGuard não
protegerem a árvore de Compose, o R8 remove tudo que "ninguém usa" — e o app
compila, instala, abre e fica em TELA PRETA. Este script falha o build antes de
publicar um APK nesse estado.

Uso:  python3 scripts/verify-apk.py caminho/para/app.apk
"""
import os
import sys
import tempfile
import zipfile

# Marcadores que precisam existir no bytecode. Se algum faltar, a UI não está lá.
REQUIRED = {
    "Compose runtime": b"androidx/compose/runtime",
    "Compose material3": b"androidx/compose/material3",
    "OkHttp": b"okhttp3",
    "Coil": b"coil",
    "URL da API": b"movieflix.velixir.run",
}


def main(apk_path: str) -> int:
    if not os.path.isfile(apk_path):
        print(f"FALHA: {apk_path} não existe")
        return 1

    blob = b""
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(apk_path) as z:
            for name in z.namelist():
                if name.endswith(".dex"):
                    blob += z.read(name)
        # tmp não é usado além do escopo, mas mantém o padrão explícito
        _ = tmp

    print(f"=== {apk_path} ({len(blob)} bytes de bytecode) ===")
    missing = []
    for label, pattern in REQUIRED.items():
        ok = pattern in blob
        print(f"  {label}: {'OK' if ok else 'AUSENTE'}")
        if not ok:
            missing.append(label)

    if missing:
        print(f"FALHA: {apk_path} não contém {missing}.")
        print("O app abriria em tela preta. Verifique proguard-rules.pro.")
        return 1

    print(f"  {apk_path}: conteúdo OK")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("uso: verify-apk.py <arquivo.apk>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
