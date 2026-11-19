# Mouse virtual e player limpo — 19/11/2026 (rodada 3)

Escopo respeitado: **somente o MovieFlix TV**. Nada do site público além do
player que o app TV usa, nada do app mobile, nenhuma migração de banco, nenhum
segredo novo.

## O que o proprietário pediu

1. **Login obrigatório** — "Assistir" sem sessão leva a Conta/Login; o player
   não abre sem autenticação.
2. **Mouse virtual** — segurar OK 2 s liga; segurar OK 2 s desliga; direcional
   move o cursor; OK clica na posição do cursor; com o mouse desligado a
   navegação convencional continua.
3. **Controle completo do player** — o mouse alcança os controles nativos
   (play/pause, barra, volume, tela cheia), sem duplicar botões.
4. **Ocultação automática** — 5 s sem interação esconde os controles; qualquer
   tecla os traz de volta.

## O que já existia (auditoria)

| Item | Estado encontrado |
| --- | --- |
| Login obrigatório (app TV) | **Já implementado** em `MainActivity.kt`: `onPlay` sem sessão → `TvRoute.Login` com `afterLogin = TvRoute.Player(...)`; a rota `Player` revalida `s.loggedIn`. |
| Login obrigatório (player web) | **Já implementado** em `PlayerPage.tsx`: `useEffect` redireciona a `/login` antes de qualquer requisição de autorização. |
| Auto-hide | **Já existia**: `UI_HIDE_MS = 5_000` no web e `TvPlayerTiming.UI_HIDE_MS = 5_000` no Kotlin. |
| Player único | **Já existia**: `TvProgressBar` é a única coisa desenhada sobre o vídeo; no embed a barra do provedor é a única. |
| Mouse virtual | **Não existia** em nenhum dos dois. |

Ou seja: dos quatro itens, três já estavam prontos de rodadas anteriores. O
trabalho desta rodada foi o **mouse virtual** — e a correção de um bug de
interação que ele revelou.

## Implementação

### Lógica pura (testável sem aparelho)

- `src/lib/virtualMouse.ts` — `VirtualMouse` (posição, limites, liga/desliga),
  `HoldDetector` (segurar 2 s) e `clickAtRatio` (fração da tela → clique real).
- `tv/.../player/VirtualMouse.kt` — as mesmas duas classes em Kotlin, para o app
  Android TV. Sem dependência de Android/Compose, então roda na JVM.

### Player web — `src/pages/PlayerPage.tsx`

- `keydown` de OK **sempre** inicia o `HoldDetector`; `keyup` decide:
  toque curto → clique (mouse ligado) ou play/pause (desligado);
  2 s → `mouse.toggle()`.
- Direcional: com o mouse ligado move o cursor; desligado mantém o
  comportamento antigo (← → seek de 10 s).
- Cursor desenhado em `.tv-cursor` (`src/styles/global.css`), com
  `pointer-events: none` para não interceptar o próprio clique.

### App TV — `tv/.../ui/screens/TvPlayerScreen.kt`

- Mesma regra nos dois players (`TvDirectPlayer` e `TvEmbedPlayer`).
- No modo direto o clique alterna play/pause e, sobre a faixa da barra, faz
  seek na posição do cursor.
- No modo embed o clique é enviado à ponte JS (`clickAt`/`clickAtY`), que
  despacha os eventos de mouse no elemento sob o ponto — é assim que o cursor
  alcança os controles do player do provedor.
- `VirtualCursor` desenha o círculo; `mouseVersion` força a recomposição
  (o estado do mouse é uma classe comum, não `State` do Compose).

## Bug encontrado pelos testes (e corrigido)

A primeira versão clicava **no keydown** quando o mouse estava ligado. Efeito:
o OK nunca iniciava o `HoldDetector`, então **era impossível desligar o mouse** —
o segundo "segurar 2 s" virava uma sequência de cliques.

O E2E em Chromium pegou isso (bloco `[6]`: "aos 2 s o mouse desliga" falhou).
Correção: o `keydown` sempre inicia a contagem; a ação do toque curto acontece
no `keyup`. Aplicada nos três lugares (web, player direto, player embed).

## Testes executados

| Verificação | Resultado |
| --- | --- |
| `npx tsc --noEmit` | ok (sem saída) |
| `npm run build` | ok — 106 módulos, 7,46 s |
| `bash scripts/test-tv-player.sh` (Kotlin/JVM) | **69 verificações, 0 falhas** (bloco `[12]` novo: mouse virtual) |
| `node scripts/test-tv-bridge.mjs` | **47 verificações, 0 falhas** (bloco `[8]` novo: clique na ponte) |
| `node scripts/test-virtual-mouse.mjs` | **39 verificações, 0 falhas** (novo) |
| `node scripts/test-virtual-mouse-e2e.mjs` (Chromium) | **19 verificações, 0 falhas** (novo) |
| `node scripts/tv-player-e2e.mjs` (Chromium) | **31 verificações, 0 falhas** |

## O que NÃO foi testado

- **Aparelho Android TV / TV Box real**: o APK é gerado pelo workflow
  `.github/workflows/build-apks.yml`; o travamento de foco do Compose e o
  redirecionamento de login só se confirmam no aparelho.
- **Player do provedor real**: o clique no iframe de outro domínio foi provado
  contra um DOM falso e contra a ponte, não contra o playerflix.ink em produção.
- **Volume e tela cheia**: o clique chega ao elemento sob o cursor (provado);
  se o provedor expõe esses botões naquele ponto depende do player dele.

## Como reverter

- **Mouse virtual**: remover o bloco `MOUSE VIRTUAL` do `useEffect` de teclado
  em `PlayerPage.tsx` e o `VirtualCursor`/`mouse` de `TvPlayerScreen.kt`.
- **Tempo de segurar**: `HOLD_MS` (web) e `HoldDetector(2_000L)` (Kotlin).
- **Passo do cursor**: `STEP_PX` (web) e `VirtualMouseState(stepPx = 28f)`.
