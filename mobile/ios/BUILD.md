# MovieFlix Mobile — iOS

Aplicativo nativo em **Swift + SwiftUI**. Não é WebView do site: interface,
navegação e player próprios, falando com a mesma API do MovieFlix.

## Requisitos

- **macOS** (obrigatório — não existe compilador iOS em Linux/Windows)
- **Xcode 16** ou mais novo (App Store: gratuito)
- **Conta Apple Developer** — gratuita para testar no seu próprio iPhone;
  **paga (US$ 99/ano)** para TestFlight e App Store
- iPhone com **iOS 16.0** ou superior

## Abrir o projeto

```bash
open mobile/ios/MovieFlix.xcodeproj
```

O projeto já vem com todos os arquivos-fonte referenciados. Se o Xcode pedir
para "atualizar para o formato recomendado", aceite.

## Rodar no simulador

1. No topo do Xcode, escolha um destino: `iPhone 16` (ou similar).
2. `⌘R` (Product → Run).

## Rodar no seu iPhone

1. Conecte o iPhone por USB e confie no computador.
2. No Xcode: selecione o projeto `MovieFlix` → aba **Signing & Capabilities**.
3. Em **Team**, escolha sua conta Apple. Se não houver, `Add Account…` e entre
   com seu Apple ID (a conta gratuita serve).
4. Se o Bundle Identifier `run.velixir.movieflix` estiver em uso, troque para
   algo único, ex.: `com.seunome.movieflix`.
5. `⌘R`. No iPhone, autorize o desenvolvedor em
   `Ajustes → Geral → VPN e Gerenciamento de Dispositivos`.

> Com conta gratuita o app expira em **7 dias** e precisa ser reinstalado.
> Com conta paga, vale 1 ano.

## Gerar o arquivo para distribuição (.ipa)

1. `Signing & Capabilities` → Team definido, `Automatically manage signing` ligado.
2. Destino: **Any iOS Device (arm64)** — não pode ser um simulador.
3. `Product → Archive`.
4. No Organizer: **Distribute App** →
   - **App Store Connect** para publicar/TestFlight, ou
   - **Ad Hoc** para instalar em aparelhos cadastrados, ou
   - **Development** para testes internos.

## Publicar na App Store

1. Crie o app em https://appstoreconnect.apple.com → `My Apps → +` → New App.
2. Bundle ID igual ao do Xcode; SKU livre; idioma principal **Português (Brasil)**.
3. Envie o build pelo Organizer (passo anterior).
4. Preencha a ficha:
   - **Descrição**, palavras-chave, categoria **Entretenimento**
   - **Ícone 1024×1024** — já existe em `Assets.xcassets/AppIcon.appiconset/AppIcon.png`
   - **Capturas de tela** de iPhone 6.7" e 6.5" (mínimo 3)
   - **Política de privacidade** (URL pública) — obrigatória
   - **App Privacy**: declare e-mail (coletado, vinculado à conta) e histórico de exibição
5. Envie para revisão. A primeira análise costuma levar de 1 a 3 dias.

### Ponto de atenção na revisão da Apple

A Apple rejeita apps que são apenas um site embrulhado (guideline 4.2). Este
app **não é** isso: tem interface nativa, navegação própria, player nativo
(AVPlayer) e integração com a conta. Ainda assim, se a revisão questionar,
o argumento é esse — e vale ter capturas mostrando as telas nativas.

## Apontar para outro servidor

Edite `APIClient.swift`:

```swift
let baseURL = URL(string: "https://movieflix.velixir.run")!
```

## Arquitetura

```
MovieFlix/
├── MovieFlixApp.swift          @main + TabView raiz
├── Models.swift                espelha src/lib/types.ts
├── APIClient.swift             URLSession + Codable
├── SessionStore.swift          tokens no Keychain
├── AppState.swift              ObservableObject, estado único
├── Theme.swift                 paleta do site + componentes base
├── Components.swift            cards, fileiras, hero
├── CatalogViews.swift          home, catálogo, busca, favoritos, histórico
├── DetailAndPlayerViews.swift  detalhe, AVPlayer, WKWebView
└── AccountViews.swift          login, cadastro, recuperação, conta, planos
```

## Integração com o site

Nenhum backend novo. Mesmos endpoints do Android:

| Recurso | Origem |
|---|---|
| Catálogo, busca, gêneros | `GET /api/catalog/*` |
| Temporadas e episódios | `GET /api/db/series/:id/episodes` |
| Login, cadastro, recuperação | `POST /api/auth/*` |
| Autorização de reprodução | `POST /api/playback/authorize` |
| Situação do plano | `GET /api/subscription` |
| Favoritos e histórico | Supabase direto (`favorites`, `watch_history`) com RLS |

Favoritar no iPhone aparece no site, no Android e na TV — é a mesma linha no
Supabase.

## Segurança

- Nenhuma chave privada no app. Só a URL e a chave **anon** do Supabase
  (públicas por design, protegidas por RLS).
- Tokens no **Keychain** com `kSecAttrAccessibleAfterFirstUnlock`.
- A senha existe apenas em memória durante o login.
- Quem libera conteúdo é o servidor (`app_metadata` + `created_at`).

## Limitações conhecidas

- **Não foi compilado neste ambiente** — não há macOS nem Xcode aqui. O código
  foi escrito e revisado, mas o primeiro build é seu.
- **Não foi testado em aparelho real.** Nenhuma afirmação de "funciona no
  iPhone" pode ser feita antes de você rodar.
- O player em modo `embed` depende do provedor. Se ele exigir verificação
  anti-bot, ela aparece dentro do WKWebView — o app não contorna isso. Para
  controle total, cadastre uma URL `.mp4`/`.m3u8` no painel: o AVPlayer assume.
- **Apple TV (tvOS) não implementado.** O pedido era Android TV; tvOS exigiria
  um target separado.
