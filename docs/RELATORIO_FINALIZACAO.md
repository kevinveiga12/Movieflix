# MovieFlix 2.0 — Relatório de Finalização

**Data:** 18/11/2026
**Repositório:** https://github.com/kevinveiga12/Movieflix (branch `main`)
**Produção:** https://movieflix.velixir.run
**Commit publicado:** `332f1c59efb7dd24dbad8ca04d6d9c4f4268e8b2`

---

## 1. Ponto de partida real

O ambiente desta execução começou **vazio**: o projeto não estava presente. O
repositório foi clonado do GitHub, cujo HEAD remoto era `56708e9`.

> **Os commits locais `15820f5` e `4f4ac47` NÃO existem neste ambiente nem no
> GitHub.** Eles só existem na máquina Windows do proprietário. Não foi possível
> recuperá-los nem publicá-los daqui — ver seção 9.

---

## 2. Causa raiz do problema do player (diagnóstico com teste real)

O sintoma relatado — *"clico em reproduzir, sou jogado para outro site, e ao
voltar aparece reprodução bloqueada"* — foi reproduzido e a causa foi isolada.

**Todo o catálogo aponta para `streambetter.shop`.** Ao abrir
`https://streambetter.shop/filme/1621` dentro de um iframe, o servidor responde
com um **desafio anti-bot do Cloudflare Turnstile**:

```
Confirmando que você é uma pessoa de verdade antes de carregar o vídeo...
```

Esse desafio **não se completa dentro de um iframe**. A página então tenta
escapar do frame — é exatamente o redirecionamento para fora do MovieFlix. Ao
voltar, o player não tem fonte válida e mostra o bloqueio.

### Provedores testados em navegador real (Chromium/Playwright)

| Provedor | Resultado |
|---|---|
| `streambetter.shop` | Desafio Turnstile — não reproduz em iframe (com ou sem sandbox) |
| `vidsrc.to` | Recusa explicitamente: *"this content can't be embedded in a sandboxed frame"* |
| `vidlink.pro` | *"Please Disable Sandbox"* — só toca se o sandbox for removido |
| `2embed.cc` | Carrega a página, mas o player interno fica em `about:blank` (exige clique manual) |
| `embed.su`, `multiembed.mov`, `vidsrc.icu`, `vidsrc.pro` | Não entregam player |

**Conclusão técnica:** nenhum embed de terceiro permite reprodução incorporada
**mantendo** as proteções que impedem pop-up e navegação da janela principal.
Fazer o StreamBetter tocar exigiria remover o `sandbox` e liberar
`allow-popups` — precisamente o que causa o redirecionamento e os anúncios
relatados. Isso não foi feito: seria trocar um problema por outro pior.

---

## 3. O que foi corrigido

### 3.1 Player — redirecionamento externo eliminado

**Arquivos:** `src/lib/player.ts`, `src/components/EmbedPlayer.tsx` (novo),
`src/pages/PlayerPage.tsx`, `src/styles/main.css`

- O iframe agora usa **sandbox restritivo**:
  `allow-scripts allow-same-origin allow-presentation allow-forms`.
  **Sem** `allow-popups` e **sem** `allow-top-navigation` — o provedor
  fisicamente não consegue abrir aba nova nem trocar a página do MovieFlix.
- O aviso técnico **"Fonte externa — este título usa um player de terceiros…"**
  foi **removido** da tela do cliente.
- Falha real agora vira um estado curto, em português, na identidade visual:
  *"Conteúdo indisponível agora — Não conseguimos iniciar este título no
  momento. Tente novamente em instantes."* com botão **Tentar novamente**.
- Detecção real de falha (não CSS escondendo): se o player não entregar em 12 s,
  o estado de indisponibilidade aparece. Sem spinner eterno.

### 3.2 Séries — bug que quebrava 8.093 títulos

**Arquivos:** `src/lib/catalog.ts`, `server/lib/static-catalog.js`,
`server/lib/db-catalog.js`

O catálogo grava `type: "series"`, mas **todo o código compara com `"tv"`**.
A normalização citada no relatório anterior **não estava no repositório remoto**.
Consequências reais:

- a página da série dizia "não encontrada";
- o player tratava série como filme e o servidor respondia `no_source`;
- o botão de episódio não aparecia.

Corrigido em três pontos: normalização no carregamento do catálogo (frontend),
no parse do catálogo estático (servidor) e no `toTitle` do banco.

**Verificado:** 8.093 séries agora com `type: "tv"`; 18.080 filmes com
`type: "movie"`; nenhum filme classificado como série.

### 3.3 Título 1621 — o caso citado no pedido

**Arquivo:** `src/pages/PlayerPage.tsx`

`1621` **não é um filme** — é *Boardwalk Empire: O Império do Contrabando*,
série de 5 temporadas e 56 episódios. O link `/assistir/1621` (sem `?type=tv`)
fazia o player pedir autorização **como filme**, o servidor não achava fonte e
devolvia "sem fonte de reprodução".

Agora, quando `?type=` não vem na URL, o player **detecta o tipo real pelo
catálogo**.

**Verificado em produção:** `/assistir/1621` reconhece "Boardwalk Empire" e
mostra o gate de login (correto), em vez de "sem fonte".

### 3.4 Página de downloads — sem promessa falsa

**Arquivo:** `src/pages/SettingsPages.tsx`

Antes dizia *"Para Android e iPhone"* com selo *"Android · iOS"*, sem nenhum
APK existente. Agora:

- selo **"Em desenvolvimento"** nos dois apps;
- texto honesto: *"ainda não tem instalador publicado"*;
- **nenhum botão de download** que não baixe nada;
- instruções reais de PWA para uso imediato no navegador.

---

## 4. Testes executados

| Teste | Resultado |
|---|---|
| `npx tsc -b` | ✅ sem erros |
| `npx vite build` | ✅ 106 módulos, build em 8,37 s |
| `node --check` em todos os arquivos do servidor | ✅ sintaxe OK |
| Normalização de séries (8.093) | ✅ todas `tv` |
| Normalização de filmes (18.080) | ✅ todos `movie` |
| `/api/db/series/1621/episodes` | ✅ 5 temporadas, 12 eps na T1 |
| `/api/db/series/1396/episodes` (Breaking Bad) | ✅ 5 temporadas, 62 eps |
| `/api/db/movies` | ✅ 18.080, todos `movie` |
| Home — cards renderizados | ✅ 221 cards |
| `/series` — cards de série | ✅ 60 cards |
| `/serie/1621` — página abre | ✅ 5 temporadas, 56 episódios |
| `/assistir/1621` — tipo detectado | ✅ reconhece série |
| `/baixar-app` | ✅ 200, "Em desenvolvimento", zero link falso |
| Pop-ups abertos | ✅ 0 |
| Navegação para fora do site | ✅ 0 |
| Erros de console | ✅ 0 |
| Deploy automático após push | ✅ uptime zerou, bundle novo servido |

---

## 5. Publicação

```
56708e9..332f1c5  main -> main
```

- **Hash local:** `332f1c59efb7dd24dbad8ca04d6d9c4f4268e8b2`
- **Hash no GitHub (API):** `332f1c59efb7dd24dbad8ca04d6d9c4f4268e8b2` ✅ idêntico
- **Deploy:** automático na Velixir, detectado e validado
- **Bundle em produção:** `assets/index-C6Rgl5uo.js` (o novo)
- **Segredos no commit:** nenhum (verificado por grep)

---

## 6. Situação por item

| Item | Situação |
|---|---|
| Redirecionamento externo do player | **CONCLUÍDO E TESTADO** — sandbox bloqueia pop-up e top-navigation |
| Mensagens técnicas na tela do cliente | **CONCLUÍDO E TESTADO** — removidas |
| Estado de falha em português | **CONCLUÍDO E TESTADO** |
| Séries no catálogo (8.093) | **CONCLUÍDO E TESTADO** |
| Temporadas e episódios | **CONCLUÍDO E TESTADO** |
| Título 1621 | **CONCLUÍDO E TESTADO** — era série, agora reconhecida |
| Página de downloads | **CONCLUÍDO E TESTADO** |
| Publicação no GitHub | **CONCLUÍDO E TESTADO** |
| Deploy em produção | **CONCLUÍDO E TESTADO** |
| **Reprodução real do vídeo** | **BLOQUEADO POR DEPENDÊNCIA** — ver seção 7 |
| APK Mobile | **PENDENTE** — não existe build Android no projeto |
| APK TV | **PENDENTE** — não existe build Android TV no projeto |
| E-mails / recuperação de senha | **BLOQUEADO POR DEPENDÊNCIA** — sem `RESEND_API_KEY`/SMTP |
| Mercado Pago | **NÃO APLICÁVEL** — plataforma é gratuita no código atual |
| Migrações SQL | **PENDENTE** — exige inspeção do banco real |

---

## 7. Limitação central — leia com atenção

**O vídeo ainda não toca dentro do MovieFlix, e isso não é um bug de código.**

O que foi entregue é a garantia de que **o cliente nunca mais é jogado para
fora do site** e **nunca mais vê mensagem técnica**. O pior caso agora é uma
mensagem curta e educada de indisponibilidade, dentro do MovieFlix.

Para o vídeo realmente tocar, é necessário **uma fonte que permita incorporação
legítima**. As opções reais:

1. **Hospedagem própria** (recomendado) — MP4 ou HLS em storage próprio ou CDN.
   O player já suporta nativamente (`<video>` + hls.js), com retomada exata,
   sem anúncio e sem saída do site. Basta cadastrar a URL no campo `video_url`
   do título no painel administrativo.
2. **Serviço de vídeo com incorporação autorizada** — Vimeo Pro, Cloudflare
   Stream, Bunny Stream, Mux. Todos entregam HLS/MP4 com embed permitido.
3. **Acordo com o provedor atual** — o StreamBetter precisaria liberar o
   domínio `movieflix.velixir.run` no Turnstile e permitir `frame-ancestors`.
   Isso depende deles, não do MovieFlix.

Enquanto nenhuma dessas opções for configurada, o catálogo continua navegável e
as séries, temporadas, episódios, busca, favoritos e histórico funcionam — mas
a reprodução mostra o estado de indisponibilidade.

---

## 8. O que NÃO foi feito (e por quê)

- **Não removi o sandbox do player.** Fazer isso faria o StreamBetter tocar, mas
  reabriria pop-ups, anúncios e redirecionamento — o problema original.
- **Não inventei URLs de vídeo.** Nenhum título foi marcado como funcional sem
  teste real.
- **Não criei APK.** Não existe projeto Android no repositório; gerar um APK
  falso ou um link quebrado seria pior que a ausência.
- **Não executei as migrações SQL.** `MIGRACAO_RLS.sql` e `ASSINATURAS_SQL.sql`
  exigem inspeção do banco real antes de qualquer execução — não há acesso
  direto ao banco neste ambiente.
- **Não alterei preços nem regras de assinatura.** O código atual define a
  plataforma como gratuita; mudar isso exigiria decisão do proprietário.

---

## 9. Pendência que depende de você

**Os commits `15820f5` e `4f4ac47` não chegaram a este ambiente.** Eles existem
apenas na sua máquina Windows. O trabalho desta execução foi feito **em cima de
`56708e9`**, que era o HEAD do GitHub.

Se o conteúdo desses dois commits for importante, você precisa publicá-los da
sua máquina:

```bash
git push origin main
```

Se eles já estiverem publicados por outro caminho, o Git vai recusar o push
deste ambiente por divergência — nesse caso me avise que eu reconcilio.

---

## 10. Arquivos alterados neste commit

```
server/lib/db-catalog.js       |  normaliza type no toTitle
server/lib/static-catalog.js   |  normaliza type no parse do catálogo
src/lib/catalog.ts             |  normaliza type + getById tolerante
src/lib/player.ts              |  política de embed segura documentada
src/components/EmbedPlayer.tsx |  NOVO — player com estado de falha real
src/pages/PlayerPage.tsx       |  detecção de tipo + uso do EmbedPlayer
src/pages/SettingsPages.tsx    |  página de downloads honesta
src/styles/main.css            |  estilos do estado de indisponibilidade
```
