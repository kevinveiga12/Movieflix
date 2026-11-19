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
