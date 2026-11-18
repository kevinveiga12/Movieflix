# ─────────────────────────────────────────────────────────────────────────────
# MovieFlix TV — regras do R8
#
# Mesma razão do app mobile: com isMinifyEnabled = true, o R8 remove a árvore
# de UI do Compose se ela não estiver protegida, e o app abre sem desenhar
# nada. Aqui o risco é ainda maior porque o Compose for TV usa classes de foco
# resolvidas por reflexão.
# ─────────────────────────────────────────────────────────────────────────────

# ── O próprio app ────────────────────────────────────────────────────────────
-keep class run.velixir.movieflix.tv.** { *; }
-keepclassmembers class run.velixir.movieflix.tv.** { *; }

# Entry points do Android
-keep class * extends android.app.Application { *; }
-keep class * extends android.app.Activity { *; }
-keep class * extends androidx.activity.ComponentActivity { *; }
-keep class * extends androidx.lifecycle.ViewModel { *; }
-keep class * extends androidx.lifecycle.AndroidViewModel { *; }

# ── Jetpack Compose ──────────────────────────────────────────────────────────
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

# ── Compose for TV (foco e D-pad) ────────────────────────────────────────────
-dontwarn androidx.tv.**
-keep class androidx.tv.** { *; }
-keepclassmembers class androidx.tv.** { *; }

# ── kotlinx.serialization ────────────────────────────────────────────────────
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisibleAnnotations
-dontnote kotlinx.serialization.**
-keepclassmembers class run.velixir.movieflix.tv.data.** {
    *** Companion;
}
-keepclasseswithmembers class run.velixir.movieflix.tv.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class run.velixir.movieflix.tv.**$$serializer { *; }
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

# ── Coil ─────────────────────────────────────────────────────────────────────
-dontwarn coil.**
-keep class coil.** { *; }

# ── Media3 / ExoPlayer ───────────────────────────────────────────────────────
-dontwarn androidx.media3.**
-keep class androidx.media3.** { *; }

# ── Security Crypto ──────────────────────────────────────────────────────────
-keep class androidx.security.crypto.** { *; }
-dontwarn androidx.security.crypto.**

# ── Kotlin ───────────────────────────────────────────────────────────────────
-keep class kotlin.Metadata { *; }
-keepclassmembers class kotlin.Metadata { public <methods>; }
-dontwarn kotlin.**
