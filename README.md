# MovieFlix 2.0

Plataforma de streaming **gratuita** com catálogo do TMDB, player próprio, PWA instalável e painel administrativo. Código novo e independente, integrado ao Supabase existente.

> **Acesso 100% gratuito.** Não há planos, assinaturas, cobranças, Pix, Mercado Pago nem bloqueio de conteúdo por plano. Todo o catálogo é livre. A conta é opcional e serve apenas para favoritos, histórico e continuar assistindo.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Estilo | CSS moderno (design system próprio, sem framework) |
| Backend | Node.js + Express (API REST) |
| Banco | Supabase / PostgreSQL (projeto **existente**, preservado) |
| Catálogo | TMDB (metadados e imagens) |
| Player | `<video>` nativo + hls.js (MP4/HLS) e iframe para embed autorizado |
| PWA | Service worker próprio, manifest, instalável |
| Deploy | Render (blueprint em `render.yaml`) |

---

## Rodar localmente

```bash
# 1. Dependências
npm install

# 2. Variáveis de ambiente
cp .env.example .env
#    Preencha VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
#    SUPABASE_URL, SUPABASE_ANON_KEY, TMDB_API_KEY
#    (SUPABASE_SERVICE_ROLE_KEY só se for usar o painel admin)

# 3. Desenvolvimento (frontend + API)
npm run dev        # Vite em :5173 (proxy /api → :3001)
npm run server     # API em :3001

# 4. Produção local
npm run build
npm start          # Express serve dist/ + API em :3001
```

Acesse `http://localhost:3001` (produção) ou `http://localhost:5173` (dev).

---

## Estrutura

```
movieflix2/
├── src/
│   ├── components/       Navbar, Footer, Hero, CarouselRow, PosterCard, Icons
│   ├── context/          AuthContext (sessão + perfil + is_admin)
│   ├── lib/
│   │   ├── catalog.ts    carregamento, busca, filtros, ordenação, gêneros
│   │   ├── player.ts     resolução de fonte (direto vs embed), episódios
│   │   ├── supabase.ts   cliente do navegador (chave anon)
│   │   ├── userData.ts   favoritos e histórico (schema real do banco)
│   │   └── types.ts      tipos compartilhados
│   ├── pages/            Home, Catálogo, Busca, Detalhe, Player, Auth,
│   │                     Favoritos, Histórico, Perfil, Config, Admin
│   └── styles/global.css design system completo
├── server/
│   ├── index.js          Express, helmet, CORS, rate limit, SPA fallback
│   ├── lib/auth.js       requireAdmin (verifica is_admin NO BANCO)
│   ├── lib/store.js      overrides do catálogo (JSON, sem migração)
│   └── routes/           catalog, tmdb (proxy), admin
├── public/
│   ├── filmes/           catálogo JSON (filmes + séries)
│   ├── sw.js             service worker
│   └── manifest.webmanifest
├── scripts/gerar-catalogo.mjs   regenera o catálogo a partir do TMDB
└── render.yaml           blueprint do Render
```

---

## Integração com o Supabase existente

**Nenhuma tabela foi criada, alterada ou apagada.** O código se adapta ao schema que já existe.

Schema real verificado por sondagem de colunas:

```
profiles       id, email, full_name, avatar_url, is_admin, created_at
favorites      id, user_id, media_type, title, tmdb_id, created_at
watch_history  id, user_id, media_type, title, poster_url, tmdb_id,
               position_seconds, duration_seconds, progress, episode_id, updated_at
```

Notas de compatibilidade descobertas na prática:

- O identificador do título é **`tmdb_id`** (não `title_id`).
- `favorites` **não** tem `poster_url` — a capa vem do catálogo local.
- `watch_history.progress` é **INTEGER** (0–100), não fração.
- O episódio vai em **`episode_id`** no formato `"temporada/episódio"`.
- RLS está ativo: cada usuário só lê/escreve as próprias linhas (verificado).

### Chaves

| Variável | Onde vive | Para quê |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend | endpoint do projeto |
| `VITE_SUPABASE_ANON_KEY` | frontend | chave pública (protegida por RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor** | verificar `is_admin` de qualquer usuário |
| `TMDB_API_KEY` | **só servidor** | proxy do TMDB (o navegador nunca vê) |

A `service_role` **nunca** entra no bundle do frontend. Sem ela, `/api/admin` responde `503` — o site continua funcionando normalmente.

---

## Painel administrativo (`/admin`)

Acesso restrito a `profiles.is_admin = true`, verificado **no servidor** a cada requisição. Alterar `is_admin` no navegador não dá acesso.

O que dá para fazer:

- Ver estatísticas (usuários, favoritos, histórico, títulos editados)
- Listar usuários
- Buscar qualquer título do catálogo
- Editar título, sinopse, capa, banner, categoria, qualidade
- **Cadastrar a URL de reprodução** (fonte própria/autorizada)
- Ocultar título do catálogo

As edições são gravadas em `server/data/catalog-overrides.json` e aplicadas por cima do catálogo base. **Zero migração, zero risco ao banco, reversível.** Se o proprietário aprovar uma tabela `catalog_overrides` no futuro, só `server/lib/store.js` muda.

---

## Catálogo e TMDB

O catálogo é gerado offline e servido como JSON estático — a home abre instantânea e não gasta cota do TMDB a cada visita.

```bash
TMDB_API_KEY=xxx node scripts/gerar-catalogo.mjs --pages 20
```

O TMDB fornece **metadados e imagens, não os vídeos**. As URLs de reprodução são cadastradas pelo administrador, com fontes próprias e legalmente autorizadas. O projeto não extrai vídeos de plataformas de terceiros nem contorna proteções.

---

## Player

Dois modos, escolhidos automaticamente pela URL:

| URL cadastrada | Modo | Recursos |
|---|---|---|
| termina em `.mp4` / `.m3u8` / `.mpd` | **direto** | play/pause, ±10 s, barra de progresso, volume, mudo, legendas, tela cheia, retomada, salvar progresso, próximo episódio |
| qualquer outra (página do provedor) | **embed** | iframe em sandbox, tela cheia, próximo episódio |

Atalhos de teclado: `Espaço`/`K` play-pause · `←`/`→` ±10 s · `↑`/`↓` volume · `M` mudo · `F` tela cheia · `Esc` sair.

O progresso é salvo a cada 10 s e ao sair, e retomado ao reabrir.

---

## PWA

- `manifest.webmanifest` com nome, ícones, tema e atalhos
- Service worker com estratégia **segura**:
  - app shell → stale-while-revalidate
  - catálogo JSON → network-first (nunca grava resposta vazia)
  - imagens do TMDB → cache-first com limite de 220 entradas
  - **`/api/*` e requisições autenticadas → nunca cacheadas**
- Instalável no Android (Chrome) e iOS (Safari → Adicionar à Tela de Início)

---

## Deploy no Render

O `render.yaml` cria **um serviço novo** (`movieflix-web`) que serve frontend + API. Os serviços antigos não são tocados.

1. Render Dashboard → **New** → **Blueprint**
2. Selecione o repositório `kevinveiga12/Movieflix`
3. Preencha as variáveis marcadas `sync: false`
4. Apply

Health check: `GET /api/health`.

---

## Segurança

- `helmet` + CORS restrito por `CORS_ORIGINS`
- Rate limit global (240/min) e mais rígido no TMDB (60/min)
- `requireAdmin` valida o token e consulta `is_admin` no banco
- Validação de entrada no servidor (URLs só `http(s)`, limites de tamanho)
- Erros nunca vazam stack em produção
- Nenhum segredo no código, no bundle ou nos commits

---

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Vite em modo desenvolvimento |
| `npm run build` | typecheck + build de produção |
| `npm start` | Express servindo `dist/` + API |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run server` | API isolada em :3001 |

---

## Créditos

Metadados e imagens fornecidos pelo [TMDB](https://www.themoviedb.org/). Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.
