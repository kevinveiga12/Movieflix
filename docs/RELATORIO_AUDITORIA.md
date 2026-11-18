# MovieFlix 2.0 — Relatório de Auditoria Técnica

**Data:** 18/11/2026
**Escopo:** auditoria completa, correção e integração — sem reconstruir o projeto
**Repositório:** https://github.com/kevinveiga12/Movieflix (branch `main`)
**Produção:** https://movieflix.velixir.run

---

## 1. Diagnóstico inicial

### 1.1 O que já funcionava

| Item | Estado |
|---|---|
| Frontend React + Vite + TS | Compila, 0 erros de tipo |
| Identidade visual | Preservada (logo, cores, fontes) |
| Catálogo estático | 18.080 filmes + 8.093 séries em `/filmes/*.light.json` |
| Busca com normalização de acentos | Funciona |
| Favoritos / histórico / continuar assistindo | Funcionam (Supabase) |
| Auth (cadastro, login, logout, sessão) | Funciona |
| PWA (manifest, SW, ícones) | Presente |
| Player MP4/HLS + hls.js | Implementado |

### 1.2 O que estava quebrado

**BUG 1 — `profiles.full_name` não existe (crítico)**
O código consultava `select('id, email, full_name, ...')`, mas a coluna real é **`name`**. O PostgREST devolve `42703` e o perfil nunca carrega — o painel admin não reconhece ninguém.
*Corrigido em 6 arquivos.*

**BUG 2 — Nenhum perfil é criado no cadastro (crítico)**
Não existe trigger em `auth.users`. Todo usuário novo fica **sem linha em `profiles`**. Comprovado por teste: `GET /rest/v1/profiles?id=eq.<uid>` → `[]`.
*Mitigado no app (auto-cria a própria linha); correção definitiva em SQL.*

**BUG 3 — `supabase-js` derruba o processo no Node 20 (crítico)**
`@supabase/supabase-js` instancia o Realtime no construtor e exige WebSocket. No Node 20 o processo **morre** com `Node.js 20 detected without native WebSocket support`. Descoberto ao subir o servidor localmente.
*Corrigido: `ws` como dependência + transporte explícito + singleton.*

**BUG 4 — Nenhuma proteção de reprodução**
O player tocava direto, sem verificar conta nem plano. Não havia planos no código.

**BUG 5 — Produção serve apenas arquivos estáticos**
`/api/health` devolve o `index.html` (headers `x-served-by: velixir-edge`, `etag` do Caddy). **O processo Node não está rodando** — só o `dist/` é servido. Toda a API está morta em produção.

---

## 2. Schema real do Supabase (verificado, não presumido)

Projeto `mntyanfhxiqspdedmddb`. Sondado coluna por coluna.

| Tabela | Linhas | Colunas relevantes |
|---|---|---|
| `movies` | **451** | `id, tmdb_id, title, description, poster_url, backdrop_url, video_url, language, quality, type, required_plan, category, duration, year` |
| `seasons` | **2** | `id, series_id, season_number, title, poster_url` |
| `episodes` | **12** | `id, season_id, episode_number, title, description, video_url, duration_seconds, thumbnail_url` |
| `plans` | **3** | `id, name, code, description, price_cents, features, duration_days, is_active` |
| `profiles` | — | `id, email, **name**, avatar_url, is_admin, created_at` |
| `subscriptions` | **0** | `user_id, plan_id, plan_code, status, expires_at, payment_id` |
| `favorites` | — | `user_id, tmdb_id, media_type, title` |
| `watch_history` | — | `user_id, tmdb_id, media_type, progress, episode_id` |

**Planos reais no banco:** Plano 1 / `simple` / R$ 19,90 · Plano 2 / `standard` / R$ 29,90 · Plano 3 / `premium` / R$ 39,90.

**Relação importante:** `seasons.series_id` aponta para `movies.id`, **não** para `tmdb_id`.

---

## 3. Falhas de segurança comprovadas por teste

### 3.1 Qualquer usuário se dá um plano premium de graça

```
usuário recém-criado → POST /rest/v1/subscriptions
{ user_id: <ele mesmo>, plan_code: "premium", status: "active", expires_at: <+1 ano> }
→ HTTP 201, linha criada
→ /api/playback/authorize passou a devolver allowed=true
```

**O paywall inteiro é contornável com um INSERT.** A política de RLS de `subscriptions` permite escrita pelo próprio usuário.

### 3.2 Qualquer usuário se torna administrador

```
usuário recém-criado → PATCH /rest/v1/profiles?id=eq.<ele mesmo> { is_admin: true }
→ HTTP 200, is_admin virou true
```

**O painel administrativo inteiro fica exposto.**

### 3.3 Mitigação aplicada em código

- `requireAdmin` agora exige `is_admin` **e**, se `ADMIN_EMAILS` estiver definida, que o e-mail esteja na lista.
- O app cria a própria linha em `profiles` no primeiro login (sem enviar `is_admin`).

**Isto reduz a superfície, não fecha a brecha.** A correção definitiva é no banco: `docs/MIGRACAO_RLS.sql`, **aguardando aprovação** — nenhuma política foi alterada.

---

## 4. O que foi implementado

### 4.1 Autorização de reprodução no servidor

`POST /api/playback/authorize` — a única porta para liberar vídeo.

Valida, nesta ordem:
1. Token do Supabase Auth (`getUser` — confere assinatura do JWT)
2. Título existe no catálogo administrado
3. Episódio existe (séries) e tem fonte
4. Assinatura com `status = 'active'` **e** `expires_at` no futuro
5. Plano cobre o `required_plan` (hierarquia `simple` < `standard` < `premium`)

Só então devolve a URL. **O cliente nunca vê a regra, só a resposta.** Esconder o botão no navegador não contorna nada.

Respostas: `401` sem conta · `402` sem plano · `403` plano insuficiente · `404` sem fonte.

### 4.2 Arquivos criados

| Arquivo | Função |
|---|---|
| `server/lib/supabase-server.js` | Singleton Supabase + transporte `ws` |
| `server/lib/entitlement.js` | Regras de assinatura e plano |
| `server/lib/db-catalog.js` | Catálogo administrado (movies/seasons/episodes) |
| `server/routes/access.js` | `/playback/authorize`, `/subscription` |
| `server/routes/db-catalog.js` | `/db/movies`, `/db/series/:id/episodes`, `/db/stats` |
| `server/routes/plans.js` | `/plans` (preços do banco + WhatsApp) |
| `src/lib/access.ts` | Cliente de autorização |
| `src/pages/PlansPage.tsx` | Tela de planos |
| `src/pages/SeriesPage.tsx` | Temporadas e episódios reais |
| `src/components/PlaybackGate.tsx` | Bloqueio com saída para cada motivo |
| `docs/MIGRACAO_RLS.sql` | Correção de RLS (não aplicada) |

### 4.3 Arquivos modificados

`server/index.js` (rotas + health detalhado) · `server/lib/auth.js` (requireAdmin endurecido) · `server/routes/admin.js` (`name`) · `src/App.tsx` (rotas `/planos`, `/serie/:id`) · `src/components/Navbar.tsx` (link Planos) · `src/context/AuthContext.tsx` (`name` + auto-perfil) · `src/lib/types.ts` (Plan, Subscription, PlaybackAuth, DbSeason) · `src/pages/AccountPages.tsx` · `src/pages/AdminPage.tsx` · `src/pages/PlayerPage.tsx` (gate real) · `src/styles/main.css` (aviso de embed) · `package.json` (`ws`)

---

## 5. Testes executados — resultados reais

| # | Teste | Resultado |
|---|---|---|
| 1 | `tsc --noEmit` | **0 erros** |
| 2 | `npm run build` | **sucesso** — 104 módulos, 5,87 s |
| 3 | Servidor sobe com `ws` | **OK** (antes morria) |
| 4 | `/api/health` | **200** com config e contadores |
| 5 | `/api/plans` | **200** — 3 planos, preços do banco |
| 6 | `/api/playback/authorize` sem token | **401** `unauthenticated` |
| 7 | `/api/playback/authorize` token falso | **401** |
| 8 | `/api/subscription` sem token | **401** |
| 9 | `/api/db/movies` | **200** — 451 filmes |
| 10 | `/api/db/stats` | **200** — 451/2/12 + órfãos |
| 11 | Cadastro real pela UI (Chromium) | **OK** — redirecionou, avatar na navbar |
| 12 | Player sem login | **bloqueado** — "Crie sua conta para assistir" |
| 13 | Player logado **sem plano** | **bloqueado** — "Escolha um plano para assistir" |
| 14 | Player logado **com plano premium** | **liberado** — `allowed=true` |
| 15 | `/api/subscription` com plano | **200** `active=true` `Plano 3` |
| 16 | Screenshot do gate | **sem problemas visuais** |
| 17 | Screenshot do player | aviso legível; **iframe vazio** |

**Testes 11–15 usaram um usuário real criado no Supabase.** A assinatura de teste foi removida ao final.

---

## 6. O que NÃO foi possível — sem afirmar sucesso

### 6.1 Produção (Velixir) — bloqueado

O site serve **apenas arquivos estáticos**. Nenhuma rota `/api` responde. Não tenho acesso ao painel do Velixir.

**Ação necessária do proprietário:** no painel do Velixir, o app precisa iniciar o Node, não só servir `dist/`. Start command: `node server/index.js`. Build: `npm ci && npm run build`. Health check: `/api/health`.

**Atenção:** `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são **de build**, não de runtime — precisam existir no momento do `npm run build`. Descobri isso na prática: o primeiro build saiu sem elas e o cadastro falhou com `Failed to fetch`.

### 6.2 Reprodução de vídeo — o problema mais sério

**450 dos 451 filmes usam `megaembedapi.site`** — um site de pirataria (tema "pirate", catálogo de filmes recentes). Isso viola diretamente o requisito de "sem anúncios, sem redirecionamentos, reprodução dentro do MovieFlix".

**Os 12 episódios usam Bunny CDN e retornam HTTP 403** — a zona `vz-b3c2a7fe-e98.b-cdn.net` não está configurada (página "unconfigured" do Bunny). **Nenhum episódio toca.**

**Não testei reprodução real de vídeo.** O iframe do megaembed carrega vazio no sandbox. Não posso afirmar que toca em produção.

**O que fiz:** o player agora avisa explicitamente quando a fonte é externa, em vez de fingir que está tudo certo. O administrador precisa cadastrar arquivos próprios (`.mp4`/`.m3u8`) para sair do modo embed.

### 6.3 Dados órfãos

As 2 temporadas apontam para `series_id = 17`, que **não existe** em `movies`. São 12 episódios com vídeo que não aparecem em lugar nenhum. O código os ignora em vez de exibi-los como episódios de uma série inventada. **Não há como adivinhar a qual série pertencem** — o proprietário precisa informar.

### 6.4 Não testado

- Mercado Pago / Pix — **não existe integração no código**. O fluxo real é WhatsApp.
- Painel admin logado — exige `SUPABASE_SERVICE_ROLE_KEY` + usuário `is_admin`.
- TMDB — sem `TMDB_API_KEY`, `/api/tmdb/*` responde 503.
- Recuperação de senha por e-mail — depende de e-mail real.
- PWA instalado — depende de dispositivo.
- Mobile físico — só viewport do Chromium.

---

## 7. Variáveis de ambiente

| Variável | Onde | Estado |
|---|---|---|
| `VITE_SUPABASE_URL` | build | **necessária** |
| `VITE_SUPABASE_ANON_KEY` | build | **necessária** |
| `SUPABASE_URL` | runtime | **necessária** |
| `SUPABASE_ANON_KEY` | runtime | **necessária** |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime, só servidor | **necessária** para o admin |
| `TMDB_API_KEY` | runtime, só servidor | opcional (busca TMDB) |
| `ADMIN_EMAILS` | runtime | **recomendada** enquanto a RLS não for corrigida |
| `CORS_ORIGINS` | runtime | opcional |

---

## 8. Preservação

- **Nenhuma tabela criada, alterada ou apagada.**
- **Nenhum dado de usuário removido** (só o usuário de teste que eu mesmo criei).
- **Nenhuma política de RLS alterada** — o SQL está em `docs/MIGRACAO_RLS.sql`, aguardando aprovação.
- **Nenhum preço alterado.**
- **Identidade visual intacta.**
- **Nenhuma funcionalidade removida.**
- **Nenhum segredo no código ou nos commits.**

---

## 9. Próximos passos, em ordem de impacto

1. **Corrigir a RLS** (`docs/MIGRACAO_RLS.sql`) — hoje qualquer um se dá plano premium e vira admin.
2. **Fazer o Velixir iniciar o Node** — sem isso, nada da API funciona em produção.
3. **Substituir as fontes de vídeo** — 450 filmes em site pirata, 12 episódios com CDN quebrado.
4. **Informar a série das temporadas órfãs** (12 episódios recuperáveis).
5. Configurar `SUPABASE_SERVICE_ROLE_KEY` e `TMDB_API_KEY`.
