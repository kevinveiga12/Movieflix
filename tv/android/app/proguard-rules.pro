# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class run.velixir.movieflix.data.** {
    *** Companion;
}
-keepclasseswithmembers class run.velixir.movieflix.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class run.velixir.movieflix.**$$serializer { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
