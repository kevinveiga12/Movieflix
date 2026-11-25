package run.velixir.movieflix.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Cliente HTTP do MovieFlix.
 *
 * Fala com a MESMA API do site (https://movieflix.velixir.run/api). Não existe
 * backend próprio do app: usuários, catálogo, favoritos, histórico e regras de
 * acesso são os do site, então o que muda no celular aparece na TV e no site.
 *
 * Nenhuma chave privada vive aqui. A única credencial é o token de sessão do
 * próprio usuário, guardado criptografado em SessionStore.
 */
class MovieFlixApi(
    private val baseUrl: String,
    private val session: SessionStore,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
        /*
          ── POR QUE ISTO EXISTE (causa do seletor de temporadas não aparecer) ──

          `/api/db/series/{id}/episodes` devolve `"description": null` em todo
          episódio (verificado em produção: 200, 1484 bytes, description null).
          O modelo `Episode` declara `description: String = ""` — NÃO anulável.

          Sem `coerceInputValues`, o kotlinx.serialization lança
          SerializationException ao encontrar null num campo não anulável. O
          `loadSeasons` engolia a exceção com `runCatching{}.getOrNull()`, então
          `seasons` ficava VAZIO e a tela inteira de temporadas/episódios era
          escondida pelo `if (isSeries && s.seasons.isNotEmpty())` — o usuário
          via só "Assistir Temporada 1, Episódio 1" e nada mais.

          `coerceInputValues` faz o null cair no valor padrão do campo em vez de
          estourar. É a correção certa: o dado do servidor é válido, o modelo é
          que era rígido demais.
        */
        coerceInputValues = true
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private suspend fun get(path: String, auth: Boolean = false): String =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url("$baseUrl$path").get()
            if (auth) session.accessToken?.let { builder.header("Authorization", "Bearer $it") }
            client.newCall(builder.build()).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) throw ApiException(resp.code, body)
                body
            }
        }

    private suspend fun post(path: String, body: String, auth: Boolean = false): String =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder()
                .url("$baseUrl$path")
                .post(body.toRequestBody(jsonMedia))
            if (auth) session.accessToken?.let { builder.header("Authorization", "Bearer $it") }
            client.newCall(builder.build()).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) throw ApiException(resp.code, text)
                text
            }
        }

    // ── Catálogo ────────────────────────────────────────────────────────────

    suspend fun movies(
        limit: Int = 60,
        offset: Int = 0,
        genre: String? = null,
        seed: String? = null,
    ): CatalogResponse {
        val q = buildString {
            append("/api/catalog/movies?limit=$limit&offset=$offset")
            if (!genre.isNullOrBlank()) append("&genre=${enc(genre)}")
            if (!seed.isNullOrBlank()) append("&seed=${enc(seed)}")
        }
        return json.decodeFromString(get(q))
    }

    suspend fun series(
        limit: Int = 60,
        offset: Int = 0,
        genre: String? = null,
        seed: String? = null,
    ): CatalogResponse {
        val q = buildString {
            append("/api/catalog/series?limit=$limit&offset=$offset")
            if (!genre.isNullOrBlank()) append("&genre=${enc(genre)}")
            if (!seed.isNullOrBlank()) append("&seed=${enc(seed)}")
        }
        return json.decodeFromString(get(q))
    }

    suspend fun search(term: String, limit: Int = 40): CatalogResponse {
        val movies = json.decodeFromString<CatalogResponse>(
            get("/api/catalog/movies?q=${enc(term)}&limit=$limit"),
        )
        val series = json.decodeFromString<CatalogResponse>(
            get("/api/catalog/series?q=${enc(term)}&limit=$limit"),
        )
        return CatalogResponse(movies.total + series.total, movies.items + series.items)
    }

    suspend fun genres(): GenresResponse = json.decodeFromString(get("/api/catalog/genres"))

    /**
     * Resolve a CAPA de vários títulos de uma vez, por `tmdb_id`.
     *
     * É o que faz Histórico e Favoritos mostrarem imagem na TV. A tabela
     * `favorites` não tem `poster_url` e `watch_history` pode ter linhas antigas
     * sem ela, então a capa vem do catálogo — mas por uma rota de índice
     * (`/api/catalog/posters`), não varrendo 26 mil títulos em páginas de 200.
     *
     * Devolve `tmdb_id → url` só para os ids que têm capa.
     */
    suspend fun posters(ids: List<Long>): Map<Long, String> {
        val clean = ids.filter { it > 0 }.distinct().take(200)
        if (clean.isEmpty()) return emptyMap()
        val q = clean.joinToString(",")
        val raw = get("/api/catalog/posters?ids=$q")
        val obj = json.parseToJsonElement(raw).jsonObject["posters"]?.jsonObject ?: return emptyMap()
        val out = mutableMapOf<Long, String>()
        for ((k, v) in obj) {
            val id = k.toLongOrNull() ?: continue
            val url = v.jsonPrimitive.contentOrNull ?: continue
            if (url.startsWith("http")) out[id] = url
        }
        return out
    }

    suspend fun seasons(tmdbId: Long): SeasonsResponse =
        json.decodeFromString(get("/api/db/series/$tmdbId/episodes"))

    /**
     * Títulos que o provedor realmente serve.
     *
     * O catálogo já chega filtrado pela API, mas Favoritos e Histórico são
     * lidos direto do Supabase e podem ter linhas de títulos que hoje não abrem.
     * Esta lista permite esconder esses cards sem apagar nada do banco.
     *
     * Devolve `null` quando a rota não responde — nesse caso o app NÃO filtra,
     * para não esconder tudo por causa de uma falha de rede.
     */
    suspend fun availability(): Availability? =
        runCatching { json.decodeFromString<Availability>(get("/api/catalog/availability")) }.getOrNull()

    // ── Autenticação ────────────────────────────────────────────────────────

    suspend fun login(email: String, password: String): LoginResponse {
        val body = """{"email":${str(email)},"password":${str(password)}}"""
        val resp = json.decodeFromString<LoginResponse>(post("/api/auth/login", body))
        resp.session?.let { session.save(it, resp.user?.email ?: email, resp.user?.id) }
        return resp
    }

    suspend fun signup(email: String, password: String, fullName: String): SignupResponse {
        val body = """{"email":${str(email)},"password":${str(password)},"fullName":${str(fullName)}}"""
        return json.decodeFromString(post("/api/auth/signup", body))
    }

    suspend fun requestRecoveryCode(email: String): String =
        post("/api/auth/request-code", """{"email":${str(email)}}""")

    suspend fun verifyRecoveryCode(email: String, code: String, newPassword: String): String =
        post(
            "/api/auth/verify-code",
            """{"email":${str(email)},"code":${str(code)},"newPassword":${str(newPassword)}}""",
        )

    suspend fun subscription(): SubscriptionResponse =
        json.decodeFromString(get("/api/subscription", auth = true))

    suspend fun plans(email: String?): PlansResponse {
        val q = if (email.isNullOrBlank()) "/api/plans" else "/api/plans?email=${enc(email)}"
        return json.decodeFromString(get(q))
    }

    /**
     * O Pix está disponível neste servidor?
     *
     * Depende de `MP_ACCESS_TOKEN` no backend. Sem ele, a tela de planos da TV
     * mantém o QR do WhatsApp.
     */
    suspend fun pixConfig(): PixConfig =
        json.decodeFromString(get("/api/payments/config"))

    /**
     * Cria a cobrança Pix.
     *
     * O VALOR NÃO É ENVIADO: o servidor resolve o preço do plano/período com a
     * mesma função que a tela de planos usa. Mandar o valor daqui permitiria
     * pedir Premium pagando Básico.
     */
    suspend fun createPix(planCode: String, period: String): PixCharge {
        val body = """{"plan_code":${str(planCode)},"period":${str(period)}}"""
        return json.decodeFromString(post("/api/payments/pix", body, auth = true))
    }

    /**
     * Status do pagamento — a TV consulta em intervalos até aprovar.
     *
     * No servidor esta rota também reconcilia: se o webhook se perdeu, é esta
     * consulta que ativa. Mas ela só ativa com confirmação oficial do Mercado
     * Pago, nunca porque o app disse que pagou.
     */
    suspend fun pixStatus(paymentId: String): PixCharge =
        json.decodeFromString(get("/api/payments/${enc(paymentId)}/status", auth = true))

    /** Números do painel administrativo — o servidor responde 403 se não for admin. */
    suspend fun adminStats(): AdminStats =
        json.decodeFromString(get("/api/admin/stats", auth = true))

    // ── Reprodução ──────────────────────────────────────────────────────────

    /**
     * Pede autorização ao servidor. A decisão de liberar ou não é SEMPRE do
     * backend (app_metadata + created_at) — o app nunca decide sozinho.
     */
    suspend fun authorizePlayback(
        tmdbId: Long,
        season: Int? = null,
        episode: Int? = null,
    ): PlaybackResponse {
        val body = buildString {
            append("""{"tmdbId":$tmdbId""")
            if (season != null) append(""","season":$season""")
            if (episode != null) append(""","episode":$episode""")
            append("}")
        }
        val r = json.decodeFromString<PlaybackResponse>(post("/api/playback/authorize", body, auth = true))
        return r.copy(
            source = r.source?.let { it.copy(url = absolute(it.url)) },
            sources = r.sources.map { it.copy(url = absolute(it.url)) },
        )
    }

    /**
     * Ancora no host da API uma URL que veio como caminho relativo.
     *
     * O servidor devolve o proxy como `/api/stream.m3u8?u=...` porque no
     * navegador a origem da página já é a do site. No app NÃO existe origem:
     * `MediaItem.fromUri("/api/...")` produz uma URI sem esquema, o ExoPlayer
     * não consegue resolver e o player fica em 0:00 / 0:00 com a tela preta.
     * Era exatamente esse o sintoma na TV.
     */
    private fun absolute(url: String): String =
        if (url.startsWith("/")) "$baseUrl$url" else url

    // ── Favoritos e histórico ───────────────────────────────────────────────
    //
    // Vão DIRETO ao Supabase, exatamente como o site faz (src/lib/userData.ts),
    // usando as tabelas reais `favorites` e `watch_history`. A RLS do Supabase
    // garante que cada usuário só lê e escreve as próprias linhas — o app não
    // tem e não precisa de nenhum privilégio extra.
    //
    // Escolha deliberada: assim o app NÃO exige nenhuma rota nova no servidor
    // do site, e o site continua exatamente como está.

    private var supabaseUrl: String? = null
    private var supabaseAnon: String? = null

    /** Lê a configuração pública do site (URL + chave anon, ambas públicas). */
    private suspend fun ensureSupabase() {
        if (supabaseUrl != null && supabaseAnon != null) return
        val cfg = json.decodeFromString<PublicConfig>(get("/api/config"))
        supabaseUrl = cfg.supabaseUrl
        supabaseAnon = cfg.supabaseAnonKey
    }

    private suspend fun sbGet(path: String): String = withContext(Dispatchers.IO) {
        ensureSupabase()
        val token = session.accessToken ?: throw ApiException(401, "sem sessão")
        val req = Request.Builder()
            .url("${supabaseUrl}/rest/v1/$path")
            .header("apikey", supabaseAnon!!)
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        client.newCall(req).execute().use { r ->
            val b = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw ApiException(r.code, b)
            b
        }
    }

    private suspend fun sbWrite(
        method: String,
        path: String,
        body: String,
        prefer: String? = null,
    ): String = withContext(Dispatchers.IO) {
        ensureSupabase()
        val token = session.accessToken ?: throw ApiException(401, "sem sessão")
        val b = Request.Builder()
            .url("${supabaseUrl}/rest/v1/$path")
            .header("apikey", supabaseAnon!!)
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .apply { prefer?.let { header("Prefer", it) } }
            .method(method, body.toRequestBody(jsonMedia))
            .build()
        client.newCall(b).execute().use { r ->
            val t = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw ApiException(r.code, t)
            t
        }
    }

    suspend fun favorites(): List<FavoriteRow> {
        val uid = session.userId ?: return emptyList()
        return json.decodeFromString(
            sbGet("favorites?select=id,user_id,tmdb_id,media_type,title,created_at&user_id=eq.$uid&order=created_at.desc"),
        )
    }

    /** Devolve true se ficou favoritado, false se foi removido. */
    suspend fun toggleFavorite(t: Title, currentlyFavorite: Boolean): Boolean {
        val uid = session.userId ?: throw ApiException(401, "sem sessão")
        if (currentlyFavorite) {
            sbWrite("DELETE", "favorites?user_id=eq.$uid&tmdb_id=eq.${t.tmdbId}", "")
            return false
        }
        val body = """{"user_id":${str(uid)},"tmdb_id":${t.tmdbId},"media_type":${str(t.type)},"title":${str(t.title)}}"""
        sbWrite("POST", "favorites", body, prefer = "return=minimal")
        return true
    }

    suspend fun history(): List<HistoryRow> {
        val uid = session.userId ?: return emptyList()
        return json.decodeFromString(
            sbGet(
                "watch_history?select=id,user_id,tmdb_id,media_type,title,poster_url," +
                    "position_seconds,duration_seconds,progress,episode_id,updated_at" +
                    "&user_id=eq.$uid&order=updated_at.desc&limit=60",
            ),
        )
    }

    /**
     * Grava a posição de reprodução. É o que faz "continuar assistindo"
     * atravessar celular, TV e site: todos leem a mesma linha.
     */
    suspend fun saveProgress(
        t: Title,
        positionSeconds: Double,
        durationSeconds: Double,
        episodeId: String? = null,
    ) {
        val uid = session.userId ?: return
        val progress =
            if (durationSeconds > 0) (positionSeconds / durationSeconds).coerceIn(0.0, 1.0) else 0.0
        val body = buildString {
            append("""{"user_id":${str(uid)},"tmdb_id":${t.tmdbId}""")
            append(""","media_type":${str(t.type)},"title":${str(t.title)}""")
            append(""","poster_url":${str(t.posterUrl)}""")
            append(""","position_seconds":$positionSeconds,"duration_seconds":$durationSeconds""")
            append(""","progress":$progress""")
            if (episodeId != null) append(""","episode_id":${str(episodeId)}""")
            append(""","updated_at":${str(java.time.Instant.now().toString())}""")
            append("}")
        }
        // upsert: a tabela tem uma linha por (user_id, tmdb_id, episode_id).
        sbWrite(
            "POST",
            "watch_history?on_conflict=user_id,tmdb_id,episode_id",
            body,
            prefer = "resolution=merge-duplicates,return=minimal",
        )
    }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

    /** Escapa uma string para JSON sem depender de reflection. */
    private fun str(s: String): String = buildString {
        append('"')
        for (c in s) {
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
            }
        }
        append('"')
    }
}

class ApiException(val status: Int, val body: String) :
    Exception("HTTP $status: ${body.take(200)}")
