# MovieFlix TV — Android TV / Google TV / TV Box

Aplicativo nativo em **Kotlin + Jetpack Compose** para televisão. Interface
horizontal com menu lateral, cards grandes e navegação 100% por controle remoto.

## Compatibilidade

| Plataforma | Situação |
|---|---|
| **Android TV** | Alvo principal. `LEANBACK_LAUNCHER` no manifest. |
| **Google TV** | Mesma base do Android TV — funciona. |
| **TV Box Android** | Funciona; o manifest também declara `LAUNCHER` para launchers comuns. |
| Amazon Fire TV | **Não implementado.** Fire OS é derivado do Android e provavelmente roda o APK, mas não foi testado nem adaptado. |
| Samsung Tizen | **Não implementado.** Plataforma própria (web), exigiria outro projeto. |
| LG webOS | **Não implementado.** Idem. |
| Apple tvOS | **Não implementado.** Exigiria Swift/tvOS. |

A arquitetura (ViewModel + repositório + telas desacopladas) permite portar para
as demais plataformas, mas **nada além de Android TV/Google TV/TV Box está
implementado ou testado**.

## Requisitos

- **JDK 17**
- **Android Studio** Ladybug ou mais novo
- **Android SDK Platform 35**, **Build-Tools 35.0.0**
- Um dispositivo Android TV, Google TV ou TV Box — ou o emulador de TV do
  Android Studio (`Device Manager → Create Device → TV`)

## Abrir no Android Studio

1. `File → Open` → pasta `tv/android`.
2. Aguarde o Gradle Sync (baixa Gradle 8.9 e as bibliotecas).
3. Para testar sem TV física: `Device Manager → Create Virtual Device → TV →
   Android TV (1080p)`.

## Gerar o APK

```bash
cd tv/android
./gradlew assembleDebug      # teste
./gradlew assembleRelease    # distribuição (precisa de assinatura)
```

Saída: `app/build/outputs/apk/debug/app-debug.apk`

## Instalar na TV

### Opção A — ADB (recomendado)

1. Na TV: `Configurações → Sobre → toque 7× em "Compilação"` para liberar o modo desenvolvedor.
2. `Configurações → Preferências do dispositivo → Depuração USB → Ativar`.
3. Descubra o IP da TV em `Configurações → Rede`.
4. No computador:

```bash
adb connect 192.168.0.XX:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Opção B — Downloader

1. Instale o app **Downloader** (Aptoide TV ou Play Store da TV).
2. Hospede o APK em uma URL pública (o próprio site pode servir
   `/apk/movieflix-tv.apk`).
3. No Downloader, digite a URL e instale.

## Assinatura para distribuição

Igual ao app mobile — veja `mobile/android/BUILD.md`, seção "Gerar o APK de
distribuição". Use **uma keystore diferente** da do mobile: são aplicativos
distintos (`run.velixir.movieflix` vs `run.velixir.movieflix.tv`).

## Publicar na Google Play (canal de TV)

1. No Play Console, o app precisa do formulário **"TV app"** preenchido.
2. Envie o **banner de TV** (320×180) — já existe em
   `app/src/main/res/drawable/tv_banner.xml`, mas a Play Store exige um PNG.
3. Declare que o app **não requer toque** (`android.hardware.touchscreen` =
   `required="false"`, já no manifest).
4. Envie capturas de tela em 1920×1080.

## Navegação por controle remoto

| Tecla | Ação |
|---|---|
| ← ↑ → ↓ | Move o foco entre cards, menus e botões |
| OK / Enter | Abre o item focado / play-pause no player |
| Voltar | Sobe um nível: player → detalhe → home |
| ⏪ / ⏩ (mídia) | Retrocede / avança 10s no player nativo |

O foco é sempre visível: card focado ganha **borda vermelha de 3dp** e o título
fica branco em negrito. Item de menu focado fica com fundo vermelho sólido.

## Player

Dois modos, decididos pelo servidor:

- **`direct`** (MP4/HLS) → **Media3/ExoPlayer**. Controle remoto completo:
  OK pausa/retoma, ← → movem 10s, barra de progresso nativa, tela cheia.
  **Este é o modo com controle total garantido.**
- **`embed`** (página do provedor) → WebView com bloqueio de pop-up e de
  navegação externa.

### Limitação real do modo embed na TV

Uma página de terceiros dentro de um WebView **não expõe API de reprodução**.
Não há como garantir que o provedor responda a play/pause/seek pelo controle
remoto — o app repassa as teclas ao WebView, mas quem decide o que fazer com
elas é o HTML do provedor, não o MovieFlix.

**Solução técnica:** cadastrar uma URL `.mp4` ou `.m3u8` no painel
administrativo. O servidor devolve `mode: "direct"` e o Media3 assume, com
controle remoto completo e preciso. Não inventei compatibilidade que não existe.

## Arquitetura

```
app/src/main/java/run/velixir/movieflix/tv/
├── MainActivity.kt              rotas + tratamento do botão Voltar
├── TvViewModel.kt               estado, API, autorização
├── data/                        Models, MovieFlixApi, SessionStore
└── ui/
    ├── theme/Theme.kt           paleta do site
    ├── screens/TvComponents.kt  sidebar, cards com foco, hero
    ├── screens/TvScreens.kt     home, catálogo, busca, detalhe, login
    └── screens/TvPlayerScreen.kt  Media3 + WebView
```

## Limitações conhecidas

- **Não foi compilado neste ambiente** (sem JDK/Android SDK).
- **Não foi testado em TV real.** A navegação por D-pad foi implementada com
  `onFocusChanged` e `onKeyEvent`, mas só um teste em aparelho confirma o
  comportamento — especialmente em TV Box com launchers modificados.
- Fire TV, Tizen, webOS e tvOS: **não implementados**.

---

## Build oficial: GitHub Actions (recomendado)

O APK publicado em `public/apk/movieflix-tv-1.0.0.apk` foi gerado pelo workflow
`.github/workflows/build-apks.yml`, no mesmo runner do app mobile.

1. GitHub → **Actions** → **Build APKs** → **Run workflow**.
2. Baixe o artefato **movieflix-apks** e use `movieflix-tv-release.apk`.

O APK de TV é **diferente** do mobile: package `run.velixir.movieflix.tv`,
`LEANBACK_LAUNCHER` no manifest e banner de TV. Não publique um como se fosse o outro.

### Instalar na TV

```bash
adb connect 192.168.0.10:5555     # IP da TV (ative a depuração nas opções de desenvolvedor)
adb install -r movieflix-tv-release.apk
```

Ou copie o APK para um pendrive e instale com um gerenciador de arquivos na TV.

### Versão

Suba `versionCode` e `versionName` em `tv/android/app/build.gradle.kts` antes de
cada atualização, e assine com o **mesmo keystore** do app mobile.
