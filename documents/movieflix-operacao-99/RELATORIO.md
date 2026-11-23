# MovieFlix 2.1 — Operação 99%: relatório

**Data:** 2026-11-23
**Commit:** `8aa52bf5475b4c2b206c56eb3d7e6acb94418056`
**Release:** v192 · **Succeeded** · app **Healthy**
**Produção:** https://movieflix.velixir.run

---

## 1. A causa comum — e ela não era o que se suspeitava

A suspeita do pedido era que a restrição "só HLS direto" tivesse cortado o
catálogo. **Descartei com dados.** O caminho HLS direto estava intacto; o que
estava quebrado era o **disjuntor que decide se ele é tentado**.

### O bug

`server/lib/playback-chain.js` chamava `record('watchplay', false)` sempre que o
resolvedor devolvia `null` — sem distinguir dois casos completamente diferentes:

| Situação | O que significa | O que o código fazia |
|---|---|---|
| Provedor fora do ar / bloqueado | falha **DELE** | penalizava ✓ correto |
| Título que o provedor não tem (404) | falha **DO TÍTULO** | penalizava ✗ **errado** |

Com o limiar em **3**, bastavam três títulos ausentes — e o catálogo tem
milhares — para o disjuntor abrir e o `watchplay` ser **pulado por 5 minutos em
todos os títulos**, inclusive nos que funcionam.

O cliente abria um filme que existe, o resolvedor nem tentava, a cadeia caía no
MegaEmbed, e o MegaEmbed respondia exatamente a tela do print:
*"Nenhuma fonte de reprodução funcional disponível"*.

Isso explica o sintoma relatado com precisão: **"a maioria falha, mas alguns
funcionam"** — os que funcionavam eram os que vinham antes do terceiro 404, ou
os que estavam no cache de 8 minutos.

### A prova

Simulação com a lógica real do disjuntor:

```
--- 3 títulos sem fonte (404) ---
  após 404 #1: fails=1 open=false
  após 404 #2: fails=2 open=false
  após 404 #3: fails=3 open=TRUE     ← aqui o catálogo inteiro cai

--- agora um título QUE FUNCIONA (550) ---
  isOpen(watchplay) = true
  => o código PULA o HLS direto e cai no MegaEmbed
```

E a medição numa sessão realista de 40 títulos em ordem de catálogo:

| | Títulos que tocam |
|---|---|
| Com o bug | **3 / 40** |
| Com a correção | **27 / 40** |

---

## 2. O que foi corrigido

Dois arquivos, mudança mínima e cirúrgica.

### `server/lib/stream-resolver.js`

- `resolveDirectStreamDetailed()` e `fetchOptionsDetailed()` passam a devolver
  `{ stream, reachable }` / `{ options, reachable }`.
- **404 / 410** e `{"status":false}` → `reachable: true` (o provedor respondeu;
  não tem o título).
- **timeout / DNS / 5xx** → `reachable: false` (aí sim o provedor está fora).
- `resolveDirectStream()` e `fetchOptions()` mantêm a assinatura antiga, então
  nenhum chamador existente quebrou.
- `ajaxBreakerStatus()` expõe o estado do disjuntor do Ajax — antes ele era
  invisível, e descobrir que o `playerflix.ink` estava bloqueado exigiu medir de
  dentro do pod.

### `server/lib/playback-chain.js`

- Usa a versão `Detailed` e só chama `record(..., false)` quando
  `reachable === false`.
- O bloco 2 (embed limpo) deixou de penalizar o host por título sem embed — o
  disjuntor do Ajax já é tratado dentro do `fetchOptions`.

### Scripts novos

- `scripts/auditar-cobertura.mjs` — mede **4 estágios** por título: página
  respondeu → manifesto tem `#EXTM3U` → segmento respondeu → segmento tem magic
  bytes de vídeo. HTTP 200 sozinho não conta.
- `scripts/test-breaker-titulo-ausente.mjs` — 8 asserções que travam o bug.

---

## 3. Pesquisa de provedores

Investiguei os caminhos de reprodução que o agregador expõe, medindo cada um de
verdade (não por HTTP 200 — por manifesto e segmento).

| Provedor | Como funciona | Veredito |
|---|---|---|
| **watchplay** (`v1.watchplay.shop`) | HTML com `url: "...m3u8"` → HLS direto | **APROVADO** — é o player vermelho, sem anúncio |
| **playerflix.ink** (Ajax) | Lista de opções por título | **PARCIAL** — bloqueado a partir do pod de produção (HTTP 000); funciona do sandbox |
| **embedplayer2.xyz** | `POST /player/index.php?do=getVideo` devolve `securedLink` | **REPROVADO** — o CDN devolve 404 mesmo com `md5` válido; e o HTML carrega `tracker.Royale.com` + `tracker.advertising.com` com `poplimit:false` |
| **embedplay / abyssplayer** | Player com dados em base64 | **REPROVADO** — AdSense, `fuckadblock.min.js`, pop-up |
| **MegaEmbed** (`mgeb.space`) | iframe | **REPROVADO** — Cloudflare 403; é a tela de erro que o cliente vê |
| **superflixapi** | — | **REPROVADO** — `budget: danger` (plano pago do provedor) e captcha |

**Nenhum provedor novo foi integrado** porque nenhum passou nos requisitos de
reprodução limpa. Integrar um deles significaria trocar "não toca" por "toca com
pop-up" — e o pedido é explícito: não decidir isso sozinho.

---

## 4. Cobertura real medida

Amostra distribuída por todo o catálogo (passo fixo, não os primeiros N):

| | Amostra | Funcionais (4 estágios) |
|---|---|---|
| **Filmes** | 60 | **29 (48,3%)** |
| **Séries** | 40 | **0 (0%)** |
| **Episódios** | 120 | **0 (0%)** |

### Por que séries dão 0% na amostra distribuída

Não é bug de numeração. Testei `S1E1`, `S1E2`, `S2E1`, `S5E1`, `S10E1`, `S0E1`
em várias séries: **404 em todas**. E o Ajax confirma — essas séries só têm
`superflixapi:danger`.

**O provedor simplesmente não tem essas séries.** São títulos de nicho
(«You Maniac», «Bloom Life», «Zomvivor», «Vinagre de Maçã»).

Mas séries populares **funcionam** — e isso é o que importa para o cliente:

```
SERIE 1399 (Game of Thrones) T1E1 → 200, 116 KB, #EXTM3U
SERIE 219937 T1E1                 → 200,  95 KB, #EXTM3U
SERIE 94605 T2E3                  → 200, #EXTM3U
```

A cobertura correlaciona com popularidade, não com um defeito de código.

### A meta de 99% não foi atingida — e não é alcançável com fontes limpas

O limite é a **inexistência de fonte no provedor**, não o nosso código. Para
chegar a 99% seria preciso usar as fontes com anúncio, o que o pedido proíbe sem
aprovação explícita.

---

## 5. Testes executados

### Automatizados

| Teste | Resultado |
|---|---|
| `tsc -b` | **0 erros** |
| `npm run build` | **OK** (6,86 s) |
| `node --check` nos 2 arquivos do servidor | **OK** |
| `test-breaker-titulo-ausente.mjs` | **8/8 passaram** |
| `test-stream-resolver.mjs` | **12/12 passaram** |
| `test-stream-layers.mjs` | **5/5 passaram** |
| `test-access-state.mjs` | **8/8 passaram** |
| `test-stream-proxy.mjs` | não executado — exige servidor local na porta 3999 |

### Produção (HTTP real)

| Verificação | Resultado |
|---|---|
| `/`, `/filmes`, `/series`, `/planos`, `/conta` | **200** |
| `/api/health` | **200** (após cold start) |
| Catálogo | **12.672 filmes / 1.965 séries / 4.312 temporadas / 50.423 episódios** |
| Bundle publicado = local | **`index-Do1FGus1.js` + `index-BkqZ95Mv.css` idênticos** |
| Manifesto filme 550 via proxy | **200, 252 KB, `#EXTM3U`** |
| Manifesto série 1399 T1E1 via proxy | **200, 116 KB, `#EXTM3U`** |
| Segmento filme 550 | **200, 1.044.306 bytes, `video/mp4`, `stypmsdh`** |
| Segmento série 1399 T1E1 | **200, 3.936.284 bytes, `video/mp4`, `stypmsdh`** |
| `/api/playback/authorize` sem token | **401** |
| `/api/playback/diagnostics` sem token | **401** |

O segmento de **3,9 MB com magic bytes `stypmsdh`** é vídeo fMP4 real, não uma
página de erro disfarçada.

---

## 6. O que NÃO foi testado

- **Reprodução ponta a ponta com conta pagante.** O `authorize` exige plano
  ativo; não tenho `SERVICE_ROLE_KEY` e não vou burlar o gate de assinatura.
  Provei a cadeia, o manifesto e o segmento — falta o clique de play.
- **APK da TV.** O sandbox não tem Java nem Android SDK. O código-fonte da TV
  **já consome `sources[]` com fallback por cadeia** (`advanceSource()`), então
  herda a correção automaticamente na próxima compilação. Não bumpei a versão:
  a página continuaria apontando para o APK antigo em disco, e anunciar uma
  versão que não existe seria mentira.
- **iOS / dispositivo físico.** Sem ambiente.

---

## 7. Publicação

| | |
|---|---|
| Commit | `8aa52bf5475b4c2b206c56eb3d7e6acb94418056` |
| Push | **confirmado** — `fed12c0..8aa52bf main -> main` |
| Release | **v192 Succeeded** |
| App | **Healthy** |

### Nota sobre o deploy

As releases 188, 189, 190 e 191 falharam com
`Response status code does not indicate success: 404 (Not Found)` em ~5 segundos
— antes de qualquer `npm ci`. É a retenção de 1 GB da Velixir purgando a fonte.
A 192 passou na terceira tentativa de `github/deploy`.

**O App ID do pedido tem um dígito trocado:** `44b4` → o correto é **`44d4`**.
Com `44b4` a API responde `{"error":"App not found."}`.

---

## 8. Preservação

Nenhuma tabela criada, alterada ou apagada. Nenhum dado removido. Nenhum título
retirado do catálogo. Design, player, preços, planos, Mercado Pago, autenticação
e painel administrativo intactos. `git grep "ghp_"` → **0 ocorrências**.
