# MovieFlix — aplicativos espelho (Android e iOS)

Os aplicativos Android e iOS do MovieFlix são **cascas**: cada um abre o site
publicado (`https://movieflix.velixir.run`) em uma tela cheia, sem barra de
navegador. Não existe uma segunda interface para manter.

## Por que casca e não app nativo

O pedido é direto: *"tudo o que eu mudar no site tem que mudar automaticamente
no aplicativo, sem precisar gerar um app novo"*. Um app nativo (como a versão
anterior em Kotlin/Compose, que continua em `mobile/android/`) obriga a
recompilar e redistribuir o APK a cada mudança. Carregando o site, o app é
sempre o site de agora — a mudança aparece na próxima abertura.

## Como o app deixa de parecer um site

| Sinal de "site" | O que o app faz |
|---|---|
| Barra de endereço / botões de navegador | Não existem: é um `WebView`/`WKWebView` puro, sem chrome. |
| Menu de contexto ("Abrir no Chrome", "Copiar link") | Desligado (`isLongClickable=false` no Android, `allowsLinkPreview=false` no iOS). |
| Cabeçalho do site (logo + menu) e rodapé | Escondidos pelo CSS de modo aplicativo. |
| Barra de rolagem | Escondida por CSS injetado. |
| "Abrir no navegador" | Links externos abrem no app correspondente (WhatsApp, e-mail) ou no navegador do sistema — nunca numa segunda janela dentro do app. |
| Tela de erro do navegador | Tela de erro própria, com o logo e um botão "Tentar novamente". |
| Splash do navegador | Splash nativo com o logo do MovieFlix. |
| Login perdido a cada abertura | Cookies e `localStorage` persistidos: o login continua. |

O site reconhece o app por `?app=android|ios` e pelo User-Agent
`MovieFlixApp/1.0`, e então aplica o layout de aplicativo (ver
`src/lib/appEnv.ts` e o bloco "MODO APLICATIVO" em `src/styles/global.css`).

## Estrutura

```
mobile/shell/
├── android/                 casca Android (Kotlin, WebView)
│   └── app/src/main/java/run/velixir/movieflix/shell/
│       ├── MainActivity.kt        WebView, back nativo, links externos
│       └── MovieFlixShellApp.kt   Application
└── ios/                     casca iOS (SwiftUI + WKWebView)
    └── MovieFlixShell/MovieFlixShellApp.swift
```

## Build

O build oficial é o workflow **Build APKs** (`.github/workflows/build-apks.yml`),
em um runner com o Android SDK real. Ele compila as duas cascas, roda os testes
e publica:

- `public/apk/movieflix-android.apk` — público, é o botão "Baixar para Android".
- `storage/apps/movieflix-tv.apk` — **privado**, só sai pela rota de admin.

O iOS é compilado no Xcode (não há runner macOS no workflow). Veja
`mobile/shell/ios/BUILD.md`.

## Apontar para outro servidor

```bash
cd mobile/shell/android
./gradlew assembleRelease -PmovieflixApi=https://outro.dominio
```

No iOS, troque `WebModel.siteURL` em `MovieFlixShellApp.swift`.
