# ─────────────────────────────────────────────────────────────────────────────
# MovieFlix — regras do R8
#
# O release usa isMinifyEnabled = true. Sem as regras abaixo o R8 remove o que
# ele acha que ninguém usa — e num app Compose isso inclui a árvore de UI
# inteira, porque ela é montada por lambda/reflexão e não por chamada direta.
# O sintoma clássico é o APK abrir em TELA PRETA: compila, instala, abre, e não
# desenha nada.
# ─────────────────────────────────────────────────────────────────────────────

# ── O próprio app ────────────────────────────────────────────────────────────
# Mantém todas as classes do app (UI, telas, ViewModel, modelos). O app é
# pequeno; o custo em tamanho é irrelevante perto do risco de tela preta.
-keep class run.velixir.movieflix.** { *; }
-keepclassmembers class run.velixir.movieflix.** { *; }

# Entry points do Android
-keep class * extends android.app.Application { *; }
-keep class * extends android.app.Activity { *; }
-keep class * extends androidx.activity.ComponentActivity { *; }
-keep class * extends androidx.lifecycle.ViewModel { *; }
-keep class * extends androidx.lifecycle.AndroidViewModel { *; }

# ── Jetpack Compose ──────────────────────────────────────────────────────────
# O Compose gera classes sintéticas e usa reflexão para lambdas @Composable.
-dontwarn androidx.compose.**
-keep class androidx.compose.runtime.** { *; }
-keep class androidx.compose.ui.platform.** { *; }
-keepclassmembers class androidx.compose.** {
    *** Composer;
    *** Composer(...);
    *** changed(...);
    *** startRestartGroup(...);
    *** endRestartGroup(...);
}
-keep,includedescriptorclasses class androidx.compose.**$$* { *; }
-keep class androidx.compose.material3.** { *; }
-keep class androidx.compose.material.icons.** { *; }

# ── kotlinx.serialization ────────────────────────────────────────────────────
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisibleAnnotations
-dontnote kotlinx.serialization.**
-keepclassmembers class run.velixir.movieflix.data.** {
    *** Companion;
}
-keepclasseswithmembers class run.velixir.movieflix.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class run.velixir.movieflix.**$$serializer { *; }
-keep class kotlinx.serialization.** { *; }
-keepclassmembers class kotlinx.serialization.json.** { *; }

# ── OkHttp / Okio ────────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-keep class okio.** { *; }

# ── Coil (imagens) ───────────────────────────────────────────────────────────
-dontwarn coil.**
-keep class coil.** { *; }

# ── Media3 / ExoPlayer ───────────────────────────────────────────────────────
-dontwarn androidx.media3.**
-keep class androidx.media3.** { *; }

# ── Security Crypto (EncryptedSharedPreferences) ─────────────────────────────
-keep class androidx.security.crypto.** { *; }
-dontwarn androidx.security.crypto.**

# ── Kotlin ───────────────────────────────────────────────────────────────────
-keep class kotlin.Metadata { *; }
-keepclassmembers class kotlin.Metadata { public <methods>; }
-dontwarn kotlin.**

# ── WebView (player embed) ───────────────────────────────────────────────────
-keepclassmembers class * extends android.webkit.WebViewClient { *; }
-keepclassmembers class * extends android.webkit.WebChromeClient { *; }
