package run.velixir.movieflix.tv.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

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

/** Números do painel administrativo (GET /api/admin/stats). */
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

/**
 * Linha de `favorites` no Supabase.
 *
 * A tabela NÃO tem coluna `poster_url` — o schema real é
 * `favorites(id, user_id, media_type, title, tmdb_id, created_at)`, o mesmo que
 * o site lê em `src/lib/userData.ts`. Por isso a capa não pode vir daqui: ela é
 * resolvida pelo catálogo, com [posterUrl] preenchido em memória depois da
 * leitura. Antes desta correção o card recebia `posterUrl` vazio e o Coil
 * desenhava só o fundo cinza do placeholder.
 */
@Serializable
data class FavoriteRow(
    val id: String = "",
    @SerialName("user_id") val userId: String = "",
    @SerialName("tmdb_id") val tmdbId: Long = 0,
    @SerialName("media_type") val mediaType: String = "movie",
    val title: String = "",
    @SerialName("created_at") val createdAt: String = "",
    /** Preenchido em memória a partir do catálogo — não existe no banco. */
    @Transient val posterUrl: String = "",
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
