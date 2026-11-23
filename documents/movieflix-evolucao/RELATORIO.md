# MovieFlix 2.1 — Operação Evolução Completa

**Data:** 2026-11-23
**Commit inicial:** `0db331d` (main, produção v202)
**Commits finais:** `79fd917` (gêneros + QR) e `1ad0f57` (versão do APK)
**Release em produção:** **v208 — Succeeded** · app **Healthy**

---

## 1. Diagnóstico e preservação

| Item | Estado |
|---|---|
| Branch | `main`, limpa antes de começar |
| HEAD inicial | `0db331d` — docs do diagnóstico anterior |
| Produção antes | v202, Healthy, commit `0db331d` |
| Correção do player (79ec11e) | **Presente e intacta** em `tv/.../MovieFlixApi.kt` e `mobile/.../MovieFlixApi.kt` |
| Catálogo | 12.672 filmes · 1.965 séries · 4.312 temporadas · 50.423 episódios |

A correção de URL relativa→absoluta foi **verificada, não reimplementada**. Nenhum dos dois arquivos Kotlin foi tocado nesta rodada.

---

## 2. O que foi corrigido

### 2.1 Categoria "Action & Adventure" (site + servidor)

**Causa:** o TMDB usa nomes **compostos em inglês** para gêneros de série. O catálogo já tinha "Ação" e "Aventura" em português, então "Action & Adventure" aparecia como uma **categoria duplicada e em inglês** no filtro.

**Correção:** fonte única de normalização, em dois espelhos:
- `src/lib/genres.ts` (site)
- `server/lib/genres.js` (API)

`splitCategory()` desdobra `"Action & Adventure"` em `Ação` + `Aventura` e esconde o composto. **Nenhum gênero original é apagado** — o registro do catálogo não muda, só a apresentação e o filtro.

Aplicado nos **três caminhos** de filtro:
- `src/lib/catalog.ts` → `genresOf()`, `byGenre()`
- `server/routes/catalog.js` → `/api/catalog/genres`, `filterAndSort()`
- `server/lib/db-catalog.js` → `listMovies()` (fallback estático)

**Verificado em produção:**

| Consulta | Antes | Depois |
|---|---|---|
| `/api/catalog/genres` contém "Action & Adventure" | **sim** | **não** |
| Gêneros listados | 26 | **25** |
| `?genre=Ação` | — | **2.574 títulos** |
| `?genre=Aventura` | — | **1.505 títulos** |
| `?genre=Action & Adventure` | — | **0** (correto) |
| Bundle JS publicado contém a string | — | **0 ocorrências** |

Ação, Aventura, Comédia, Crime, Cinema TV e todas as demais foram preservadas.

### 2.2 Títulos relacionados

**Causa:** `relatedTo()` comparava `x.category === t.category` — a string **inteira** tinha de ser idêntica. Como as categorias vêm compostas e em ordens diferentes ("Ação, Aventura" vs "Aventura, Ação"), quase nada casava.

**Correção:** pontua por **gênero em comum** e desempata por popularidade. Continua **nunca misturando filme com série** (o pool já era `playableMovies()` ou `playableSeries()`).

### 2.3 QR Code de contratação na TV

**Novo endpoint:** `GET /api/plans/qr?plan=<code>&period=<1m|3m|12m>`

Gera o PNG do QR apontando para o **mesmo `whatsapp_url`** que o site usa. A mensagem (plano, duração, valor, e-mail) é montada no servidor por `whatsappMessage()` — o app não remonta o texto, então não há divergência. Os preços vêm de `priceFor()`, a mesma função da listagem.

**Tela na TV** (`TvScreens.kt`): ao tocar "Assinar pelo WhatsApp", abre o QR em 320 dp sobre fundo branco, com:
- **VOLTAR** (BackHandler) fecha e volta aos planos
- botão "Abrir no WhatsApp" para quem tem o app no aparelho
- botão "Voltar aos planos"
- nome do plano, período e valor abaixo do código

**Verificado de verdade** — decodifiquei o PNG com OpenCV:

```
Premium / 1 ano  → https://wa.me/5511943750307?text=...Plano: Premium
                    Duração: 1 ano  Valor: R$ 239,40
Básico / 3 meses → ...Plano: Básico  Duração: 3 meses  Valor: R$ 47,76
```

Conferência matemática: Premium 3990 × 12 × 0,5 = **R$ 239,40** ✓ · Básico 1990 × 3 × 0,8 = **R$ 47,76** ✓

Plano inexistente → **404** (não inventa preço).

### 2.4 Versão do APK da TV (inconsistência real encontrada)

A API e a página de downloads anunciavam **1.0.4**, mas o APK publicado em `storage/apps/movieflix-tv.apk` é **1.0.3** — lido do `AndroidManifest.xml` do arquivo real. A página oferecia uma versão que nunca foi compilada.

Corrigido para **1.0.3** em `server/routes/apps.js` e `src/pages/SettingsPages.tsx`. Quando um APK novo for gerado, atualizar os dois junto com o `versionName` do gradle.

---

## 3. Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `src/lib/genres.ts` | **novo** — normalização de gêneros (site) |
| `server/lib/genres.js` | **novo** — espelho no servidor |
| `src/lib/catalog.ts` | usa `splitCategory`/`hasGenre`; `relatedTo()` reescrito |
| `server/routes/catalog.js` | `/genres` e filtro usam o normalizador |
| `server/lib/db-catalog.js` | `listMovies()` usa `hasGenre` |
| `server/routes/plans.js` | **novo** `GET /api/plans/qr` |
| `server/routes/apps.js` | versão da TV 1.0.4 → 1.0.3 |
| `src/pages/SettingsPages.tsx` | fallback da versão da TV |
| `tv/.../ui/screens/TvScreens.kt` | tela de QR + `QrTarget` + import `BuildConfig` |
| `package.json` / `package-lock.json` | dependência `qrcode` |

**Nada foi tocado** em: player vermelho, design, cores, login, cadastro, autenticação, Supabase, banco, assinaturas, planos, preços, Mercado Pago, painel administrativo, favoritos, histórico, catálogo de títulos.

---

## 4. Testes executados

| Teste | Resultado |
|---|---|
| `npx tsc -b` | **0 erros** |
| `npm run build` | **sucesso** (8 s) |
| `node --check` em plans.js, genres.js, catalog.js, db-catalog.js, apps.js | **OK** |
| `splitCategory('Action & Adventure, Drama')` | `["Ação","Aventura","Drama"]` |
| `hasGenre('Action & Adventure','Ação')` | `true` |
| `hasGenre('Action & Adventure','Comédia')` | `false` |
| Servidor local :3999 — `/api/health` | **200** |
| Servidor local — `/api/plans/qr?plan=premium&period=12m` | **200, image/png, 7.897 B, 640×640** |
| Servidor local — QR com plano inexistente | **404** |
| Decodificação do QR (OpenCV) | **Premium / 1 ano / R$ 239,40** ✓ |
| Decodificação do QR (OpenCV) | **Básico / 3 meses / R$ 47,76** ✓ |

### Produção (HTTP real, após v208)

| Rota | Código |
|---|---|
| `/` | **200** |
| `/filmes` | **200** |
| `/series` | **200** |
| `/planos` | **200** |
| `/conta` | **200** |
| `/baixar-app` | **200** |
| `/api/health` | **200** |
| `/api/catalog/genres` | **200**, sem "Action & Adventure" |
| `/api/plans/qr?plan=basico&period=3m` | **200**, PNG 640×640 |
| `/api/apps/tv/download` | **200**, 10.890.041 B, `application/vnd.android.package-archive` |
| `/api/apps` | tv **1.0.3**, android **1.0.5** |

---

## 5. Publicação

| Item | Estado |
|---|---|
| Commit 1 | `79fd917` — gêneros + QR |
| Commit 2 | `1ad0f57` — versão do APK |
| Push para `origin/main` | **confirmado** (`git ls-remote` = `1ad0f57`) |
| Deploy | `POST /v1/apps/{id}/github/deploy` |
| Release | **v208 Succeeded**, commit `1ad0f57` |
| App | **Healthy** |
| Token GitHub | usado só em variável de ambiente de sessão; `git grep "ghp_"` → **0** |

Releases 203, 206 e 207 falharam por retenção de 1 GB da Velixir (o problema conhecido). A repetição passou na v208.

---

## 6. O que NÃO foi feito — e por quê

### 6.1 APK da TV não foi recompilado

O sandbox **bloqueia a compilação de APK** por política da plataforma: não há Java nem Android SDK, e pacotes gerados assim falham na instalação. Não existe caminho alternativo aqui.

**O que isso significa:** a tela de QR que escrevi em `TvScreens.kt` **está no código-fonte, mas não está no APK 1.0.3 que está no ar**. Ela só chega à TV na próxima compilação, feita numa máquina com Android SDK (ou pelo workflow de CI do repositório, que já commita o APK em `storage/apps/`).

**Não bumpei a versão** justamente por isso: anunciar 1.0.4 sem o arquivo existir seria mentira — e era exatamente o bug que encontrei e corrigi.

### 6.2 Reprodução ponta a ponta não testada

O `/api/playback/authorize` exige conta com plano ativo. Não tenho `SERVICE_ROLE_KEY` e **não contornei o gate de assinatura** para testar. A cadeia de resolução, o manifesto e os segmentos já foram provados em rodadas anteriores; falta o clique de play com conta pagante.

### 6.3 Não implementado nesta rodada

Escopo grande demais para um turno, e **não vou declarar como pronto o que não fiz**:

- **Múltiplos perfis por assinatura** (1+1 / 2+1 / 5+1) — exige migração de banco. **Nenhuma migração foi executada.**
- **Perfil infantil + PIN parental** — depende dos perfis.
- **Fotos de perfil** — depende dos perfis.
- **Pesquisa rápida no topo** — a lupa do Navbar e a página `/pesquisa` já existem e funcionam; o campo expansível inline não foi feito.
- **Expansão de provedores** — nenhum provedor novo integrado nesta rodada.
- **Auditoria de cobertura 99%** — precisa de job separado; não testei 50 mil episódios e não vou inventar percentual.

---

## 7. Sincronização entre plataformas

| Plataforma | Arquitetura | Efeito desta rodada |
|---|---|---|
| **Site** | React + Vite | Gêneros e relacionados **já no ar** (v208) |
| **Android (celular)** | WebView sobre `movieflix.velixir.run` (`mobile/shell`) | **Herda tudo automaticamente** — é o mesmo site |
| **Android TV** | Nativo, Compose + Media3 | Consome a mesma API; QR no código-fonte, **precisa de novo APK** |

O app Android de celular é um **shell WebView** apontando para o site — por isso as correções de gênero, relacionados e QR chegam sem reinstalação. O app de TV é nativo e consome `/api/plans` e `/api/playback/authorize` diretamente.

---

## 8. Riscos restantes

1. **APK da TV desatualizado** — o QR não está no aparelho até a próxima compilação. É o item mais visível.
2. **Retenção da Velixir** — deploys falham com frequência e exigem repetição. Não é regressão do código.
3. **Cobertura de reprodução** — segue limitada pela inexistência de fonte nos provedores atuais, não pelo código.
4. **`Sci-Fi & Fantasy` e `War & Politics`** — continuam em inglês. Não os desdobrei porque não há equivalente claro no catálogo em português ("Ficção Científica" e "Fantasia" existem separados, mas o mapeamento não é 1:1). Ficaram como estavam, sem inventar.

---

## 9. Rollback

```bash
git revert 1ad0f57   # versão do APK
git revert 79fd917   # gêneros + QR
```

Nenhuma migração de banco, nenhum dado alterado, nenhum título removido — o rollback é só de código.
