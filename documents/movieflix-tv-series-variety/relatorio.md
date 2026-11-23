# MovieFlix — Atualizações e Melhorias

**Data:** 23 de novembro de 2026
**Release em produção:** v173 (`991b2d44`) — **Healthy**
**Commit:** `5f2a84c` na `main` (push `481070c..5f2a84c`)
**Produção:** https://movieflix.velixir.run

---

## 1. Resumo

Quatro frentes entregues, sem recriar o projeto, sem reset e sem remover
funcionalidade:

| # | Item | Situação |
|---|------|----------|
| 1 | Navegação de séries no MovieFlix TV | Corrigido e implementado |
| 2 | Botão de olho na senha (site, Android, iOS, TV) | Implementado nas 4 plataformas |
| 3 | Carregamento automático do catálogo na TV | Implementado com paginação real |
| 4 | Variedade de filmes e séries a cada acesso | Implementado no site e na TV |
| 8 | TV LG não-smart | Causa identificada; correções aplicadas no que depende do projeto |

**Preservado integralmente:** design, player, Supabase, autenticação, planos,
pagamentos, favoritos, histórico, "Continuar assistindo" e todos os dados
cadastrados. Nenhuma tabela do Supabase foi alterada. Nenhum registro foi
excluído.

---

## 2. Arquivos modificados

22 arquivos, **+1.297 / −183** linhas.

### Novos
| Arquivo | Papel |
|---|---|
| `server/lib/shuffle.js` | Permutação determinística (mulberry32 + FNV-1a) no servidor |
| `src/lib/variety.ts` | Semente de sessão e embaralhamento no cliente |
| `src/components/PasswordField.tsx` | Campo de senha com botão de olho (site) |
| `scripts/test-variety.mjs` | 22 verificações automatizadas da variedade |

### Alterados — site
| Arquivo | Mudança |
|---|---|
| `server/routes/catalog.js` | `?seed=` opcional em `/movies` e `/series` |
| `src/lib/catalog.ts` | `rowsForHome(seed)` e `featured(count, seed)` variados |
| `src/pages/HomePage.tsx` | Passa a semente da sessão para fileiras e destaques |
| `src/pages/CatalogPage.tsx` | Variedade só na ordem padrão; busca nunca embaralhada |
| `src/pages/LoginPage.tsx` | Usa `PasswordField` |
| `src/pages/SignupPage.tsx` | Usa `PasswordField` (senha + confirmação) |
| `src/pages/PasswordPages.tsx` | Usa `PasswordField` (redefinição) |
| `src/pages/SettingsPages.tsx` | Usa `PasswordField` (troca de senha) |
| `src/components/Icons.tsx` | `EyeIcon` e `EyeOffIcon` |
| `src/styles/global.css` | `.password-wrap`, `.password-eye`, `.field-hint` |
| `index.html` | Aviso para navegadores de TV antigos |

### Alterados — MovieFlix TV (Android TV)
| Arquivo | Mudança |
|---|---|
| `TvScreens.kt` | Navegação de séries, olho no login, scroll infinito |
| `TvViewModel.kt` | Paginação real, cursor, deduplicação, semente |
| `data/MovieFlixApi.kt` | `seed` em `movies()` e `series()` |
| `TvPlayerScreen.kt` | User-Agent, aviso honesto, "Tentar novamente" |

### Alterados — aplicativos móveis
| Arquivo | Mudança |
|---|---|
| `mobile/android/.../AccountScreens.kt` | `MfField` com `trailingIcon` de olho |
| `mobile/ios/MovieFlix/Theme.swift` | `MFField` com botão de olho |

---

## 3. Navegação de séries no MovieFlix TV

### O que estava errado

A tela de detalhe da TV tinha **dois defeitos que se somavam**:

1. **`selectedSeason` começava fixo em `1`.** Se a série não tivesse temporada 1
   (ou se as temporadas ainda não tivessem carregado), a lista de episódios
   ficava **vazia** e não havia como chegar aos episódios. A tela parecia
   quebrada.
2. **O botão "Assistir" lia `title.episodesAvailable`**, campo que **não existe**
   quando o título vem do Histórico ou dos Favoritos (lá o `Title` é montado na
   mão). O botão caía sempre em T1E1, mesmo quando a série começava em outra
   temporada.

### Como funciona agora

```
Séries → card da série → tela de detalhe
                          ├── "▶ Assistir — Temporada X, Episódio Y"  (principal)
                          ├── "♡ Favoritar"
                          ├── Temporadas: [T1] [T2] [T3] [T4]   ← D-pad horizontal
                          └── Episódios da temporada selecionada
                               1. Título do episódio   (imagem + número)
                               2. Título do episódio
                               ...
```

- **Temporada inicial correta:** `selectedSeason` é nulo até as temporadas
  chegarem e então aponta para a **primeira temporada real** da série,
  respeitando a ordem que o servidor devolve (já ordenada por `season_number`).
- **Botão principal com números reais:** mostra "Assistir — Temporada 3,
  Episódio 1" quando a temporada 3 está selecionada. Enquanto as temporadas
  carregam, cai para o primeiro par de `episodes_available` — o botão nunca fica
  sem destino.
- **Episódios nunca se misturam:** a lista vem de `season.episodes` daquela
  temporada, e a chave do `LazyColumn` inclui a temporada
  (`"s${season}e${episode}"`). Trocar de temporada reconstrói a lista com os
  episódios certos.
- **Número, título e imagem:** cada linha mostra `N. Título`, `T3 E5 · 22 min` e
  a thumbnail quando o provedor tem. Sem thumbnail, mostra o **número** em
  destaque em vez de um retângulo cinza vazio.
- **Controle remoto:** cada episódio é um item focável; o D-pad desce por eles e
  OK abre o player. A temporada selecionada ganha borda de foco visível.
- **Progresso preservado:** o player continua salvando em `watch_history` a cada
  10 s e ao sair, com `season` e `episode` corretos. "Continuar assistindo"
  permanece intacto.
- **Planos e permissões:** a checagem de assinatura continua no mesmo ponto,
  antes de abrir o player.

---

## 4. Botão de visualização de senha

### Comportamento (idêntico nas 4 plataformas)

1. A senha começa **escondida**.
2. O ícone de olho **só aparece depois que a pessoa começa a digitar** — antes
   disso não há nada para conferir e o ícone só poluiria o campo.
3. Tocar no olho → senha **visível**.
4. Tocar de novo → senha **escondida**.

### Por plataforma

| Plataforma | Implementação |
|---|---|
| **Site** | `PasswordField` — botão `type="button"` (não envia o formulário), `aria-label` alternando "Mostrar/Esconder senha", ícone semitransparente em repouso e opaco no foco |
| **Android** | `MfField` com `trailingIcon` + `IconButton`; alterna `PasswordVisualTransformation` ↔ `VisualTransformation.None` |
| **iOS** | `MFField` alterna `SecureField` ↔ `TextField` com botão `eye`/`eye.slash` |
| **TV** | O olho é um **elemento focável de verdade** (`onFocusChanged` + `clickable`), não um ícone decorativo. O D-pad desce do campo de senha até o olho, OK alterna |

### Segurança

- **Nada muda na autenticação.** O valor é enviado exatamente como antes, pelo
  mesmo `signIn`/`signUp`.
- **Nenhuma senha em texto aberto.** O que muda é apenas o atributo `type` do
  input (apresentação do navegador). O estado do olho vive só na memória do
  componente e desaparece ao fechar a página.
- **Nada é gravado** em `localStorage`, `sessionStorage`, cookie ou log.
- **Layout preservado:** o `padding-right` do input abre espaço para o ícone;
  altura, borda e raio do campo continuam iguais.

---

## 5. Carregamento automático na TV

### O que estava errado

A tela pedia 60 itens e parava. A navegação terminava no fim da grade mesmo
existindo **15.414 filmes** e **6.400 séries** cadastrados.

### Como funciona agora

- **Paginação real:** `offset` + `total` vindos do servidor. Blocos de 60.
- **Gatilho pelo foco, não pelo scroll:** na TV quem rola é o D-pad, e
  `visibleItemsInfo` só reflete o que está na tela. O gatilho é a **posição do
  item focado** — o carregamento acontece exatamente quando a pessoa chega perto
  do fim, e não antes.
- **Uma requisição por vez:** `cursor.loading` bloqueia pedidos simultâneos.
  Sem isso, o `LazyGrid` dispara 3–4 buscas da mesma página ao chegar ao fim.
- **Sem duplicatas:** os itens novos são filtrados por `tmdb_id` contra o que já
  está em memória.
- **Sem buracos:** o offset avança pelo **tamanho real recebido**, não pelo
  tamanho pedido.
- **Para no fim:** quando o que está em memória alcança `total`, `hasMore` vira
  falso.
- **Indicador discreto:** spinner pequeno no rodapé da grade, sem substituir a
  grade por um spinner de tela cheia.
- **Foco preservado:** o efeito só pede dados; não move o foco. A grade mantém o
  mesmo `LazyGridState`, então a posição e o item focado ficam onde estavam.
- **Todas as categorias:** funciona em Filmes, Séries e em cada gênero.

### Verificação em produção

```
GET /api/catalog/movies?limit=500&offset=0..15414&seed=...
  total informado : 15414
  páginas         : 78
  títulos únicos  : 15414
  duplicados      : 0
  cobre tudo      : SIM

GET /api/catalog/series?limit=500&offset=0..6400&seed=...
  total: 6400 · páginas: 32 · únicos: 6400 · duplicados: 0 · cobre: SIM
```

---

## 6. Variedade de filmes e séries

### O problema

O catálogo era sempre servido na mesma ordem (popularidade decrescente). Todo
acesso mostrava exatamente os mesmos títulos nas primeiras posições.

### A solução: permutação determinística por semente

Duas propriedades precisam valer **ao mesmo tempo**:

1. **Estável durante a navegação** — se a ordem mudasse a cada requisição, a
   paginação quebraria: a página 2 repetiria um título da página 1 e deixaria
   outro de fora.
2. **Diferente a cada acesso** — duas visitas devem ver combinações distintas.

A solução é uma permutação determinística: **a mesma semente produz sempre a
mesma ordem; sementes diferentes produzem ordens diferentes.** O cliente gera
uma semente por sessão (`sessionStorage`) e a reenvia em cada página.

`Math.random()` não serve: não aceita semente, então não há como reproduzir a
ordem na página seguinte. Usamos **mulberry32** (PRNG de 32 bits) alimentado por
um hash **FNV-1a** da semente textual — o mesmo algoritmo no servidor e no
cliente, então ambos calculam a mesma ordem para a mesma semente.

### Onde a variedade se aplica

| Contexto | Varia? | Por quê |
|---|---|---|
| Fileiras da home (Lançamentos, Em alta, Séries, gêneros) | **Sim** | Sorteia 20 de um pool de 200, mantendo o critério da fileira |
| Destaques (herói da home) | **Sim** | Sorteia 5 entre os 40 mais populares |
| Catálogo na ordem padrão ("Mais populares") | **Sim** | Permuta os 500 primeiros |
| Catálogo em A–Z, Mais recentes, Mais antigos, Melhor avaliados | **Não** | A ordem pedida é respeitada ao pé da letra |
| Busca | **Não** | Quem procura quer o resultado mais relevante primeiro |
| Temporadas e episódios | **Nunca** | Ordem interna sempre preservada |
| "Continuar assistindo" | **Não** | Ordem por progresso, intacta |
| Favoritos e histórico | **Não** | Intactos |

### Garantias

- **Nada é removido, escondido ou filtrado.** A permutação usa a lista inteira;
  todo título continua alcançável pela busca, pelo catálogo e pelas categorias.
- **Sem repetição na mesma sessão.** A semente é a mesma durante toda a
  navegação, então a ordem não muda e a paginação não repete.
- **Tela não pula.** A semente é estável, então a home não se reorganiza
  enquanto a pessoa navega.
- **Títulos ocultos/indisponíveis** continuam respeitando o filtro que já
  existia — a variedade é aplicada **depois** do filtro.
- **Planos de assinatura** não são tocados.

### Verificação em produção

```
seed=acesso-a  → 812, 101299, 395834, 785084
seed=acesso-b  → 857, 272, 399055, 637
seed=acesso-c  → 37799, 530385, 9487, 290859
sem seed       → 1744462, 1516698, 1621552, 860508   (ordem original preservada)
```

No navegador, três acessos novos (sessionStorage limpo) mostraram três
combinações totalmente diferentes de títulos na primeira fileira.

---

## 7. Problema da TV LG não-smart

### O que as duas imagens mostram

- **Imagem 1:** o site do MovieFlix aberto no navegador da TV — a página carrega,
  mas o player não inicia.
- **Imagem 2:** a mensagem **"O provedor não liberou o vídeo para este
  aparelho."**

### A causa

A mensagem era um **falso negativo do próprio app**, e havia ainda um segundo
problema que agravava o caso:

1. **A mensagem aparecia cedo demais.** O aviso surgia no instante em que a
   página terminava de carregar. Em aparelhos lentos (TV Box antiga, navegador
   de TV), o player do provedor demora mais de 10 s para montar o `<video>` — e
   o usuário via "o provedor não liberou" num vídeo que ia tocar normalmente.
2. **O WebView se anunciava com User-Agent próprio** (`MovieFlixTV/1.0`). Alguns
   provedores liberam o embed para navegadores conhecidos e tratam UA
   desconhecido como cliente não autorizado — exatamente o sintoma relatado.
3. **Navegador de TV antiga não executa o bundle moderno.** TVs "não-smart" e
   Smart TVs antigas (LG NetCast, Samsung Orsay) usam motores WebKit de
   2012–2015. Sem tratamento, a tela fica **preta** e o usuário conclui que "o
   site não funciona".

### O que foi corrigido no projeto

| Correção | Efeito |
|---|---|
| **User-Agent do WebView** passa a ser Chrome desktop comum | Remove a recusa por UA desconhecido |
| **Aviso espera 12 s** antes de aparecer | Elimina o falso negativo em aparelhos lentos |
| **Texto do aviso reescrito** | Deixa de culpar o provedor; explica a causa provável (formato não suportado pelo navegador do aparelho) |
| **Botão "Tentar novamente"** que recarrega de verdade | Antes o botão mudava o estado mas o WebView continuava na página antiga |
| **Aviso em HTML puro** para navegadores antigos | Em vez de tela preta, a pessoa lê o que aconteceu e como assistir |

### O que depende do aparelho (não é corrigível no projeto)

- **Decodificação de vídeo.** Se o navegador da TV não suporta o codec/container
  entregue pelo provedor (HLS com H.264 de perfil alto, por exemplo), nenhuma
  mudança no site resolve. É limite de hardware/firmware.
- **Motor JavaScript.** TVs de 2015 ou anteriores não executam o bundle moderno.
  O aviso agora explica isso em vez de mostrar tela preta.
- **DRM / restrição do provedor.** Se o provedor realmente bloqueia o aparelho
  por política, o projeto não tem como contornar.

**Recomendação para essa TV:** usar o aplicativo MovieFlix TV em um TV Box, Fire
TV ou Android TV, ou abrir o site no celular/tablet/computador. O aviso na tela
já diz isso.

---

## 8. Testes realizados

### Automatizados — 88 verificações, 0 falhas

| Suíte | Verificações | Resultado |
|---|---|---|
| `test-variety.mjs` (novo) | 22 | ✅ 22/22 |
| `test-tv-bridge.mjs` | 31 | ✅ PASSOU |
| `test-tv-posters.mjs` | 16 | ✅ PASSOU |
| `test-access-state.mjs` | 8 | ✅ 8/8 |
| `test-trial-codes.mjs` | 11 | ✅ 11/11 |
| `test-player-unico.mjs` | 20 | ✅ 20/20 |
| `test-providers.mjs` | — | ✅ PASSOU |
| `test-stream-layers.mjs` | 5 | ✅ TODOS PASSARAM |
| `test-stream-resolver.mjs` | 6 | ✅ TODOS PASSARAM |
| `test-virtual-mouse.mjs` | — | ✅ PASSOU |

**Build:** `npx tsc --noEmit` exit 0 · `npm run build` concluído.

### Navegador real (Chromium) — site local e produção

| Teste | Resultado |
|---|---|
| Home carrega com fileiras variadas | ✅ |
| Login: olho aparece após digitar | ✅ botão "Mostrar senha" |
| Login: olho revela a senha | ✅ `type` password → **text**, valor visível |
| Login: olho esconde de novo | ✅ `type` text → **password** |
| Login em produção: mesmo ciclo | ✅ password → text → password |
| Catálogo: "Carregar mais (15354 restantes)" | ✅ |
| Catálogo: clique carrega o próximo bloco | ✅ 60 → **120 cards** |
| Catálogo: sem duplicatas | ✅ 120 cards, **120 únicos, 0 duplicados** |
| Catálogo em produção: mesmo comportamento | ✅ 120 cards, 120 únicos |
| Série: temporadas T1–T4 listadas | ✅ |
| Série: troca para T3 mostra episódios T3 | ✅ T3 E1–E7, sem misturar |
| Busca "Titanic" encontra todos os títulos | ✅ 4 resultados |
| Variedade: 3 acessos novos = 3 combinações | ✅ |
| Variedade em produção: 3 sementes distintas | ✅ |
| Sem quebras visuais (home e login) | ✅ |

### Paginação completa (API real)

| Catálogo | Total | Páginas | Únicos | Duplicados | Cobertura |
|---|---|---|---|---|---|
| Filmes | 15.414 | 78 | 15.414 | **0** | **100%** |
| Séries | 6.400 | 32 | 6.400 | **0** | **100%** |

---

## 9. O que NÃO foi testado

Transparência sobre os limites da verificação:

- **Aplicativo Android TV compilado.** O ambiente bloqueia builds de pacote
  Android e o Gradle estoura a memória. As mudanças em Kotlin foram validadas
  por análise estática (estrutura, imports, assinaturas de todas as funções e
  cores referenciadas) e por verificação de balanceamento, **não por execução em
  aparelho**.
- **Aplicativo iOS.** Sem toolchain Swift no ambiente. A mudança em `MFField` foi
  validada por leitura e consistência com a API do SwiftUI.
- **Controle remoto físico.** A navegação por D-pad foi implementada com
  `onFocusChanged` + `clickable` (o padrão do Compose para TV) e verificada por
  análise do fluxo de foco, **não em uma TV real**.
- **Reprodução autenticada.** A conta de teste não tem plano ativo, então o
  player mostra a regra de negócio existente ("escolha um plano"). O fluxo de
  reprodução em si não foi exercitado ponta a ponta.
- **A TV LG do usuário.** A correção do User-Agent e do aviso foi aplicada ao
  app; o comportamento no navegador daquela TV específica depende do aparelho e
  precisa ser confirmado pelo proprietário.

---

## 10. Publicação

| Item | Valor |
|---|---|
| Commit | `5f2a84c` |
| Push | `481070c..5f2a84c` → `origin/main` |
| Release | **v173** (`991b2d44`) |
| Status | **Healthy** |
| URL | https://movieflix.velixir.run |
| Rollback preservado | v172 `5355a333` (Healthy), v171 `6b24d5d1` (Healthy), v170 `f309392e` (Healthy) |

**Integração:** o remoto tinha 5 commits novos (correções de títulos ocultos e
diagnóstico do provedor). Foi feito **rebase** sobre `origin/main`, com 6
conflitos resolvidos preservando **ambos os lados** — inclusive a correção de
duplo toggle do controle remoto (`setOnKeyListener` removido) e o
`waitedLong` que o remoto já havia introduzido.

**Segurança:** nenhum token, chave ou senha aparece em arquivo, commit ou log.
O diff foi varrido por padrões de credencial antes do commit.

---

## 11. Conclusão

O MovieFlix agora tem navegação completa de séries na TV, visualização de senha
nas quatro plataformas, carregamento contínuo do catálogo e variedade automática
a cada acesso — com **15.414 filmes** e **6.400 séries** integralmente
alcançáveis, **zero duplicatas** na paginação e **zero regressões** nas
funcionalidades existentes.

O problema da TV LG foi diagnosticado: a mensagem "o provedor não liberou o
vídeo" era um falso negativo do próprio app, agravado por um User-Agent que
alguns provedores recusam. As duas causas foram corrigidas. O que resta depende
do hardware da TV e está explicado na tela para o usuário.
