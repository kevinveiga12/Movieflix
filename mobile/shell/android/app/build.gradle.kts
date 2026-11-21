plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * MovieFlix — casca Android.
 *
 * Este app NÃO reimplementa o MovieFlix: ele carrega o site publicado em um
 * WebView próprio, em tela cheia. É o que garante a regra "espelho": qualquer
 * mudança no site aparece aqui na próxima abertura, sem gerar versão nova.
 *
 * O que faz parecer um aplicativo de verdade (e não um site):
 *  - sem barra de endereço, sem botões de navegador, sem menu de contexto;
 *  - splash nativo enquanto a primeira página carrega;
 *  - tela de erro própria quando não há internet (nunca a página do Chrome);
 *  - botão Voltar do Android navega dentro do app e só sai quando não há mais
 *    histórico;
 *  - cookies e sessão persistidos, então o login continua entre execuções;
 *  - links externos (WhatsApp, e-mail) abrem fora; nada abre "no navegador".
 */
android {
    namespace = "run.velixir.movieflix.shell"
    compileSdk = 35

    defaultConfig {
        applicationId = "run.velixir.movieflix"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "1.0.4"

        // Endereço público do MovieFlix. Pode ser sobrescrito no build:
        //   ./gradlew assembleRelease -PmovieflixApi=https://outro.dominio
        val api = (project.findProperty("movieflixApi") as String?) ?: "https://movieflix.velixir.run"
        buildConfigField("String", "SITE_URL", "\"$api\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Assinatura de release. A chave NUNCA fica no repositório: o build do
    // GitHub Actions passa o caminho por variável de ambiente.
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
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
