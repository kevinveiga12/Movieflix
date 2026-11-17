#!/usr/bin/env node
/**
 * Gerador de catálogo — MovieFlix 2.0
 *
 * Consulta o TMDB e grava public/filmes/filmes.light.json e series.light.json
 * no mesmo formato que o site original usa, para que o catálogo continue
 * compatível com o app de TV e com o app mobile.
 *
 * Uso:
 *   TMDB_API_KEY=xxx node scripts/gerar-catalogo.mjs
 *   TMDB_API_KEY=xxx node scripts/gerar-catalogo.mjs --pages 20
 *
 * IMPORTANTE: o TMDB fornece METADADOS e IMAGENS, não os vídeos. A URL de
 * reprodução (video_url) é cadastrada pelo administrador, com fonte própria e
 * legalmente autorizada. Este script nunca tenta obter vídeos de terceiros.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

const KEY = process.env.TMDB_API_KEY
const LANG = process.env.TMDB_LANG ?? 'pt-BR'
const PAGES = Number(process.argv.includes('--pages') ? process.argv[process.argv.indexOf('--pages') + 1] : 12)
const OUT = path.join(process.cwd(), 'public', 'filmes')

if (!KEY) {
  console.error('Defina TMDB_API_KEY. Ex.: TMDB_API_KEY=abc123 node scripts/gerar-catalogo.mjs')
  process.exit(1)
}

const IMG = 'https://image.tmdb.org/t/p'

async function tmdb(pathname, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`)
  url.searchParams.set('api_key', KEY)
  url.searchParams.set('language', LANG)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB ${pathname} → ${res.status}`)
  return res.json()
}

/** Mapa de gêneros id → nome (pt-BR). */
async function genreMap(type) {
  const data = await tmdb(`/genre/${type}/list`)
  return Object.fromEntries((data.genres ?? []).map((g) => [g.id, g.name]))
}

function yearOf(date) {
  return date ? String(date).slice(0, 4) : ''
}

async function buildMovies() {
  const genres = await genreMap('movie')
  const seen = new Map()

  for (let page = 1; page <= PAGES; page++) {
    const data = await tmdb('/movie/popular', { page })
    for (const m of data.results ?? []) {
      if (!m.poster_path || seen.has(m.id)) continue
      seen.set(m.id, {
        id: String(m.id),
        tmdb_id: m.id,
        title: m.title,
        description: m.overview ?? '',
        poster_url: `${IMG}/w500${m.poster_path}`,
        backdrop_url: m.backdrop_path ? `${IMG}/w1280${m.backdrop_path}` : '',
        video_url: '',
        vote_average: m.vote_average ?? null,
        popularity: m.popularity ?? 0,
        release_date: m.release_date ?? '',
        year: yearOf(m.release_date),
        category: (m.genre_ids ?? []).map((id) => genres[id]).filter(Boolean).join(', '),
        language: 'Português',
        quality: 'HD',
        type: 'movie',
        media_type: 'movie',
        duration: null,
        dublado_ptbr: true,
      })
    }
    process.stdout.write(`\rfilmes: página ${page}/${PAGES} (${seen.size})`)
  }
  console.log()
  return [...seen.values()]
}

async function buildSeries() {
  const genres = await genreMap('tv')
  const seen = new Map()

  for (let page = 1; page <= PAGES; page++) {
    const data = await tmdb('/tv/popular', { page })
    for (const s of data.results ?? []) {
      if (!s.poster_path || seen.has(s.id)) continue
      seen.set(s.id, {
        id: String(s.id),
        tmdb_id: s.id,
        title: s.name,
        description: s.overview ?? '',
        poster_url: `${IMG}/w500${s.poster_path}`,
        backdrop_url: s.backdrop_path ? `${IMG}/w1280${s.backdrop_path}` : '',
        video_url: '',
        vote_average: s.vote_average ?? null,
        popularity: s.popularity ?? 0,
        release_date: s.first_air_date ?? '',
        year: yearOf(s.first_air_date),
        category: (s.genre_ids ?? []).map((id) => genres[id]).filter(Boolean).join(', '),
        language: 'Português',
        quality: 'HD',
        type: 'tv',
        media_type: 'tv',
        seasons: s.number_of_seasons ?? 1,
        episodes: s.number_of_episodes ?? 0,
        // Preenchido pelo administrador conforme as fontes autorizadas.
        episodes_available: [],
        dublado_ptbr: true,
      })
    }
    process.stdout.write(`\rséries: página ${page}/${PAGES} (${seen.size})`)
  }
  console.log()
  return [...seen.values()]
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })

  console.log('Buscando catálogo no TMDB…')
  const [movies, series] = await Promise.all([buildMovies(), buildSeries()])

  await fs.writeFile(path.join(OUT, 'filmes.light.json'), JSON.stringify(movies), 'utf8')
  await fs.writeFile(path.join(OUT, 'series.light.json'), JSON.stringify(series), 'utf8')

  console.log(`\n✓ ${movies.length} filmes → public/filmes/filmes.light.json`)
  console.log(`✓ ${series.length} séries → public/filmes/series.light.json`)
  console.log(
    '\nLembrete: video_url e episodes_available ficam vazios. Cadastre as fontes\n' +
      'autorizadas pelo painel administrativo (/admin) antes de publicar.',
  )
}

main().catch((e) => {
  console.error('\nFalhou:', e.message)
  process.exit(1)
})
