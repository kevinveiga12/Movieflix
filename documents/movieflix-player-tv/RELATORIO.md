# MovieFlix — Player fullscreen (site e Android) + cards da TV

**Data:** 26/11/2026 · **Branch:** `main` · **Produção:** https://movieflix.velixir.run

| | |
|---|---|
| Commit do player + TV 1.0.9 | `ad1be4c` |
| Commit dos cards 1.0.10 | `cd371cf` |
| Release Velixir | **259** — `Succeeded` → produção |
| APK da TV | **1.0.10** (`versionCode` 12) |
| `tsc -b` | 0 erros |
| `npm run build` | sucesso |

---

## 1. Causa raiz do problema do fullscreen

Não era um bug, eram **três** — e o primeiro escondia os outros dois.

### 1.1 O overlay saía da pintura em tela cheia

`src/styles/global.css` tinha:

```css
.player-stage:fullscreen .player-overlay,
.player-page.is-fullscreen .player-overlay {
  display: none !important;
}
```

O overlay inteiro — play/pause, barra de progresso, botão de sair, **e o próprio
sensor de toque** — era removido da pintura ao entrar em tela cheia.

O `pokeUi()` do toque funcionava: marcava `showUi = true`. Mas o elemento estava
com `display: none`, então **não havia o que pintar**. O sintoma que o cliente
relatou ("toco na tela e nada aparece") era exatamente isso. A única saída era
Escape no computador ou o botão Voltar no celular.

### 1.2 O sensor era uma faixa de 64 px no rodapé

```css
.player-stage:fullscreen .player-sensor {
  inset: auto 0 0 0;
  height: 64px;
}
```

Mesmo se o overlay voltasse, tocar no **meio** da tela não fazia nada: o toque ia
para o iframe do provedor, que desenha a própria barra. Nossa interface nunca
voltava.

### 1.3 O auto-hide nunca disparava

```tsx
useEffect(() => {
  if (!showUi) return
  const timer = setTimeout(() => setShowUi(false), UI_HIDE_MS)
  return () => clearTimeout(timer)
}, [showUi, current, playing, uiPoke])   // ← `current` aqui
```

`current` é a posição de reprodução, atualizada pelo evento `timeupdate` do
`<video>` — **cerca de 4 vezes por segundo**. Cada mudança recriava o
`setTimeout`, então o relógio de 5 s **nunca chegava ao fim** enquanto o filme
rodava. A barra ficava permanentemente sobre a imagem.

Esse era o "elementos da interface ficam aparecendo sobre o filme" — e ele
acontecia **mesmo fora** da tela cheia.

---

## 2. Arquivos modificados — site

### `src/styles/global.css`

| Antes | Depois |
|---|---|
| `.player-overlay { display: none !important }` em tela cheia | overlay permanece montado, obedece ao `opacity` normal |
| `.player-top-info` visível | `display: none` em tela cheia (título/subtítulo são da página, não do vídeo) |
| gradiente padrão | gradiente mais suave em tela cheia, para não comer a imagem |
| sensor: faixa de 64 px no rodapé | sensor: `inset: 0` — cobre a tela toda |

### `src/pages/PlayerPage.tsx`

- **Auto-hide:** dependências passaram de `[showUi, current, playing, uiPoke]`
  para `[showUi, uiPoke, holdUi]`. Só interação real adia o relógio.
- **`holdUi`:** novo estado. `onPointerDown` na barra de progresso liga;
  `onPointerUp` / `onPointerCancel` / `onPointerLeave` desligam. Sem isso a
  barra sumia no meio de um seek — o pedido explícito é "não esconder enquanto
  o usuário estiver interagindo com a barra de progresso".
- **Sensor:** classe condicional — `player-sensor` (tela toda) em tela cheia,
  `player-sensor--strip` (faixa) no modo normal.

---

## 3. Arquivos modificados — Android

`mobile/android/app/src/main/java/run/velixir/movieflix/ui/screens/PlayerScreen.kt`

### 3.1 Botão Voltar

O player abre em tela cheia (`immersive = true`). Sem handler, o Voltar pulava
direto para os detalhes **deixando o imersivo ligado** — as barras do sistema
continuavam escondidas na tela seguinte e o app parecia travado.

```kotlin
androidx.activity.compose.BackHandler(enabled = immersive) {
    immersive = false
}
```

Primeiro Voltar sai da tela cheia; segundo Voltar sai do player.

### 3.2 Botão de sair da tela cheia no modo direto

O `EmbedPlayer` já tinha o ✕. O `DirectPlayer` (MP4/HLS, o modo mais comum)
**não tinha nenhum** — e como as barras do sistema estão escondidas, o cliente
ficava sem saída visível. Adicionado no canto superior direito, só em tela cheia.

`activity-compose` já está nas dependências, então `BackHandler` compila sem
alterar o Gradle.

---

## 4. Arquivos modificados — TV

### `TvScreens.kt`

| Item | Antes | Depois |
|---|---|---|
| `GridCells.Adaptive` | 180 dp | **130 dp** |
| `verticalArrangement` | 22 dp | 16 dp |
| campo de busca | altura livre | `height(46.dp)` |
| margem das fileiras de chips | 8 dp | 4 dp |

### `TvComponents.kt`

| Item | Antes | Depois |
|---|---|---|
| `TvPageTitle` | 22 sp, padding 12/8 | 20 sp, padding 6/4 |
| `TvChip` | 18/6 dp | 14/4 dp |
| padding do card | 6 dp | 4 dp |
| título do card | 13 sp / lineHeight 16 | 12 sp / lineHeight 15 |

**O tamanho e a proporção dos cards não mudaram** — `aspectRatio(2f/3f)` intacto.
Mudou o enquadramento e a densidade da grade.

### Como cheguei aos 130 dp

Não chutei. Medi as capturas do emulador `tv_1080p` do run `45737555475`:

```
poster columns (start,end,width):
   (48, 438, 390)
   (450, 840, 390)
   (852, 1242, 390)
count = 3
```

3 colunas de 390 px = 195 dp cada, com área útil de ~580 dp. Com
`minSize = 150 dp` o Compose calcula `floor(580 / 150) = 3`. Para 4 colunas é
preciso `minSize ≤ 145 dp`; usei **130 dp** para ter folga.

---

## 5. Testes realizados

### Site — build e bundle

```
npx tsc -b        → 0 erros
npm run build     → concluído
```

Verificação no **CSS publicado em produção** (não no `dist/` local):

```
player-page.is-fullscreen .player-sensor{display:block   → 1 ocorrência
player-page.is-fullscreen .player-overlay{display:none   → 0 ocorrências
```

E no **JS publicado**:

```
onPointerDown    → presente
onPointerCancel  → presente
holdUi           → presente
```

### Rotas em produção

```
/              200
/filmes        200
/series        200
/planos        200
/conta         200
/baixar-app    200
/api/health    200
```

### APK

```
GET /api/apps/tv/download → http=200  bytes=10939817
sha256 = 7960b21140a9a2a76b28cb04b056dcfd9f61594c677c7a8cf226b3a5cfba1108
```

E o mesmo SHA no manifesto servido pela API e no arquivo versionado no repo:

```
/api/apps/tv/version  → version 1.0.10, versionCode 12, sha 7960b211…1108
origin/main:storage/apps/tv-version.json → version 1.0.10, sha 7960b211…1108
```

Li a versão **dentro do APK**, no `AndroidManifest.xml` binário:

```python
sorted(set(re.findall(r'1\.0\.\d+', manifest)))  →  ['1.0.10']
```

Não é só o nome do arquivo — o binário é 1.0.10.

`/api/apps` → `tv.version: 1.0.10`, `sizeBytes: 10939817`, com a nota de
atualização pedida.

### Emulador de TV

As capturas do run `45737555475` (build 1.0.9) foram lidas e medidas — foi
assim que descobri que 150 dp ainda dava 3 colunas. No run `45739628097`
(1.0.10) as etapas 1–17 passaram, incluindo `Build TV`, `Verificar conteudo
dos APKs` e `Publicar APK Android no site`; as etapas de emulador (18–19)
ainda estavam rodando quando encerrei, então **não há captura do 1.0.10**.

---

## 6. O que NÃO testei

**Não abri o site num navegador real com toque.** Verifiquei que o CSS e o JS
corretos estão publicados e que o build passa, mas o comportamento de toque em
tela cheia — primeiro toque mostra, segundo esconde, 5 s de inatividade — não
foi exercitado por mim num dispositivo. A lógica é determinística e o defeito
era claro, mas não vou chamar de "testado" o que não rodei.

**Não instalei o APK num aparelho Android real.** O sandbox não tem Java nem
Android SDK; a compilação roda no GitHub Actions, que é o ambiente oficial do
projeto. O `BackHandler` e o botão ✕ compilam (o job `Build` passou), mas o
comportamento do Voltar num celular não foi observado.

**Não vi na sua TV.** As capturas do emulador são a evidência mais próxima.

---

## 7. Estado da publicação

| Etapa | Estado |
|---|---|
| Commit `ad1be4c` (player + TV 1.0.9) | ✅ push em `main` |
| Commit `cd371cf` (TV 1.0.10) | ✅ push em `main` |
| Release Velixir 259 | ✅ `Succeeded` |
| Deploy em produção | ✅ `startedAt` novo, `/api/health` 200 |
| APK 1.0.10 compilado | ✅ job `Build TV` success |
| APK 1.0.10 publicado | ✅ SHA `7960b211…1108` confere com o manifesto |
| Página de downloads | ✅ `/api/apps` e `/api/apps/tv/version` em 1.0.10 |
| Notas de versão no site | ✅ 1.0.10 com a descrição pedida |
| Capturas do emulador 1.0.10 | ⏳ etapas 18–19 ainda rodando |

### Rollback

```bash
git revert cd371cf ad1be4c
```

Nenhuma tabela do Supabase foi tocada. Nenhum preço, plano, catálogo, perfil,
favorito ou histórico foi alterado. O player da TV não foi modificado.
