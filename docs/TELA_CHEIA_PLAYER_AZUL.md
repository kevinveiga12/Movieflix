# Tela cheia do player azul — causa raiz e correção (21/11/2026)

Registro do que estava errado, por que as tentativas anteriores não resolveram, e
o que mudou. Escopo respeitado: **somente o player**. Nada do design das outras
páginas, nada do Supabase/banco, nenhuma funcionalidade removida.

## O que o proprietário relatou

> "Clico aqui mas não entra na tela cheia no player."

Clicar no botão de tela cheia do player azul não fazia nada: não entrava em tela
cheia e os botões não sumiam.

## Por que a rodada anterior não resolveu

A rodada anterior implementou `onShowCustomView`/`onHideCustomView` no
`WebChromeClient` e removeu o overlay no modo embed. **Isso estava certo, mas não
era suficiente** — o pedido de tela cheia nunca chegava ao `WebChromeClient`.

O botão de tela cheia do player azul chama `element.requestFullscreen()`. O
`requestFullscreen()` é recusado **em silêncio** quando vem de um `iframe` de
outra origem e algum elo da cadeia não tem `allow="fullscreen"`. A cadeia aqui é
`myembed.biz → playerflix.ink → v2.watchplay.shop`, e não temos controle sobre o
atributo `allow` dos iframes internos do provedor. Resultado: a promise rejeita,
nada muda na tela, e o `WebChromeClient` nunca é chamado.

Conclusão: **a tela cheia não pode depender do provedor.** Ela tem de ser feita
do nosso lado.

## A causa raiz

| Sintoma | Causa real |
| --- | --- |
| Clicar em tela cheia não faz nada | `requestFullscreen()` do iframe é recusado em silêncio; o `onShowCustomView` nunca é acionado |
| Botões não somem | A UI do provedor **reaparecia** quando o "mouse virtual" era ligado — e o mouse virtual era o único caminho para alcançar o botão de tela cheia do provedor |
| OK precisava de várias pressões | Havia **dois** handlers de tecla: o do `Box` do Compose **e** o `setOnKeyListener` do WebView. Os dois disparavam o comando no mesmo toque |
| Anel amarelo | Foco do D-pad num botão do DOM do provedor |

## O que mudou

### `tv/.../ui/screens/TvPlayerScreen.kt`

1. **Tela cheia pelo nosso lado (ponte JS).** Novo comando
   `window.__mfCmd('fullscreen', 1)` que injeta CSS pondo o `<video>` em
   `position:fixed` cobrindo `100vw × 100vh`, com `z-index` acima de qualquer UI
   do provedor e `object-fit:contain` (não distorce). Não depende de
   `requestFullscreen`, nem de `allow`, nem de nenhum elo da cadeia de iframes.

2. **A UI do provedor fica escondida SEMPRE.** O modo `mouseMode` deixou de
   devolver a barra do provedor. Era ele que enchia a tela de botões duplicados
   (play, volume, tela cheia do provedor) por cima da nossa barra — exatamente o
   defeito das fotos do proprietário.

3. **Segurar OK alterna a tela cheia** (1,2 s). Antes esse gesto ligava/desligava
   o mouse virtual, que só existia para clicar na UI do provedor — e essa UI não
   existe mais. O gesto continua tendo uso, agora útil.

4. **Handler de tecla duplicado removido.** O `setOnKeyListener` do WebView foi
   apagado. Como o WebView não é focável (`isFocusable = false` +
   `FOCUS_BLOCK_DESCENDANTS`), ele nunca recebe o D-pad: o único handler é o do
   `Box`. **Um toque, um comando.**

5. **Mouse virtual removido do player embed.** Ele existia apenas para alcançar
   a UI do provedor. Sem ela, o cursor não tinha o que clicar. Foram removidos
   `moveMouse`, `clickAtCursor`, `VirtualCursor` e o desenho do cursor.

6. **Tela cheia em ambos os modos.** O modo direto (ExoPlayer) ganhou o mesmo
   comportamento: segurar OK entra/sai, a barra some.

7. **Voltar sai da tela cheia primeiro**, depois do player — nos dois modos.

8. **Tempo atual / duração na barra.** `TvProgressBar` voltou a mostrar
   `1:23:45 / 2:05:00` acima da barra, à direita. É a única escrita na tela e
   some junto com a barra. `formatClock` já existia e não era usado.

### `scripts/test-tv-bridge.mjs`

O `document` falso ganhou `createElement`, `head.appendChild` e
`getElementById('__mf_clean')` — sem isso a ponte lançava exceção ao montar o
CSS. Foram adicionadas **9 asserções de tela cheia**: CSS ligado/desligado,
`position:fixed`, `object-fit:contain`, `z-index`, `<video>` visível,
idempotência (sem evento duplicado) e um único elemento de estilo.

## Comportamento final do player (o requisito original, agora cumprido)

| Tecla | Ação |
| --- | --- |
| (ao entrar) | O vídeo começa sozinho |
| **OK** (toque) | Pausa / despausa — **um toque** |
| **OK** (segurar 1,2 s) | Entra / sai da **tela cheia** (só o vídeo, sem barra) |
| **←** / **→** | Retrocede / avança 10 s (segurando, acelera) |
| **Voltar** | Sai da tela cheia; de novo, sai do player |
| **↑** / **↓** | Não fazem nada (consumidas para o foco não escapar) |

Na tela: **somente o vídeo e uma única barra de progresso inferior**. Sem botões
superiores, menus, configurações, volume, legendas, seleção de servidor, tela
cheia ou controles duplicados. A barra aparece ao interagir e desaparece após
**5 s** sem interação — e então só o vídeo permanece visível.

## Como reverter

- `git revert` do commit desta rodada.
- Não há migração de banco, nem mudança de infraestrutura.
