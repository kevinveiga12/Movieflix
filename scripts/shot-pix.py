import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8096"
OUT = "/workspace/movieflix/docs/apps-evidencias"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1440, "height": 1000})

        # ── Planos ────────────────────────────────────────────────────────
        await pg.goto(f"{BASE}/planos", wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f"{OUT}/pix-planos.png", full_page=True)
        print("planos ok")

        # Quantos botões de contratação e qual o texto deles
        btns = await pg.locator("a.btn, button.btn").all_inner_texts()
        print("BOTOES:", [t.strip() for t in btns if t.strip()][:20])

        # ── Página de pagamento (sem login: deve redirecionar) ────────────
        await pg.goto(f"{BASE}/pagamento/pix?plano=basico&periodo=1m",
                      wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(2000)
        print("URL apos /pagamento/pix:", pg.url)
        await pg.screenshot(path=f"{OUT}/pix-pagamento.png", full_page=True)

        await b.close()


asyncio.run(main())
