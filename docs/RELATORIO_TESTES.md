# Relatório de testes — MovieFlix 2.0

Data: 2026-11-17 · Ambiente: sandbox Linux, Node 20, Chromium headless

Este relatório separa **o que foi realmente executado** do que **não pôde ser testado**. Nada aqui é declarado como aprovado sem ter sido rodado.

---

## ✅ Testes executados e aprovados

### Build e tipos

| Teste | Comando | Resultado |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0 erros** |
| Build de produção | `npx vite build` | **sucesso** (5,4 s) |
| Bundle | — | vendor 162 kB · supabase 168 kB · player 598 kB (gzip 187 kB) |

### API (curl real contra o servidor rodando)

| Endpoint | Resultado |
|---|---|
| `GET /api/health` | 200 · `{status:"ok", version:"2.0.0"}` |
| `GET /api/catalog/movies?limit=2` | 200 · itens retornados |
| `GET /api/catalog/series` | 200 |
| `GET /api/catalog/genres` | 200 · gêneros separados por termo |
| `GET /api/admin/stats` sem token | **401** (bloqueado corretamente) |

### Rotas SPA (todas 200, sem 404/301)

`/` · `/filmes` · `/series` · `/pesquisa` · `/favoritos` · `/historico` · `/perfil` · `/configuracoes` · `/baixar-app` · `/admin` · `/login` · `/cadastro` · `/titulo/movie/:id` · `/assistir/:id`

> Bug encontrado e corrigido: `/filmes` retornava **301** porque colidia com a pasta `public/filmes`. Resolvido com `express.static(..., redirect: false)`.

### Navegador real (Chromium via `ab`)

| Página | Verificação | Resultado |
|---|---|---|
| Home | render + catálogo carregado | ✅ banner, carrosséis e capas |
| Filmes | grid + filtros | ✅ |
| Detalhe | banner, sinopse, botões | ✅ |
| Busca (`?q=batman`) | resultados | ✅ |
| Login | formulário | ✅ |
| Admin (sem login) | bloqueio | ✅ "Entre para acessar o painel" |
| Favoritos | lista | ✅ |
| Perfil | dados da conta | ✅ |

Inspeção visual por `understand_image` em 8 screenshots: **nenhum problema** de layout, imagem quebrada, texto cortado ou contraste.

> Bug encontrado e corrigido: o service worker gravava um catálogo vazio (`[]`) em cache quando a resposta falhava, deixando a home permanentemente em branco. Corrigido — só grava respostas com mais de 100 bytes, e a versão do cache foi incrementada.

### Autenticação real (Supabase de produção)

| Teste | Resultado |
|---|---|
| Cadastro (`/auth/v1/signup`) | **200** · usuário criado |
| Login (`grant_type=password`) | **200** · access_token válido |
| Login pela UI (Chromium) | ✅ redirecionou e exibiu "Minha conta" |
| Favoritar pela UI | ✅ botão virou "Nos favoritos" |
| Favorito aparece em `/favoritos` | ✅ "Cartas para Deus, 2026" |
| Insert em `favorites` | **201** |
| Insert em `watch_history` | **201** |
| Leitura filtrada por `user_id` | **200** |
| RLS (leitura sem filtro) | retorna **apenas** as linhas do próprio usuário ✅ |

> Descobertas que exigiram correção de código (o schema real difere do presumido):
> - identificador é **`tmdb_id`**, não `title_id`
> - `favorites` **não tem** `poster_url`
> - `watch_history.progress` é **INTEGER 0–100**, não fração (o banco rejeitou `0.2`)
> - episódio vai em **`episode_id`** como `"temporada/episódio"`
>
> O código foi adaptado ao banco. **Nenhuma tabela foi alterada.**

### Lógica do player (testes unitários reais)

15 asserções executadas com `node`, todas aprovadas:

- detecção de URL direta (`.mp4`, `.m3u8?t=1`) vs embed
- `movieSource` com e sem fonte
- `episodeSource` monta `/serie/{id}/{temporada}/{episodio}?lang=pt-BR`
- episódio inexistente → `null`
- `firstEpisode` / `nextEpisode` (incluindo último episódio → `null`)
- `formatTime` (0, 65 s, 3725 s, NaN)

### Limpeza

Todos os dados de teste (favorito + histórico) foram **removidos** do banco ao final. Verificado: `favorites` do usuário de teste = `[]`.

---

## ❌ Não testado — e por quê

| Item | Motivo |
|---|---|
| **Reprodução de vídeo real** | O sandbox bloqueia CDNs externas e o plano não permite gerar vídeo local. A lógica foi validada por testes unitários; o `<video>` em si não tocou um arquivo real. |
| **Embed do provedor** | `streambetter.shop` está atrás do Cloudflare, que bloqueia IPs de datacenter. Só abre em rede residencial/dispositivo real. |
| **Proxy do TMDB** | Sem `TMDB_API_KEY` no ambiente. O código responde `503` com mensagem clara quando a chave falta. |
| **Painel admin logado** | Exige `SUPABASE_SERVICE_ROLE_KEY` e um usuário com `is_admin = true`. Nenhum dos dois disponível. O bloqueio (401/403) foi testado; o fluxo autorizado não. |
| **Recuperação de senha por e-mail** | Depende de e-mail real e do redirect configurado no Supabase. |
| **PWA instalado** | Requer dispositivo/Chrome com suporte a instalação. O manifest e o SW foram servidos e registrados, mas a instalação não foi executada. |
| **Deploy no Render** | Bloqueado: o GitHub está inacessível (conta suspensa), então não há repositório para o Render clonar. |
| **Push no GitHub** | `403 — Your account was suspended` (conta `kevinveiga12`/`kevinveigaa`). Verificado agora, novamente. |

---

## Como validar o que falta

1. **Player**: cadastre uma URL `.mp4` pública em `/admin` → abra o título → confirme play, ±10 s, barra, volume, tela cheia e retomada.
2. **TMDB**: defina `TMDB_API_KEY` e rode `node scripts/gerar-catalogo.mjs`.
3. **Admin**: defina `SUPABASE_SERVICE_ROLE_KEY` e marque seu usuário com `is_admin = true` no Supabase.
4. **Deploy**: restaure a conta do GitHub, faça o push e aplique o `render.yaml`.
