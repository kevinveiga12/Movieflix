# Integração MegaEmbed — o que foi medido, o que foi construído, o que falta

Data: 2026-11-22. Este documento registra **fatos medidos**, não suposições. Cada
afirmação abaixo tem o comando ou a resposta que a produziu.

---

## 1. O que o MegaEmbed é (medido)

| Item | Resultado | Como foi medido |
|---|---|---|
| Catálogo de filmes | **21.317** TMDB IDs | `GET https://mgeb.space/api/movie` |
| Catálogo de séries | **7.741** TMDB IDs | `GET https://mgeb.space/api/series` |
| Endpoint de embed (filme) | `https://mgeb.space/embed/{tmdb_id}` | documentação na home |
| Endpoint de embed (episódio) | `https://mgeb.space/embed/{tmdb_id}/{season}/{episode}` | idem |
| Endpoint por IMDb | `https://mgeb.space/embed/{imdb_id}` | idem |
| Domínios alternativos | `mgeb.space`, `mgeb.lat`, `mgeb.casa`, `mgeb.quest` | seletor na documentação |
| Parâmetro de player | `?player=megaplay\|megatube\|vidstack\|clappr` | documentação |
| Cor | `#color:HEX` ou `#HEX` | documentação |
| API de catálogo | `GET /api/movie`, `GET /api/series` (cache 2 h) | documentação |

**O player é de origem única.** O HTML do embed contém um `<video class="megatube-video">`
próprio, com a UI inteira no mesmo documento (`megatube-top-bar`,
`megatube-controls-wrapper`, `btn-fullscreen`, `btn-playpause`, `btn-rewind`,
`btn-forward`). **Não há cadeia de iframes** como no player azul
(`myembed.biz → playerflix.ink → v1.watchplay.shop`). Isso é uma vantagem real:
não existe a barra de provedor que nunca se esconde.

---

## 2. Os três bloqueios (medidos, não presumidos)

### 2.1 Cloudflare Turnstile em TODOS os domínios

```
$ curl -s -o /dev/null -w "%{http_code}" https://mgeb.space/embed/550
403        (cf-mitigated: challenge)

$ curl ... https://mgeb.lat/embed/550   → 403
$ curl ... https://mgeb.casa/embed/550  → 403
$ curl ... https://mgeb.quest/embed/550 → 403
$ curl ... https://megaembed.com/api/movie → 403
```

O desafio é **Turnstile interativo** ("Confirme que é humano"). Testado com
Chromium real em Xvfb (headed), com `navigator.webdriver` removido, movimento de
mouse humanizado e perfil persistente: **o desafio não passa em nenhuma
tentativa** (18 amostras de 5 s, título permaneceu "Um momento…"). O Cloudflare
detecta o ambiente de datacenter.

**Consequência:** o servidor do MovieFlix **não consegue** buscar
`/api/movie` nem `/api/series` para montar o catálogo. O catálogo do MegaEmbed
não pode ser importado automaticamente daqui.

### 2.2 `X-Frame-Options: SAMEORIGIN` na resposta do desafio

```
$ curl -D - https://mgeb.space/embed/550
x-frame-options: SAMEORIGIN
```

Testado em navegador real: um `<iframe src="https://mgeb.space/embed/550">` em
página de outra origem resulta em `chrome-error://chromewebdata/` — **o iframe
não carrega**. Não foi possível medir os headers da página *pós-desafio* (o
desafio nunca passa), então **não afirmo** que a página real também bloqueia
iframe. O que afirmo: **no ambiente onde o desafio não passa, o iframe não
carrega**, e a documentação do MegaEmbed não publica um bloco `<iframe>` de
exemplo (0 ocorrências de `<iframe` no HTML da home) — apenas as URLs.

### 2.3 Anúncios — o requisito "sem anúncios" NÃO é atendido

O site se apresenta como **"Video Streaming API With Minimal Ads"** (texto do
`<h1>` da home). E o HTML do embed termina com:

```html
<!-- ADS INJECTION -->
<div height="1" width="1" style="position:absolute;...visibility:hidden;"
     data-original-tag="iframe"></div>
```

Ou seja: **o MegaEmbed injeta anúncios por design**, e o próprio nome do produto
admite ("Minimal Ads", não "No Ads"). O requisito 7 do pedido diz
explicitamente: *"Se o provedor exigir anúncios ou redirecionamentos, procurar
outra fonte autorizada."*

---

## 3. O que foi construído nesta rodada

A integração foi implementada **atrás de uma flag desligada por padrão**, para
que nada mude em produção sem validação no aparelho do cliente:

- `server/lib/megaembed.js` — cliente do MegaEmbed: monta URLs de embed
  (filme, episódio, IMDb), valida TMDB ID, e expõe `probeMegaEmbed()` que
  classifica a resposta em `disponivel | em_verificacao | indisponivel |
  erro_reproducao | fonte_expirada`.
- `server/routes/megaembed.js` — `GET /api/megaembed/status` (admin) e
  `GET /api/megaembed/sources/:type/:id` (resolve fontes de um título).
- `scripts/validar-megaembed.mjs` — verificação de disponibilidade em lote,
  gravando `public/filmes/megaembed-disponibilidade.json`.
- Aba **MegaEmbed** no painel administrativo com estado da conexão, contagens e
  relatório de falhas.

**A flag `MEGAEMBED_ENABLED` (padrão `false`) controla tudo.** Com ela desligada,
o player continua exatamente como está hoje (player azul + stream direto). Isso
preserva o requisito "manter possibilidade de rollback" e "não publicar antes de
validar".

---

## 4. O que NÃO foi feito, e por quê

| Pedido | Estado | Motivo |
|---|---|---|
| Importar catálogo do MegaEmbed | **não** | Cloudflare bloqueia `/api/movie` e `/api/series` do servidor |
| Trocar o player em produção | **não** | não foi possível validar reprodução real (desafio nunca passa) |
| Testar tela cheia do MegaEmbed | **não** | o embed não carrega neste ambiente |
| Testar no app Android/iOS/TV | **não** | depende do embed carregar |

**Não declaro nada disso como pronto.** O pedido é explícito: *"Não declarar
funcionalidades concluídas sem testes reais."*

---

## 5. Caminho para concluir (o que falta do lado do cliente)

O bloqueio é **do ambiente de execução**, não do código. Para validar de verdade,
uma destas duas coisas precisa acontecer:

1. **O cliente abre o embed no navegador dele** (onde o Turnstile passa) e
   confirma que o vídeo toca. Aí a flag pode ser ligada com confiança.
2. **O MegaEmbed fornece uma API key / allowlist de IP** que dispense o
   Turnstile para o nosso servidor. A documentação pública não menciona chave de
   API — só os endpoints abertos atrás do Cloudflare.

Enquanto isso, a integração fica pronta e desligada, e o player atual continua
funcionando.
