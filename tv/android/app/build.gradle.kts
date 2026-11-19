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
        versionCode = 3
        versionName = "1.0.2"

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
