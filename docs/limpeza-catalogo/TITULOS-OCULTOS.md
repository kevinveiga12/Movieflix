# Títulos ocultos — remoção dos que abrem a tela de erro

**Data:** 2026-11-23
**Pedido:** tirar do catálogo os títulos que abrem a tela de erro em vez do player
(exemplo citado: **"Visões de um Amor"**) e criar no painel uma ferramenta manual
para o dono ocultar/reexibir títulos.

---

## 1. Por que "Visões de um Amor" falha

O título é **"Visões de um Amor"**, TMDB **1550338**, ano 2026, drama/romance.

A tela que o cliente vê — *"Ops, ocorreu um problema / Todas as fontes falharam.
Nenhuma opção disponível."* — **não é do nosso site**. É a tela de erro do próprio
player do provedor, renderizada dentro do `<iframe>` do embed. O nosso código não
tem essa mensagem em lugar nenhum (verificado com `grep` em todo o repositório).

### A causa

A limpeza anterior (v163) cruzou o nosso catálogo com a lista de IDs que o
provedor **declara ter** (`/api/movie` e `/api/series` do MegaEmbed) e escondeu
4.358 títulos que estavam fora dela.

O problema: **estar na lista do provedor não significa ter fonte.**

O provedor lista o título (metadados do TMDB) e, quando o embed é aberto, ele
responde:

```
Movie or Episode Not Found
```

— que é exatamente a tela de erro relatada. Ou seja, a lista de IDs é um sinal de
**catálogo**, não de **reprodução**. "Visões de um Amor" está na lista
(`1550338 ∈ /api/movie`) e mesmo assim não tem fonte. Foi esse o furo da rodada
anterior.

### O que foi medido

| Verificação | Resultado |
|---|---|
| `1550338` na lista `/api/movie` do provedor | **sim** (por isso passou na v163) |
| `1550338` no nosso catálogo | sim (filme, 2026) |
| Embed do provedor para `1550338` | **"Movie or Episode Not Found"** |
| Embed do provedor para `278` (Um Sonho de Liberdade) | player completo |

### Por que a verificação não pôde ser concluída no build

O provedor está atrás do **Cloudflare Turnstile**. Do ambiente de build ele
responde `403 cf-mitigated: challenge` em **todos** os domínios
(`mgeb.space`, `.lat`, `.casa`, `.quest`, `megaembed.com`) — medido com `curl` e
com Chromium real. O desafio nunca passa porque o Cloudflare detecta o datacenter.

Por isso a verificação de reprodução foi implementada para rodar **no servidor de
produção** (outro datacenter), pela rota `POST /api/admin/hidden/verify`, e não
como script de build.

> **Tentativa descartada e registrada:** foi testado o host `megaembedapi.site`,
> que responde sem Cloudflare. Ele foi **descartado** porque o sinal é inválido:
> marcou "Clube da Luta" (550) e "Matrix" (603) como quebrados — títulos que
> obviamente funcionam. Usar esse host teria escondido 21.309 dos 26.173 títulos
> (81% do catálogo) por engano. Nada desse teste foi gravado.

---

## 2. Quantos títulos foram ocultados nesta rodada

**Nenhum por verificação automática nesta rodada** — e isso é deliberado.

A verificação automática roda no servidor de produção, pelo painel, porque o
ambiente de build é bloqueado pelo Cloudflare. Ela **não** foi executada às
cegas: o botão "Conferir (sem alterar)" mostra o resultado antes de gravar
qualquer coisa.

O que foi entregue nesta rodada é o **mecanismo** que faz a detecção de verdade:

1. **Verificação no servidor** (`POST /api/admin/hidden/verify`) — abre o embed de
   cada título e classifica em `ok` / `quebrado` / `incerto`.
2. **Proteção contra falso positivo** — se o servidor também estiver bloqueado
   (nenhum `ok` e todos `incerto`), a rota **não oculta nada** e avisa. Ocultar
   por falha de rede seria pior do que deixar um título quebrado.
3. **Ferramenta manual** — para o caso que só o cliente vê (como o "Visões de um
   Amor"), o dono oculta em um clique.

### O que conta como "quebrado"

Só sinal **positivo** de que o player não foi montado:

- `Movie or Episode Not Found`
- `Nenhuma fonte cadastrada`
- `Todas as fontes falharam`
- `Nenhuma opção disponível`

`403`, timeout, página vazia ou sem marcador = **incerto**, fica de fora.

---

## 3. A seção "Títulos ocultos" no painel

**Onde fica:** Painel administrativo → aba **"Títulos ocultos"** (entre
"Disponibilidade" e "MegaEmbed"). Mesmo visual do painel: reaproveita as classes
`panel`, `chip`, `episode` e `btn` — nenhum CSS novo, nenhum redesenho.

**Acesso:** as mesmas regras do painel. A rota está sob `router.use(requireAdmin)`
e o `is_admin` é verificado no banco (`profiles.is_admin`), não no navegador.

### Como usar

**Verificação automática** (topo da aba)

- **Conferir (sem alterar)** — roda a verificação e mostra quantos funcionam,
  quantos estão quebrados e quantos ficaram incertos. **Não grava nada.**
- **Verificar e ocultar os quebrados** — mesma verificação, mas aplica: oculta os
  que o provedor respondeu como sem fonte.

**Ocultar um título** (manual)

1. Digite o nome no campo de busca (mínimo 2 letras).
2. A lista mostra filme/série, ano, categoria e o ID do TMDB.
3. Clique em **Ocultar** → aparece um campo de **motivo (opcional)** →
   **Confirmar**.
4. O título sai na hora de todas as listas.

A busca varre o catálogo **bruto**, incluindo o que já está oculto — senão não
seria possível reexibir nem corrigir um oculto por engano.

**Títulos ocultos** (lista)

- Mostra capa, nome, tipo, ID, motivo e data.
- **Reexibir** devolve o título ao catálogo imediatamente.

---

## 4. Onde a lista é guardada (sem tocar no Supabase)

**Nenhuma tabela nova, nenhuma migração, nenhuma alteração no banco.**

A lista vive em `server/data/catalog-overrides.json`, campo `hidden` — o **mesmo
arquivo** que o painel já usava para editar metadados.

Formato novo (com tipo, motivo e data):

```json
{
  "hidden": [
    {
      "tmdb_id": "1550338",
      "type": "movie",
      "title": "Visões de um Amor",
      "poster_url": "https://…",
      "motivo": "abre a tela de erro",
      "origem": "manual",
      "em": "2026-11-23T13:22:07.035Z"
    }
  ]
}
```

**Compatibilidade:** o formato antigo (`hidden: ["603", "1550338"]`, IDs soltos)
continua funcionando — na leitura, cada ID solto vira `{ tmdb_id, type: null }`,
que esconde nos dois catálogos. Nada do que já estava oculto se perde.

**Por que `type` importa:** antes um ID solto escondia o filme **e** a série de
mesmo número. Agora o registro diz de qual catálogo é.

**Persistência entre deploys:** `catalog-overrides.json` está no `.gitignore`
(é estado de runtime). Para o que for ocultado não sumir num deploy, existe
`server/data/hidden-baseline.json`, **comitado** no repositório, que serve de
semente quando o arquivo de runtime não existe. A variável `MOVIEFLIX_DATA_DIR`
permite apontar os dois para um volume persistente da Velixir, sem mudar código.

**Reversível:** apagar `catalog-overrides.json` volta ao baseline; apagar os dois
volta ao catálogo completo. Nada é apagado do catálogo — o filtro é aplicado na
leitura.

---

## 5. Como a ocultação vale no site, na TV e no app

O filtro é aplicado **na leitura**, nos pontos que os três clientes usam:

| Onde | O que cobre |
|---|---|
| `GET /api/catalog/movies` e `/series` | listas, busca, categorias |
| `GET /api/catalog/availability` | histórico e favoritos (TV e app) |
| `GET /api/catalog/hidden` | o navegador filtra o catálogo estático |
| `src/lib/catalog.ts` | home, destaques, relacionados, busca do site |

O site lê o catálogo de `/filmes/*.json`, um arquivo **estático** com cache de 7
dias que não passa pelas rotas da API. Por isso foi criada a rota pública
`/api/catalog/hidden` (só IDs, poucos KB): o cliente baixa a lista e filtra. Sem
ela, um título ocultado no painel continuaria na home até o próximo build.

Resultado: **ocultar no painel vale imediatamente** no site, no app de TV e no
app normal — sem rebuild e sem reinstalar app.

---

## 6. Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `server/lib/store.js` | formato novo de `hidden` (tipo/motivo/data), `hideTitle`, `unhideTitle`, `hiddenIds`, baseline, `MOVIEFLIX_DATA_DIR` |
| `server/lib/verify-embeds.js` | **novo** — sonda de reprodução no servidor |
| `server/lib/static-catalog.js` | `loadRaw()` — catálogo sem filtro, para a busca do painel |
| `server/routes/admin.js` | rotas `GET/POST/DELETE /hidden`, `GET /hidden/search`, `POST /hidden/verify`; rotas antigas de override passam a usar o formato novo |
| `server/routes/catalog.js` | `GET /api/catalog/hidden`; `/availability` passa a excluir os ocultos |
| `src/lib/catalog.ts` | filtro de ocultos no cliente + `invalidateHiddenCache()` |
| `src/pages/AdminPage.tsx` | aba "Títulos ocultos" (verificação, busca, ocultar, reexibir) |
| `docs/limpeza-catalogo/TITULOS-OCULTOS.md` | este documento |

**Não alterado:** design do site, player, controle remoto, Supabase, banco de
dados, apps de TV e celular (eles já consomem `/api/catalog/availability`).

---

## 7. Testes

| Teste | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 erros |
| `npm run build` | ok (6,85 s) |
| `GET /api/health` | ok |
| `GET /api/catalog/hidden` | `{ filmes: [], series: [], total: 0 }` |
| `GET /api/catalog/availability` | 200, lista filtrada |
| `GET /api/admin/hidden` sem token | **401** (acesso restrito) |
| ocultar → filtrar → reexibir | ok (o título sai e volta) |
| ocultar duas vezes | idempotente (não duplica) |
| ocultar filme não afeta série de mesmo ID | ok |
| formato antigo (`hidden: ["603"]`) | normalizado, esconde nos dois catálogos |
| sonda com Cloudflare bloqueando | `incerto` → **não oculta nada** |

---

## 8. O que o usuário precisa fazer no aparelho

- **Site:** recarregar com força (`Ctrl+Shift+R` no computador; no celular,
  fechar a aba e abrir de novo). O service worker guarda o catálogo antigo.
- **App de TV:** fechar e abrir o app.
- **App normal (Android/iOS):** não precisa reinstalar — ele lê a lista do
  servidor. Se o app guardar o catálogo em cache local, fechar e abrir basta.

Para ocultar o "Visões de um Amor" agora: painel → **Títulos ocultos** → buscar
"Visões" → **Ocultar** → **Confirmar**.
