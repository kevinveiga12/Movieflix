# MovieFlix Mobile — Android

Aplicativo nativo em **Kotlin + Jetpack Compose**. Não é WebView do site: tem
interface, navegação e player próprios, e fala com a mesma API do MovieFlix.

## Requisitos

- **JDK 17** (Android Studio traz um embutido)
- **Android Studio** Ladybug (2024.2) ou mais novo — ou apenas o SDK de linha de comando
- **Android SDK Platform 35** e **Build-Tools 35.0.0**
- Conexão com a internet no primeiro build (o Gradle baixa as dependências)

## Abrir no Android Studio

1. `File → Open` e selecione a pasta `mobile/android`.
2. Aguarde o *Gradle Sync*. Na primeira vez ele baixa o Gradle 8.9 e as bibliotecas.
3. Se pedir o SDK 35: `Tools → SDK Manager → Android 15 (API 35) → Apply`.

## Gerar o APK de teste (debug)

```bash
cd mobile/android
./gradlew assembleDebug
```

Saída: `app/build/outputs/apk/debug/app-debug.apk`

Instalar no celular conectado por USB (com depuração ativada):

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Gerar o APK de distribuição (release)

O APK de release **precisa de uma chave de assinatura**. Ela é sua e nunca deve
ir para o repositório.

### 1. Criar a keystore (uma vez só)

```bash
keytool -genkeypair -v \
  -keystore movieflix-release.jks \
  -alias movieflix \
  -keyalg RSA -keysize 2048 -validity 10000
```

Guarde o arquivo `.jks` e as senhas em local seguro. **Perder a chave impede
qualquer atualização futura do app na Play Store.**

### 2. Configurar a assinatura

Crie `mobile/android/keystore.properties` (já está no `.gitignore`):

```properties
storeFile=../movieflix-release.jks
storePassword=SUA_SENHA
keyAlias=movieflix
keyPassword=SUA_SENHA
```

E adicione ao `app/build.gradle.kts`, dentro de `android { }`:

```kotlin
signingConfigs {
    create("release") {
        val props = java.util.Properties().apply {
            val f = rootProject.file("keystore.properties")
            if (f.exists()) f.inputStream().use { load(it) }
        }
        storeFile = props.getProperty("storeFile")?.let { file(it) }
        storePassword = props.getProperty("storePassword")
        keyAlias = props.getProperty("keyAlias")
        keyPassword = props.getProperty("keyPassword")
    }
}
buildTypes {
    getByName("release") {
        signingConfig = signingConfigs.getByName("release")
    }
}
```

### 3. Compilar

```bash
./gradlew assembleRelease     # APK
./gradlew bundleRelease       # AAB (formato exigido pela Play Store)
```

Saída:
- APK: `app/build/outputs/apk/release/app-release.apk`
- AAB: `app/build/outputs/bundle/release/app-release.aab`

## Publicar na Google Play

1. Crie a conta de desenvolvedor em https://play.google.com/console (taxa única).
2. `Create app` → nome **MovieFlix**, idioma Português (Brasil), categoria Entretenimento.
3. Envie o `.aab` em *Production → Create new release*.
4. Preencha: descrição, ícone 512×512, banner 1024×500, no mínimo 2 capturas de tela.
5. **Política de privacidade é obrigatória** — o app coleta e-mail e histórico de exibição.
6. *Data safety*: declare e-mail (coletado, vinculado à conta) e histórico de vídeos.
7. Envie para revisão. A primeira análise costuma levar de 3 a 7 dias.

## Apontar para outro servidor

O endereço da API é `https://movieflix.velixir.run` por padrão. Para trocar:

```bash
./gradlew assembleRelease -PmovieflixApi=https://outro.dominio
```

## Arquitetura

```
app/src/main/java/run/velixir/movieflix/
├── MainActivity.kt          navegação + barra inferior
├── AppViewModel.kt          estado único, chamadas de API
├── data/
│   ├── Models.kt            espelha src/lib/types.ts do site
│   ├── MovieFlixApi.kt      OkHttp + kotlinx.serialization
│   └── SessionStore.kt      tokens em EncryptedSharedPreferences
└── ui/
    ├── theme/Theme.kt       paleta idêntica ao site
    ├── Components.kt        cards, fileiras, hero
    └── screens/             catálogo, detalhe, player, conta
```

## Integração com o site

Nenhum backend novo. O app usa:

| Recurso | Origem |
|---|---|
| Catálogo, busca, gêneros | `GET /api/catalog/*` |
| Temporadas e episódios | `GET /api/db/series/:id/episodes` |
| Login, cadastro, recuperação | `POST /api/auth/*` |
| Autorização de reprodução | `POST /api/playback/authorize` |
| Situação do plano | `GET /api/subscription` |
| Favoritos e histórico | Supabase direto (`favorites`, `watch_history`) com RLS |

Como favoritos e histórico vão direto ao Supabase com o token do próprio
usuário, **favoritar no celular aparece no site e na TV** — é a mesma linha.

## Segurança

- Nenhuma chave privada no app. Só a URL e a chave **anon** do Supabase, que são
  públicas por design e protegidas por RLS.
- Tokens de sessão em `EncryptedSharedPreferences` (AES-256, chave no Keystore).
- A senha existe apenas em memória durante o login; nunca é gravada.
- Quem libera conteúdo é o servidor (`app_metadata` + `created_at`), nunca o app.

## Limitações conhecidas

- **Não foi compilado neste ambiente** — não há JDK nem Android SDK aqui. O
  código foi escrito e revisado, mas o primeiro build é seu.
- **Não foi testado em aparelho real.** Nenhuma afirmação de "funciona no
  celular" pode ser feita antes de você instalar o APK.
- O player em modo `embed` depende do provedor. Se o provedor exigir
  verificação anti-bot, ela aparece dentro do WebView — o app não contorna isso.
  Para controle total, cadastre uma URL `.mp4`/`.m3u8` no painel: aí o Media3
  assume e o player fica nativo.
