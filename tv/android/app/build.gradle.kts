plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "run.velixir.movieflix.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "run.velixir.movieflix.tv"
        minSdk = 26
        targetSdk = 35
        /*
          1.0.6 — ordenação, pesquisa direta, proteção de tela e atualizador.

          • Filmes e Séries ganharam as cinco ordenações (populares, recentes,
            mais antigos, A–Z, melhor avaliados), aplicadas no SERVIDOR sobre o
            catálogo inteiro — não só sobre a página carregada.
          • Pesquisa direta nas telas de Filmes e Séries, combinável com
            categoria e ordenação. A aba Buscar continua intacta.
          • FLAG_KEEP_SCREEN_ON ligada/desligada pelo estado REAL do player:
            a TV não entra mais em descanso com filme ou episódio tocando.
          • Atualizador integrado: consulta /api/apps/tv/version, baixa o APK,
            valida SHA-256 e abre o instalador do Android.

          versionCode 12 (o 1.0.9 saiu como 11). Instalar por cima preserva login e
          dados porque o applicationId e a chave de assinatura são os mesmos.

          1.0.10 — 4 colunas. A célula caiu de 150dp para 130dp: com a área útil
          de ~580dp isso passa de 3 para 4 cards por linha. O cabeçalho também
          encolheu (título 20sp, busca 46dp, chips 14/4dp) para a grade subir.

          1.0.13 — pagamento com cartão de crédito e débito. A tela de planos
          ganhou o seletor "Pix / Cartão" e uma tela de digitação própria para
          o D-pad. O cartão é tokenizado direto no Mercado Pago: o app nunca
          envia número, CVV ou validade ao nosso servidor.

          1.0.14 — diálogo de atualização navegável. A janela virou um Dialog de
          verdade (janela de foco própria), o botão "ATUALIZAR AGORA" recebe o
          foco inicial e cada botão tem focusable() explícito. Antes, o D-pad
          continuava preso no conteúdo atrás do véu e o OK não fazia nada.

          1.0.15 — a janela de atualização passa a ter o foco EXCLUSIVO do
          controle remoto e o conteúdo rola de verdade. O Dialog do Compose não
          transferia a posse do foco: o D-pad seguia navegando no MovieFlix
          atrás do véu. Agora a janela é um overlay de tela cheia que pede o
          foco para si E registra um tratador na raiz do app (UpdateKeyRouter),
          que consome toda tecla antes de qualquer tela — duas camadas
          independentes. O cartão é dimensionado pelo tamanho real da TV e o
          corpo do texto vive num verticalScroll com os botões ancorados no
          rodapé, então nada mais fica cortado embaixo e dá para descer até
          "ATUALIZAR AGORA" / "DEPOIS" com as setas.
          1.0.16 — duas correções pedidas no aparelho:

          • CONTROLE REMOTO NA TELA DE CARTÃO. O cliente focava o número do
            cartão e digitava, mas o D-pad não descia para validade, CVV e nome
            ("clico e não anda"). Cada campo consumia as setas no
            onPreviewKeyEvent e o foco nunca andava. Agora a cadeia de foco é
            explícita (número → validade → CVV → nome → PAGAR → VOLTAR), com
            FocusRequester por campo, e o teclado na tela abre/fecha junto.

          • PÁGINA DE ATUALIZAÇÃO PRÓPRIA. A atualização deixou de ser uma
            janela por cima do MovieFlix: virou a rota TvRoute.Update, uma tela
            de verdade, alcançável pelo menu lateral ("Atualizar") e aberta
            automaticamente quando há versão nova. Mostra versão instalada e
            disponível, tem botão "Atualizar" clicável pelo controle e, sem
            atualização, "Continuar" leva ao catálogo.
        */
        versionCode = 18
        versionName = "1.0.16"

        val api = (project.findProperty("movieflixApi") as String?) ?: "https://movieflix.velixir.run"
        buildConfigField("String", "API_BASE_URL", "\"$api\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Assinatura de release — mesma regra do app mobile: a chave vem do
    // ambiente do build (GitHub Actions), nunca do repositorio.
    signingConfigs {
        create("release") {
            val ks = System.getenv("MF_KEYSTORE")
            if (!ks.isNullOrBlank() && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("MF_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MF_KEY_ALIAS") ?: "movieflix"
                keyPassword = System.getenv("MF_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val ks = System.getenv("MF_KEYSTORE")
            if (!ks.isNullOrBlank() && file(ks).exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}") }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    // activity-compose 1.9.x traz o suporte a D-pad/foco para TV.
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // Foco e navegação por controle remoto
    implementation("androidx.tv:tv-foundation:1.0.0-alpha11")
    implementation("androidx.tv:tv-material:1.0.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("io.coil-kt:coil-compose:2.7.0")

    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")

    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // WebViewCompat.addDocumentStartJavaScript — injeta o script da ponte do
    // player em TODOS os frames, inclusive os de outra origem. É o que permite
    // controlar o <video> do provedor pelo controle remoto.
    implementation("androidx.webkit:webkit:1.12.1")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
