# O WebView usa JavaScript e a ponte de comunicação; nada de reflexão pesada.
-keepclassmembers class run.velixir.movieflix.shell.** { *; }
-keep class androidx.webkit.** { *; }
-dontwarn org.chromium.**
