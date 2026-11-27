package run.velixir.movieflix.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Espelha src/lib/types.ts do site. Os nomes de campo são os mesmos que a API
 * devolve — nada é renomeado no cliente, para não divergir do backend.
 */
@Serializable
data class Title(
    val id: String = "",
    val title: String = "",
    val description: String = "",
    @SerialName("poster_url") val posterUrl: String = "",
    @SerialName("backdrop_url") val backdropUrl: String = "",
    @SerialName("video_url") val videoUrl: String = "",
    @SerialName("vote_average") val voteAverage: Double? = null,
    val popularity: Double = 0.0,
    @SerialName("release_date") val releaseDate: String = "",
    val category: String = "",
    val language: String = "",
    val quality: String = "",
    val type: String = "movie",
    @SerialName("media_type") val mediaType: String = "movie",
    @SerialName("tmdb_id") val tmdbId: Long = 0,
    val year: String = "",
    val duration: Int? = null,
    val seasons: Int? = null,
    val episodes: Int? = null,
    @SerialName("episodes_available") val episodesAvailable: List<String>? = null,
    @SerialName("dublado_ptbr") val dubladoPtbr: Boolean? = null,
) {
    val isSeries: Boolean get() = type == "tv" || mediaType == "tv"
    val ratingLabel: String get() = voteAverage?.let { String.format("%.1f", it) } ?: "—"
}

@Serializable
data class CatalogResponse(
    val total: Int = 0,
    val items: List<Title> = emptyList(),
)

@Serializable
data class GenresResponse(val genres: List<String> = emptyList())

/**
 * GET /api/config — só valores PÚBLICOS (URL do projeto e chave anon, que é
 * pública por design e protegida por RLS). A service role key nunca sai do
 * servidor e nunca chega ao app.
 */
@Serializable
data class PublicConfig(
    @SerialName("supabaseUrl") val supabaseUrl: String = "",
    @SerialName("supabaseAnonKey") val supabaseAnonKey: String = "",
    val configured: Boolean = false,
)

@Serializable
data class Episode(
    @SerialName("episode_number") val episodeNumber: Int = 0,
    val title: String = "",
    val description: String = "",
    @SerialName("video_url") val videoUrl: String = "",
    @SerialName("duration_seconds") val durationSeconds: Int? = null,
    @SerialName("thumbnail_url") val thumbnailUrl: String? = null,
)

@Serializable
data class Season(
    @SerialName("season_number") val seasonNumber: Int = 0,
    val title: String = "",
    @SerialName("poster_url") val posterUrl: String? = null,
    val episodes: List<Episode> = emptyList(),
)

@Serializable
data class SeasonsResponse(val seasons: List<Season> = emptyList())

@Serializable
data class Session(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String = "",
    @SerialName("expires_at") val expiresAt: Long = 0,
)

@Serializable
data class AuthUser(
    val id: String = "",
    val email: String = "",
    @SerialName("email_confirmed") val emailConfirmed: Boolean = false,
)

@Serializable
data class Profile(
    val id: String = "",
    val email: String = "",
    @SerialName("full_name") val fullName: String? = null,
    @SerialName("is_admin") val isAdmin: Boolean = false,
)

@Serializable
data class LoginResponse(
    val session: Session? = null,
    val user: AuthUser? = null,
    val profile: Profile? = null,
    @SerialName("isAdmin") val isAdmin: Boolean = false,
    val error: String? = null,
)

@Serializable
data class SignupResponse(
    val ok: Boolean = false,
    val email: String = "",
    val message: String = "",
    val error: String? = null,
)

@Serializable
data class PlaybackSource(
    val url: String = "",
    val label: String? = null,
    val mode: String = "embed",
)

@Serializable
data class PlaybackResponse(
    val allowed: Boolean = false,
    val reason: String? = null,
    val message: String? = null,
    val source: PlaybackSource? = null,
    /**
     * Cadeia multiprovedor: o servidor devolve TODAS as fontes em ordem de
     * preferência. O app começa na primeira e, em falha real, avança para a
     * próxima.
     */
    val sources: List<PlaybackSource> = emptyList(),
)

@Serializable
data class PlanPeriod(
    val code: String = "",
    val label: String = "",
    val months: Int = 1,
    @SerialName("price_cents") val priceCents: Int = 0,
    @SerialName("price_label") val priceLabel: String = "",
    @SerialName("full_label") val fullLabel: String? = null,
    @SerialName("saved_label") val savedLabel: String? = null,
    @SerialName("whatsapp_url") val whatsappUrl: String = "",
)

@Serializable
data class Plan(
    val id: String = "",
    val name: String = "",
    val code: String = "",
    val description: String? = null,
    @SerialName("price_cents") val priceCents: Int = 0,
    @SerialName("price_label") val priceLabel: String = "",
    val features: List<String>? = null,
    @SerialName("is_active") val isActive: Boolean = true,
    val periods: List<PlanPeriod> = emptyList(),
)

@Serializable
data class PlansResponse(val plans: List<Plan> = emptyList())

/**
 * Cobrança Pix devolvida por POST /api/payments/pix e GET /api/payments/:id/status.
 *
 * `qrCode` é o texto EMV (o "copia e cola"); `qrCodeBase64` é a imagem PNG em
 * base64, pronta para decodificar e desenhar. Ambos vêm do Mercado Pago — o app
 * nunca gera QR por conta própria.
 */
@Serializable
data class PixCharge(
    @SerialName("payment_id") val paymentId: String = "",
    val status: String = "",
    @SerialName("status_detail") val statusDetail: String? = null,
    @SerialName("amount_cents") val amountCents: Int = 0,
    @SerialName("amount_label") val amountLabel: String = "",
    val plan: PixPlanRef = PixPlanRef(),
    val period: PixPeriodRef = PixPeriodRef(),
    @SerialName("qr_code") val qrCode: String? = null,
    @SerialName("qr_code_base64") val qrCodeBase64: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    val approved: Boolean = false,
    val activated: Boolean = false,
    @SerialName("plan_expires_at") val planExpiresAt: String? = null,
)

@Serializable
data class PixPlanRef(val code: String = "", val name: String = "")

@Serializable
data class PixPeriodRef(val code: String = "", val label: String = "")

@Serializable
data class PixConfig(
    @SerialName("pix_enabled") val pixEnabled: Boolean = false,
    @SerialName("card_enabled") val cardEnabled: Boolean = false,
    @SerialName("public_key") val publicKey: String? = null,
    val mode: String = "unconfigured",
)

/**
 * Resultado da tokenização do cartão no Mercado Pago.
 *
 * `token` é o único campo que segue para o nosso servidor.
 */
data class CardTokenResult(
    val token: String,
    val paymentMethodId: String?,
    val issuerId: String?,
)

/**
 * Resultado de POST /api/payments/card.
 *
 * Não há campo de cartão: o servidor nunca recebe número, CVV ou validade.
 */
@Serializable
data class CardCharge(
    @SerialName("payment_id") val paymentId: String = "",
    val status: String = "",
    @SerialName("status_detail") val statusDetail: String? = null,
    @SerialName("amount_cents") val amountCents: Int = 0,
    @SerialName("amount_label") val amountLabel: String = "",
    val plan: PixPlanRef = PixPlanRef(),
    val period: PixPeriodRef = PixPeriodRef(),
    val approved: Boolean = false,
    val activated: Boolean = false,
    @SerialName("plan_expires_at") val planExpiresAt: String? = null,
    @SerialName("card_last4") val cardLast4: String? = null,
    @SerialName("card_brand") val cardBrand: String? = null,
    val message: String? = null,
)

/**
 * Títulos que o provedor realmente serve (GET /api/catalog/availability).
 *
 * Usado para esconder de Favoritos e Histórico os títulos que hoje não abrem,
 * sem apagar nada do banco. `ativo=false` (ou lista vazia) significa "sem
 * verificação" — nesse caso o app não filtra nada.
 */
@Serializable
data class Availability(
    val ativo: Boolean = false,
    @SerialName("gerado_em") val geradoEm: String? = null,
    val filmes: List<Long> = emptyList(),
    val series: List<Long> = emptyList(),
) {
    private val movieSet: Set<Long> get() = filmes.toHashSet()
    private val seriesSet: Set<Long> get() = series.toHashSet()

    /** O título (por tmdb_id + tipo) ainda abre no player? */
    fun allows(tmdbId: Long, mediaType: String): Boolean {
        if (!ativo) return true
        return if (mediaType == "tv") seriesSet.contains(tmdbId) else movieSet.contains(tmdbId)
    }
}

/**
 * Números do painel administrativo (GET /api/admin/stats).
 *
 * A rota é protegida no SERVIDOR por `requireAdmin`, que confere
 * `profiles.is_admin` no banco e, se ADMIN_EMAILS estiver definida, também o
 * e-mail. O app só exibe a opção; quem decide é o backend.
 */
@Serializable
data class AdminStats(
    val users: Int = 0,
    val favorites: Int = 0,
    val history: Int = 0,
    val editedMovies: Int = 0,
    val editedSeries: Int = 0,
    val hidden: Int = 0,
    val updatedAt: String? = null,
)

@Serializable
data class SubscriptionResponse(
    val allowed: Boolean = false,
    val reason: String? = null,
    val message: String? = null,
    @SerialName("trial_ends_at") val trialEndsAt: String? = null,
    @SerialName("days_left") val daysLeft: Int? = null,
    val plan: Plan? = null,
)

/** Linha de `favorites` no Supabase (schema real, verificado no site). */
@Serializable
data class FavoriteRow(
    val id: String = "",
    @SerialName("user_id") val userId: String = "",
    @SerialName("tmdb_id") val tmdbId: Long = 0,
    @SerialName("media_type") val mediaType: String = "movie",
    val title: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

/** Linha de `watch_history` no Supabase. */
@Serializable
data class HistoryRow(
    val id: String = "",
    @SerialName("user_id") val userId: String = "",
    @SerialName("tmdb_id") val tmdbId: Long = 0,
    @SerialName("media_type") val mediaType: String = "movie",
    val title: String = "",
    @SerialName("poster_url") val posterUrl: String = "",
    @SerialName("position_seconds") val positionSeconds: Double = 0.0,
    @SerialName("duration_seconds") val durationSeconds: Double = 0.0,
    val progress: Double = 0.0,
    @SerialName("episode_id") val episodeId: String? = null,
    @SerialName("updated_at") val updatedAt: String = "",
)
