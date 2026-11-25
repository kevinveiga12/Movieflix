package run.velixir.movieflix.tv.update

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Atualizador integrado do MovieFlix TV.
 *
 * ── COMO FUNCIONA ────────────────────────────────────────────────────────────
 *
 * 1. Ao abrir o app, [check] consulta `GET /api/apps/tv/version` — o manifesto
 *    de versões publicado no domínio oficial.
 * 2. Se o `versionCode` do manifesto for MAIOR que o instalado, há atualização.
 *    Nunca faz downgrade: igual ou menor = "já atualizado".
 * 3. [download] baixa o APK para o cache do app, mostrando progresso, e valida
 *    o SHA-256 contra o manifesto. Arquivo inválido é apagado e recusado.
 * 4. [install] abre o instalador OFICIAL do Android via FileProvider. O sistema
 *    pede a confirmação do usuário — não tentamos instalar silenciosamente,
 *    porque isso exigiria root e o pedido proíbe contornar as proteções.
 *
 * ── O QUE NÃO É PROMETIDO ────────────────────────────────────────────────────
 *
 * Instalação silenciosa NÃO existe em TV comum. O Android sempre mostra a tela
 * de confirmação (e, na primeira vez, a permissão de "instalar apps
 * desconhecidos"). Isso é do sistema, não do app.
 *
 * ── PRESERVAÇÃO DE DADOS ─────────────────────────────────────────────────────
 *
 * Instalar por cima (mesmo applicationId + mesma assinatura) preserva login,
 * sessão, preferências e dados locais. O app NÃO limpa armazenamento em nenhum
 * momento do fluxo de atualização.
 */
object UpdateManager {

    /** Manifesto publicado em /api/apps/tv/version. */
    @Serializable
    data class Manifest(
        val version: String = "",
        val versionCode: Int = 0,
        val apkUrl: String = "",
        val sha256: String? = null,
        val notes: List<String> = emptyList(),
        val mandatory: Boolean = false,
        val publishedAt: String? = null,
        val minSupportedVersionCode: Int = 0,
    )

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /** Só aceitamos HTTPS do domínio oficial — o pedido exige isso. */
    private const val OFFICIAL_HOST = "movieflix.velixir.run"
    private const val VERSION_PATH = "/api/apps/tv/version"

    /**
     * Consulta o manifesto.
     *
     * Devolve `null` em qualquer falha (sem rede, 404, JSON inválido). O app
     * NUNCA deve travar nem mostrar erro por causa de uma checagem de versão:
     * falhar em silêncio e seguir para o catálogo é o comportamento correto.
     */
    suspend fun check(baseUrl: String): Manifest? = withContext(Dispatchers.IO) {
        runCatching {
            val url = baseUrl.trimEnd('/') + VERSION_PATH
            val req = Request.Builder().url(url).get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                val body = resp.body?.string() ?: return@use null
                json.decodeFromString<Manifest>(body)
            }
        }.getOrNull()
    }

    /**
     * `true` quando o manifesto anuncia uma versão MAIS NOVA que a instalada.
     *
     * Comparação por `versionCode` (inteiro), não por string: "1.0.10" é maior
     * que "1.0.9" numericamente, mas não alfabeticamente. O versionCode é a
     * fonte da verdade — é o que o Android usa para decidir se aceita a
     * instalação por cima.
     */
    fun isNewer(manifest: Manifest?, installedCode: Int): Boolean {
        if (manifest == null) return false
        if (manifest.versionCode <= 0) return false
        return manifest.versionCode > installedCode
    }

    /**
     * Baixa o APK e valida o SHA-256.
     *
     * `onProgress` recebe 0..100. Devolve o arquivo pronto para instalar, ou
     * lança exceção com mensagem amigável. O arquivo parcial é sempre apagado
     * em caso de falha — nunca deixamos um APK truncado no cache.
     */
    suspend fun download(
        context: Context,
        manifest: Manifest,
        onProgress: (Int) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        val url = manifest.apkUrl
        require(url.startsWith("https://")) { "Endereço de download inválido." }
        require(url.contains(OFFICIAL_HOST)) { "Endereço de download não é oficial." }

        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val out = File(dir, "movieflix-tv-${manifest.version}.apk")
        if (out.exists()) out.delete()

        val req = Request.Builder().url(url).get().build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) error("Não foi possível baixar a atualização (HTTP ${resp.code}).")
            val body = resp.body ?: error("Resposta vazia do servidor.")
            val total = body.contentLength()
            body.byteStream().use { input ->
                out.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    var read: Long = 0
                    var lastPct = -1
                    while (true) {
                        val n = input.read(buf)
                        if (n <= 0) break
                        output.write(buf, 0, n)
                        read += n
                        if (total > 0) {
                            val pct = ((read * 100) / total).toInt().coerceIn(0, 100)
                            if (pct != lastPct) {
                                lastPct = pct
                                onProgress(pct)
                            }
                        }
                    }
                }
            }
        }

        // Integridade: o hash do arquivo TEM de bater com o manifesto.
        val expected = manifest.sha256?.lowercase()?.trim()
        if (expected.isNullOrBlank()) {
            out.delete()
            error("A atualização não trouxe hash de verificação. Instalação recusada por segurança.")
        }
        val actual = sha256(out)
        if (actual != expected) {
            out.delete()
            error("O arquivo baixado está corrompido (hash não confere). Tente novamente.")
        }

        onProgress(100)
        out
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Abre o instalador oficial do Android.
     *
     * Antes, em Android 8+, é preciso a permissão "instalar apps desconhecidos"
     * para o NOSSO pacote. Se ainda não foi concedida, abrimos a tela do sistema
     * para o usuário conceder — não tentamos burlar.
     *
     * Devolve `true` se o instalador foi aberto; `false` se precisou pedir a
     * permissão (o chamador deve avisar o usuário para tentar de novo).
     */
    fun install(activity: Activity, apk: File): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!activity.packageManager.canRequestPackageInstalls()) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { activity.startActivity(intent) }
                return false
            }
        }

        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.updates",
            apk,
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
        return true
    }
}
