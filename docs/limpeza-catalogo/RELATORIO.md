# Limpeza do catálogo — títulos que não abrem o player

Gerado em 2026-11-23T12:14:29.795Z a partir de
`public/filmes/megaembed-disponibilidade.json` (verificação de 2026-11-22T23:13:31.703Z).

## Números

| | Antes | Depois | Ocultos |
|---|---:|---:|---:|
| Filmes | 18080 | 15415 | 2665 |
| Séries | 8093 | 6400 | 1693 |
| **Total** | **26173** | **21815** | **4358** |

## Por que foram ocultados

O player é o **MegaEmbed** (`https://mgeb.space/embed/{tmdb_id}`). Ele publica a
lista de TMDB IDs que serve:

- `GET https://mgeb.space/api/movie` → 21317 IDs
- `GET https://mgeb.space/api/series` → 7741 IDs

Um ID **fora** dessa lista não tem fonte no provedor: o embed abre sem vídeo.
Esses títulos foram ocultados do catálogo público.

## Limite honesto desta verificação

`reproducao_validada: false`.

O que foi provado: **o título existe no catálogo oficial do provedor** (a fonte
existe). O que **não** foi provado: que o vídeo inicia em cada aparelho — o
Cloudflare Turnstile do MegaEmbed responde 403 em todos os domínios
(`mgeb.space`, `.lat`, `.casa`, `.quest`) a partir do ambiente de build, medido
com curl e com Chromium real. A prova de reprodução só o player do cliente pode
dar.

## Como reverter

A limpeza é aplicada na **leitura**, não nos dados:

1. **Reverter tudo:** apague `public/filmes/megaembed-disponibilidade.json` e
   publique. Sem o arquivo, site e API voltam a mostrar o catálogo inteiro.
2. **Reverter um título:** adicione o `tmdb_id` à lista `filmes` (ou `series`)
   do `megaembed-disponibilidade.json` e publique.
3. **Reverter um grupo:** use `removidos.csv` para escolher os ids.

O catálogo completo (`filmes.light.json` / `series.light.json`) **nunca foi
alterado** — nenhum registro foi apagado.

## Arquivos

- `removidos.json` — lista completa (tipo, tmdb_id, título, ano, motivo)
- `removidos.csv` — a mesma lista em CSV
