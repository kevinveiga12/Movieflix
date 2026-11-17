import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'
import type { FavoriteRow, HistoryRow, MediaType, Title } from './types'

/**
 * Favoritos e histórico.
 *
 * Usa as tabelas REAIS do Supabase antigo, sem alterar o schema:
 *   favorites(id, user_id, media_type, title, tmdb_id, created_at)
 *   watch_history(id, user_id, media_type, title, poster_url, tmdb_id,
 *                 position_seconds, duration_seconds, progress, episode_id, updated_at)
 *
 * O schema foi verificado por sondagem de colunas em 2026-11-17 — as colunas
 * `title_id`, `season` e `episode` NÃO existem; o identificador é `tmdb_id` e o
 * episódio vai em `episode_id` no formato "temporada/episódio".
 *
 * RLS garante que cada usuário só lê/escreve as próprias linhas.
 */

/** "1/3" → { season: 1, episode: 3 } */
export function parseEpisodeId(episodeId: string | null): { season: number; episode: number } | null {
  if (!episodeId) return null
  const [s, e] = episodeId.split('/').map(Number)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null
  return { season: s, episode: e }
}

export function useFavorites() {
  const { user } = useAuth()
  const [favorites, setFavorites] = useState<FavoriteRow[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!user) {
      setFavorites([])
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('favorites')
      .select('id, user_id, tmdb_id, media_type, title, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) console.warn('[MovieFlix] favoritos:', error.message)
    setFavorites((data as FavoriteRow[]) ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  const isFavorite = useCallback(
    (tmdbId: string | number) => favorites.some((f) => String(f.tmdb_id) === String(tmdbId)),
    [favorites],
  )

  const toggle = useCallback(
    async (t: Title) => {
      if (!user) return { error: 'Entre na sua conta para salvar favoritos.' }
      const existing = favorites.find((f) => String(f.tmdb_id) === String(t.tmdb_id))
      if (existing) {
        const { error } = await supabase.from('favorites').delete().eq('id', existing.id)
        if (error) return { error: error.message }
        setFavorites((prev) => prev.filter((f) => f.id !== existing.id))
        return { error: null }
      }
      const row = {
        user_id: user.id,
        tmdb_id: Number(t.tmdb_id),
        media_type: t.type as MediaType,
        title: t.title,
      }
      const { data, error } = await supabase.from('favorites').insert(row).select().single()
      if (error) return { error: error.message }
      setFavorites((prev) => [data as FavoriteRow, ...prev])
      return { error: null }
    },
    [user, favorites],
  )

  return { favorites, loading, isFavorite, toggle, reload }
}

export function useHistory() {
  const { user } = useAuth()
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!user) {
      setHistory([])
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('watch_history')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(60)
    if (error) console.warn('[MovieFlix] histórico:', error.message)
    setHistory((data as HistoryRow[]) ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  const saveProgress = useCallback(
    async (args: {
      title: Title
      season?: number | null
      episode?: number | null
      position: number
      duration: number
    }) => {
      if (!user) return
      const { title, season = null, episode = null, position, duration } = args
      // Ignora posições irrelevantes (início do vídeo).
      if (position < 5) return

      const episodeId = season != null && episode != null ? `${season}/${episode}` : null
      // A coluna `progress` é INTEGER no banco (verificado: rejeita 0.2).
      // Guardamos a porcentagem inteira de 0 a 100.
      const progress = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0

      const payload = {
        user_id: user.id,
        tmdb_id: Number(title.tmdb_id),
        media_type: title.type as MediaType,
        title: title.title,
        poster_url: title.poster_url ?? null,
        position_seconds: Math.floor(position),
        duration_seconds: Math.floor(duration || 0),
        progress,
        episode_id: episodeId,
        updated_at: new Date().toISOString(),
      }

      // Uma linha por título (o histórico guarda o ponto mais recente).
      const { data: existing } = await supabase
        .from('watch_history')
        .select('id')
        .eq('user_id', user.id)
        .eq('tmdb_id', payload.tmdb_id)
        .eq('media_type', payload.media_type)
        .maybeSingle()

      if (existing?.id) {
        await supabase.from('watch_history').update(payload).eq('id', existing.id)
      } else {
        await supabase.from('watch_history').insert(payload)
      }
    },
    [user],
  )

  const progressFor = useCallback(
    (tmdbId: string | number) =>
      history.find((h) => String(h.tmdb_id) === String(tmdbId)) ?? null,
    [history],
  )

  const continueWatching = useCallback(() => {
    return history.filter((h) => {
      if (!h.duration_seconds) return h.position_seconds > 5
      const pct = h.position_seconds / h.duration_seconds
      return pct > 0.02 && pct < 0.95
    })
  }, [history])

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('watch_history').delete().eq('id', id)
    if (!error) setHistory((prev) => prev.filter((h) => h.id !== id))
    return { error: error?.message ?? null }
  }, [])

  return { history, loading, saveProgress, progressFor, continueWatching, remove, reload }
}
