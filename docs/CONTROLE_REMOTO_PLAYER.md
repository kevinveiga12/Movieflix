# Player no controle remoto — mudanças de 19/11/2026

Registro do que mudou, por quê, e como reverter. Escopo respeitado: **não** se
alterou design do site, Supabase/banco, nem qualquer funcionalidade existente.

## Problemas relatados

1. Na TV, pausar/despausar exigia **vários toques** em OK.
2. No player apareciam **duas barras de controles sobrepostas**, com dois
   botões de pause (um da MovieFlix, outro do player do provedor).
3. Os controles ficavam na tela para sempre, cobrindo o filme.
4. No app MovieFlix TV, tentar assistir **sem login** abria o player.

## Causas encontradas

| Sintoma | Causa |
| --- | --- |
| OK não alternava de primeira (site) | O handler de teclado só tratava `Espaço` e `k`. Na TV o botão OK chega como `Enter`/`MediaPlayPause` — nenhum dos dois era tratado, então o toque não fazia nada e o usuário clicava de novo. |
| OK não alternava de primeira (TV) | O **auto-repeat** do controle gerava dois toggles no mesmo toque (`repeatCount > 0` também contava). O primeiro pausava, o segundo despausava: o vídeo voltava ao estado anterior. |
| OK "engolido" | A ponte JS enviava o comando antes de o `<video>` do provedor terminar de montar; o comando se perdia e não havia reenvio. |
| Duas barras sobrepostas | O app desenhava a própria barra de progresso **embaixo**, exatamente sobre a barra do player do provedor dentro do iframe. No site, o modo embed também renderizava um bloco `player-bottom` por cima do iframe. |
| Controles sempre visíveis | Não existia auto-hide (nem no site, nem na TV). |
| Player abria sem login | `TvRoute.Player` era construído direto do botão "Assistir"; a checagem de sessão vinha depois, dentro da tela, e só mostrava um aviso. |

## O que foi alterado

### Site — `src/pages/PlayerPage.tsx`

- **OK/Enter alterna play/pause**: o handler agora trata `Enter`,
  `MediaPlayPause`, `MediaPlay` e `MediaPause` além de `Espaço`/`k`.
- **Auto-hide de 3 s** (`UI_HIDE_MS`): a cada interação (`pokeUi()`) o relógio
  reinicia; passados 3 s sem nada, os controles somem.
- **Uma barra só no modo embed**: o rodapé (`player-bottom`) passou a ser
  renderizado **apenas** no modo direto. No embed, as ações da MovieFlix
  (próximo episódio, tela cheia) foram para o topo.
- Setas: `←`/`→` retrocedem/avançam 10 s; `↑`/`↓` sobem/descem o volume (e `↑`
  desfaz o mudo, senão subir o volume não teria efeito audível).

### Site — `src/styles/global.css`

- Nova variante `.player-overlay--minimal` (modo embed): o overlay deixa de ser
  uma faixa de tela inteira e vira uma pílula de botões no canto superior, que
  não disputa espaço com a barra do provedor.

### App TV — `tv/.../player/TvPlayerControls.kt`

- `PlayPauseController` ganhou memória de **alvo** (`expected`) e `retry()`:
  se o player não reportar o novo estado em 400 ms (`TOGGLE_CONFIRM_MS`), o
  comando é reenviado de forma **explícita** (`play` ou `pause`, nunca um novo
  toggle — que desfaria o que já funcionou). Máximo de 3 envios.
- Nova classe pura `UiVisibility` com `poke()`/`tick()` para o auto-hide de 3 s
  (`UI_HIDE_MS`). Usa `null` como "sem interação ainda" em vez de `0`, senão a
  barra nasceria escondida (o `uptimeMillis()` da TV já está em milhares).

### App TV — `tv/.../ui/screens/TvPlayerScreen.kt`

- `doToggle(repeatCount)`: **ignora `repeatCount > 0`** — um toque = um toggle.
- Relógio de 50 ms agora também chama `toggle.retry()` e `ui.tick()`.
- `TvPlayerOverlay` ganhou `visible` e `showBar`. No modo **embed**,
  `showBar = false`: a única barra na tela é a do player do provedor. No modo
  **direto** (ExoPlayer, sem terceiro), `showBar = true` — continua sendo a única.
- Toda tecla chama `ui.poke()`; a dica central (`⏸ Pausado`, `+10s`, `🔊 70%`)
  continua aparecendo mesmo com a barra escondida, para confirmar que a tecla
  foi entendida.

### App TV — `tv/.../MainActivity.kt`

- `onPlay` do detalhe: sem sessão → `TvRoute.Login` (não `Player`).
- A rota `Player` revalida `s.loggedIn`; sem sessão, redireciona ao login.
- `afterLogin`: guarda a tela do título para voltar a ela depois de entrar, em
  vez de cair no menu de conta e perder o filme escolhido.

## Testes

| Verificação | Resultado |
| --- | --- |
| `npm ci --include=dev` | ok |
| `npx tsc --noEmit` | ok (sem saída) |
| `npm run build` | ok — 105 módulos, 7,3 s |
| `bash scripts/test-tv-player.sh` | **52 verificações, 0 falhas** (2 blocos novos: `[10]` OK de primeira, `[11]` auto-hide) |
| `node scripts/test-tv-bridge.mjs` | 31 verificações, 0 falhas |
| `node scripts/test-tv-posters.mjs` (servidor em :3999) | 16 verificações, 0 falhas |
| `node scripts/test-access-state.mjs` | 8 verificações, 0 falhas |
| `./gradlew :app:compileDebugKotlin` | BUILD SUCCESSFUL |

O APK não é gerado nesta máquina: o pacote é produzido pelo workflow
`.github/workflows/build-apks.yml` do repositório.

## Como reverter

Cada ponto é independente:

- **Auto-hide diferente**: `UI_HIDE_MS` em `PlayerPage.tsx` e
  `TvPlayerTiming.UI_HIDE_MS` em `TvPlayerControls.kt`.
- **Reenvio do OK**: `TOGGLE_CONFIRM_MS` / `TOGGLE_MAX_ATTEMPTS` (0 tentativas
  desliga o reenvio).
- **Barra única**: `showBar`/`visible` em `TvPlayerOverlay` e a condição
  `source?.mode === 'direct'` no rodapé do site.
- **Login obrigatório**: `onPlay` em `MainActivity.kt`.

Nenhuma migração de banco, nenhuma mudança de schema, nenhum segredo novo.

---

# Rodada de 19/11/2026 (2) — player "só a barra" e foco travado

Repositório correto desta rodada: **kevinveiga12/Movieflix**, branch **main**
(o clone anterior apontava para `kevinveigaa/Movieflix`, que não é o repositório
de produção).

## O que o proprietário pediu

> "Eu não quero que apareça mais nada no player, mais nada no filme, mais nada
> na tela. Somente a barra de progresso e que funcione os botões. Só isso."

a) autoplay ao abrir; b) só a barra de progresso; c) OK pausa/despausa;
d) ← → seek; e) Voltar sai; f) o foco não pode sair do player nem revelar
elementos escondidos.

## Causa raiz da borda amarela e do OK "não funcionar"

O player do provedor roda num **WebView**. Na versão anterior o WebView era
**focável** (`isFocusable = true` + `requestFocus()`), então ele recebia o
D-pad. Dentro dele o Chromium fazia a **navegação de foco do DOM**: cada OK
movia o foco para o próximo elemento focável da página do provedor (o painel
"ASSISTIR", a engrenagem, o ícone de tela cheia) e desenhava o **anel de foco
amarelo** em volta dele — exatamente a borda do canto superior direito das
fotos. Como o foco estava no DOM e não no nosso player, o OK deixava de chegar
ao handler: era preciso apertar várias vezes.

## Correção (a causa, não o sintoma)

`tv/.../ui/screens/TvPlayerScreen.kt`:

1. O WebView **deixa de ser focável** e bloqueia o foco dos descendentes
   (`isFocusable = false`, `descendantFocusability = FOCUS_BLOCK_DESCENDANTS`).
   O D-pad nunca entra no DOM do provedor.
2. O D-pad é tratado no **Box do Compose** que envolve o WebView — o único
   elemento focável da tela. `↑ ↓` são consumidas para o foco não escapar.
3. A ponte JS apaga **qualquer** `outline`/`box-shadow` de foco
   (`*:focus{outline:none!important;box-shadow:none!important}`) e faz
   `blur()` no elemento ativo a cada 500 ms — nem um `focus()` do provedor
   desenha borda.
4. A UI do provedor é escondida **sempre** (não só quando o `<video>` é
   encontrado), então não sobra nada para o foco revelar.
5. `TvPlayerOverlay` foi substituído por `TvProgressBar`: **só** a barra.
   Removidos o ícone de play/pause, o tempo escrito, a dica de teclas, o
   gradiente e o painel. Nada de volume, legendas, qualidade, ajustes.

`tv/.../MainActivity.kt` (login):

- Sem sessão, "Assistir" e a rota `Player` levam ao **login** guardando
  `afterLogin = TvRoute.Player(...)`; depois de entrar a pessoa cai **direto no
  player** do título escolhido (antes voltava só para a tela do título).

## Bug encontrado pelo teste E2E (e corrigido)

A lista de seletores CSS da ponte tinha **vírgula dupla** (`,,`) entre as
linhas do array — isso invalida a regra inteira e a UI do provedor continuava
visível. O teste Playwright pegou; a lista foi corrigida.

## Testes desta rodada

| Verificação | Resultado |
| --- | --- |
| `npx tsc --noEmit` | ok (sem saída) |
| `npm run build` | ok — 105 módulos, 5,96 s |
| `bash scripts/test-tv-player.sh` (Kotlin/JVM) | **47 verificações, 0 falhas** |
| `node scripts/test-tv-bridge.mjs` | **32 verificações, 0 falhas** |
| `node scripts/tv-player-e2e.mjs` (Playwright/Chromium) | **31 verificações, 0 falhas** |

O E2E monta o DOM do provedor (painel "ASSISTIR", engrenagem, tela cheia,
barra própria, dica de teclas), injeta a ponte extraída do Kotlin e um
`<video>` real, e mede: autoplay, UI escondida, ausência de anel amarelo, OK
alternando 4×, seek real, estado reportado e zero erros de JS. Screenshot em
`docs/screenshots/player-tv-limpo.png`.

**Não coberto por teste automatizado** (código Android, só no aparelho/
emulador): o travamento de foco do Compose e o redirecionamento de login. O
APK é gerado pelo workflow `.github/workflows/build-apks.yml`.
