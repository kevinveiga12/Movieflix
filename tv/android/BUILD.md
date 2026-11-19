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
| ⏪ / ⏩ (mídia) | Retrocede / avança no player |

O foco é sempre visível: card focado ganha **borda vermelha de 3dp** e o título
fica branco em negrito. Item de menu focado fica com fundo vermelho sólido.

## Player — controle remoto (v1.0.1)

| Tecla | Ação |
|---|---|
| **OK / Enter / Play-Pause** | Alterna play/pause. 1º OK despausa, 2º pausa, 3º despausa… |
| **→ toque curto** | Avança **10 s** |
| **→ segurando** | Avança **30 s → 1 min → 2 min → 3 min → 4 min** (e 4 min depois) |
| **← toque curto** | Retrocede **10 s** |
| **← segurando** | Retrocede 30 s → 1 → 2 → 3 → 4 min |
| **soltar a seta** | Para **exatamente** no alvo (seek absoluto, sem deriva) |
| **↑ / ↓** | Volume **±10 %** |
| **Voltar** | Sai do player |

Ao abrir, o vídeo **começa tocando**. Se o provedor montar o `<video>` pausado,
a ponte tenta `play()` ao anexar e de novo em `canplay`; se ainda assim entrar
pausado, o primeiro OK despausa — porque o toggle lê `v.paused` / `isPlaying`
de verdade, não um contador do app.

### Como isso é testado sem TV

A lógica de controle é **Kotlin puro** em
`app/src/main/java/run/velixir/movieflix/tv/player/TvPlayerControls.kt`
(`SeekController`, `VolumeController`, `PlayPauseController`). Ela não conhece
Android, Compose nem player: recebe a posição atual e devolve a posição
**absoluta** para onde ir. Por isso roda em JVM:

```bash
bash scripts/test-tv-player.sh     # 35 verificações
node scripts/test-tv-bridge.mjs    # 31 verificações (ponte JS do modo embed)
```

O primeiro cobre toque curto, aceleração progressiva, parada exata, watchdog de
soltura, limites, volume e a alternância do OK. O segundo extrai o `BRIDGE_JS`
do próprio `TvPlayerScreen.kt`, valida a sintaxe e executa contra um DOM falso
com um `<video>` que nasce pausado.

Os dois rodam no workflow `Build APKs` antes de gerar o APK.

## Player

Dois modos, decididos pelo servidor:

- **`direct`** (MP4/HLS) → **Media3/ExoPlayer**. Controle remoto completo e
  preciso, com `seekTo` absoluto.
- **`embed`** (página do provedor) → WebView com ponte JS injetada em todos os
  frames (`WebViewCompat.addDocumentStartJavaScript`), que controla o `<video>`
  real do provedor.

### Limitação real do modo embed na TV

O provedor roda em iframe de outro domínio. A ponte alcança o `<video>` porque
`addDocumentStartJavaScript` injeta em todos os frames — mas isso exige
**API 30+** (Android 11). Em aparelhos mais antigos o script entra só no frame
principal, e funciona apenas quando o provedor monta o `<video>` na própria
página. O app diz isso na tela em vez de fingir.

Se o provedor não tiver `<video>` (player em canvas, por exemplo), a ponte não
encontra o elemento e o app mostra "O provedor não liberou o vídeo para este
aparelho".

**Solução definitiva:** cadastrar uma URL `.mp4` ou `.m3u8` no painel
administrativo. O servidor devolve `mode: "direct"` e o Media3 assume, com
controle remoto completo e preciso.


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
