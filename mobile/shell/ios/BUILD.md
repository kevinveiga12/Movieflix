# MovieFlix iOS — como gerar o app

A casca iOS é um projeto SwiftUI + `WKWebView` que abre o site publicado em tela
cheia. Não há dependências externas: só o Xcode.

## Requisitos

- **macOS** com **Xcode 16** ou mais novo
- Uma conta Apple (gratuita serve para testar no seu próprio iPhone)

## Abrir e rodar no simulador

1. Abra `mobile/shell/ios/MovieFlix.xcodeproj` no Xcode.
2. Escolha um simulador de iPhone e clique em **Run** (⌘R).

## Instalar no seu iPhone (sem App Store)

1. Conecte o iPhone por cabo e selecione-o como destino no Xcode.
2. Em **Signing & Capabilities**, escolha o seu **Team** (a conta Apple).
   O Xcode cria o perfil automaticamente.
3. **Run** (⌘R). O app instala no aparelho.
   - Na primeira vez, o iPhone pede para confiar no desenvolvedor:
     **Ajustes → Geral → VPN e Gerenciamento de Dispositivo → Confiar**.

## Gerar o arquivo para distribuição

- **Teste interno (TestFlight):** `Product → Archive` → **Distribute App** →
  **App Store Connect** → **Upload**. Depois, no App Store Connect, adicione os
  testadores.
- **App Store:** o mesmo Archive, enviado para revisão. A Apple exige conta de
  desenvolvedor paga (US$ 99/ano) e revisão — nada aqui contorna isso.

## Apontar para outro servidor

Em `MovieFlixShell/MovieFlixShellApp.swift`, troque:

```swift
static let siteURL = URL(string: "https://movieflix.velixir.run")!
```

## O que este app faz para não parecer um site

- `WKWebView` sem barra de endereço e sem botões de Safari.
- `allowsLinkPreview = false` — sem menu de contexto ao segurar um link.
- Splash nativo e tela de erro própria (nunca a página "sem conexão" do Safari).
- Cookies e `localStorage` persistentes: o login continua entre aberturas.
- Links externos abrem no app correspondente, nunca numa segunda janela.

## Alternativa sem Xcode: instalação pela tela de início

Enquanto o app nativo não estiver publicado, o iPhone pode instalar o MovieFlix
pela tela de início do Safari (o site é um PWA em tela cheia):

1. Abra `https://movieflix.velixir.run` no **Safari**.
2. **Compartilhar** → **Adicionar à Tela de Início** → **Adicionar**.

O ícone fica na tela do iPhone e abre em tela cheia, sem barra do Safari. É o
que a página `/baixar-app` orienta hoje.
