#!/usr/bin/env python3
"""
Verifica que o APK da casca (WebView) contém o que precisa.

A casca não usa Compose, OkHttp nem Coil — ela é um WebView. O verificador
antigo (`verify-apk.py`) procurava essas bibliotecas e reprovaria este APK por
um motivo errado. Aqui os marcadores são os da casca:

  - a classe MainActivity da casca;
  - o endereço do site (BuildConfig.SITE_URL);
  - a marca que o site usa para detectar o app (`MovieFlixApp/`);
  - o WebView do AndroidX.

Se algum faltar, o app abriria em branco ou carregaria uma página sem o modo
aplicativo — os dois sintomas que este passo existe para impedir.

Uso:  python3 scripts/verify-shell-apk.py caminho/para/app.apk
"""
import os
import sys
import zipfile

REQUIRED = {
    "MainActivity da casca": b"run/velixir/movieflix/shell/MainActivity",
    "URL do site": b"movieflix.velixir.run",
    "Marca do app (User-Agent)": b"MovieFlixApp/",
    "WebView AndroidX": b"androidx/webkit",
}


def main(apk_path: str) -> int:
    if not os.path.isfile(apk_path):
        print(f"FALHA: {apk_path} não existe")
        return 1

    blob = b""
    with zipfile.ZipFile(apk_path) as z:
        for name in z.namelist():
            if name.endswith(".dex"):
                blob += z.read(name)

    print(f"=== {apk_path} ({len(blob)} bytes de bytecode) ===")
    missing = []
    for label, pattern in REQUIRED.items():
        ok = pattern in blob
        print(f"  {label}: {'OK' if ok else 'AUSENTE'}")
        if not ok:
            missing.append(label)

    if missing:
        print(f"FALHA: {apk_path} não contém {missing}.")
        return 1

    print(f"  {apk_path}: conteúdo OK")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("uso: verify-shell-apk.py <arquivo.apk>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
