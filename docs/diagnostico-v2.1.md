# MovieFlix 2.1 — Diagnóstico e correção do player (TV e mobile)

**Data:** 2026-11-23
**Commit inicial:** `b4af80a` (branch `main`, sincronizado com `origin/main`)
**Commit da correção:** `79ec11e`
**Produção:** https://movieflix.velixir.run

---

## 1. O bug encontrado

O sintoma relatado na TV Philips — **tela preta, contador `0:00 / 0:00`, vídeo que não
inicia** — não era falha de fonte, de rede nem de autorização. Era um **erro de
construção de URL no cliente Android**.

### Cadeia do defeito

1. `server/lib/playback-chain.js` monta o proxy como **caminho relativo**:

   ```js
   url: `/api/stream.m3u8?u=${encodeURIComponent(r.stream.url)}&r=${encodeURIComponent(r.stream.referer)}`
   ```

   Isso está **correto para o site**: no navegador a origem da página já é
   `https://movieflix.velixir.run`, então o caminho relativo resolve sozinho.

2. `POST /api/playback/authorize` devolve esse mesmo caminho em `source.url` e
   `sources[].url`.

3. Os apps Android passavam a string **direto** ao ExoPlayer:

   ```kotlin
   setMediaItem(MediaItem.fromUri(url))   // url == "/api/stream.m3u8?u=..."
   ```

4. **No app não existe origem.** `MediaItem.fromUri("/api/...")` produz uma URI
   **sem esquema e sem host**. O ExoPlayer não tem como resolver, não emite erro de
   mídia tratável, e o player fica parado em `0:00 / 0:00` — exatamente o sintoma.

### Por que o site funcionava e a TV não

| Plataforma | Origem da página | Caminho relativo resolve? |
|---|---|---|
| Site (navegador) | `https://movieflix.velixir.run` | **Sim** |
| App Android / TV | não existe | **Não** |

O mesmo defeito afetava **os dois apps** (`tv/` e `mobile/`), porque ambos usam o
mesmo padrão de `authorizePlayback`.

---

## 2. A correção

**Arquivos alterados (2):**

- `tv/android/app/src/main/java/run/velixir/movieflix/tv/data/MovieFlixApi.kt`
- `mobile/android/app/src/main/java/run/velixir/movieflix/data/MovieFlixApi.kt`

`authorizePlayback` agora ancora as URLs no host da API antes de devolvê-las:

```kotlin
val r = json.decodeFromString<PlaybackResponse>(post("/api/playback/authorize", body, auth = true))
return r.copy(
    source = r.source?.let { it.copy(url = absolute(it.url)) },
    sources = r.sources.map { it.copy(url = absolute(it.url)) },
)

private fun absolute(url: String): String =
    if (url.startsWith("/")) "$baseUrl$url" else url
```

**Por que na camada de API e não no player:** a correção vale para qualquer
consumidor da resposta (player direto, embed, futuros), não só para a tela atual.
E é idempotente — URL já absoluta passa intacta.

**Nada mais foi tocado.** Nenhuma alteração no servidor, no resolvedor, no
Supabase, no design, no player vermelho, nos planos ou no catálogo.

---

## 3. Verificação executada

| Verificação | Resultado |
|---|---|
| `npx tsc -b` | **sem erros** |
| `npm run build` | **sucesso** — 110 módulos, `index-BkqZ95Mv.css` |
| `baseUrl` existe nos dois construtores | **confirmado** |
| `PlaybackResponse.source` / `.sources` existem | **confirmado** |
| Push para `origin/main` | **`79ec11e`** confirmado por `git ls-remote` |

### O que NÃO foi verificado

- **Reprodução real na TV.** O sandbox não tem Java nem Android SDK
  (`which java` vazio), então o APK **não foi recompilado** e não houve teste em
  aparelho físico. A correção está no código-fonte; ela só chega à TV na próxima
  compilação do APK.
- **Reprodução ponta a ponta com conta pagante.** O `authorize` exige plano ativo e
  não há `SERVICE_ROLE_KEY` disponível; o gate de assinatura não foi contornado.

---

## 4. Rollback

```bash
git revert 79ec11e          # desfaz só esta correção
# ou
git checkout b4af80a -- tv/ mobile/   # volta os dois arquivos ao estado anterior
```

A correção é isolada em 2 arquivos e não tem dependências — o revert é limpo.

---

## 5. Backlog — escopo NÃO executado nesta rodada

Os itens abaixo fazem parte do pedido original e **não foram executados**. Estão
listados como escopo pendente, não como concluídos.

### 5.1 Auditoria de cobertura do catálogo (meta 99%)

O catálogo tem **12.672 filmes, 1.965 séries, 4.312 temporadas, 50.423 episódios**.
Testar isso exige um **job automatizado separado**, com amostragem distribuída
(populares / intermediários / nicho), limites de concorrência e cache — não é
viável turno a turno nesta sessão. Medições anteriores (amostras pequenas, já
registradas no histórico do projeto): filmes ~48–62% funcionais, séries ~0–10%.

**Pendente:** rodar a auditoria completa e publicar os percentuais reais por
categoria, sem extrapolar amostra.

### 5.2 Expansão de fontes

Investigar e integrar novos provedores autorizados, com validação em 4 estágios
(`getVideo` → manifesto → variante → segmento com magic bytes). Nenhum provedor
novo foi integrado nesta rodada.

### 5.3 Paridade de UI entre plataformas

- **Filmes relacionados / Séries relacionadas:** o site já tem
  `relatedTo()` em `src/lib/catalog.ts` (filtra por `category`, ordena por
  popularidade) e a seção "Títulos relacionados" em `TitleDetailPage.tsx`. Falta
  **separar filmes de séries** e replicar na TV e no mobile.
- **Pesquisa rápida no topo:** o site tem lupa no `Navbar` que leva a `/pesquisa`.
  Falta o campo expansível com sugestões no topo de Início/Filmes/Séries.
- **Categoria "Action & Adventure":** existe nos dados do catálogo (vem do TMDB,
  ex.: `tmdb_id 4574`). Remover exige decisão sobre normalização de gênero — não
  foi tocado.
- **QR Code de contratação na TV:** não implementado.
- **Fotos de perfil, múltiplos perfis, perfil infantil, controle parental por PIN:**
  não implementados. Exigem migração de banco (tabela de perfis, RLS por perfil,
  hash de PIN) — nenhuma migração foi executada.

### 5.4 APK da TV

Não recompilado (sem Android SDK no ambiente). A página de downloads **não foi
alterada** — continua apontando para a versão existente, que é o correto enquanto
não houver APK novo de verdade.

---

## 6. Resumo

| Item | Estado |
|---|---|
| Bug da TV diagnosticado | **sim** — URL relativa no ExoPlayer |
| Correção aplicada (TV + mobile) | **sim** — commit `79ec11e` |
| tsc + build | **passou** |
| Push para `main` | **confirmado** |
| APK recompilado | **não** — sem Android SDK |
| Teste em aparelho físico | **não** |
| Auditoria 99% | **pendente** (backlog 5.1) |
| Novos provedores | **pendente** (backlog 5.2) |
| Perfis / PIN / QR / relacionados | **pendente** (backlog 5.3) |
