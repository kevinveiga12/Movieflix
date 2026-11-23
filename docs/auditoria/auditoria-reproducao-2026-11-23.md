# Auditoria de reprodução — 2026-11-23

Medição real contra a PRODUÇÃO (`https://movieflix.velixir.run`) e contra os
provedores que o servidor usa. Nenhum percentual aqui foi estimado: cada linha
vem do `scripts/auditar-reproducao.mjs` (4 estágios, HTTP 200 não conta).

## O que foi medido

| Conjunto | Testados | Reprodução confirmada | % |
|---|---|---|---|
| Filmes (amostra distribuída no catálogo) | 150 | 87 | **58,0%** |
| Filmes **com fonte válida encontrada** | 96 | 87 | **90,6%** |
| Séries (≥1 episódio funcional) | 80 | 15 | **18,8%** |
| Episódios | 240 | 41 | **17,1%** |

Camadas que efetivamente entregaram vídeo:

- Filmes: `watchplay_convencao` 66 · `embedplayer` 21
- Episódios: `embedplayer` 34 · `watchplay_convencao` 7

Motivos de falha (filmes): `fonte_indisponivel` 54 · `fonte_valida_mas_falhou` 8 ·
`erro_manifesto_ou_segmentos` 1.

Motivos de falha (episódios): `fonte_indisponivel` 188 ·
`erro_manifesto_ou_segmentos` 5 · `fonte_valida_mas_falhou` 6.

## Por que não é 99% (causa medida, não suposição)

1. **O catálogo tem mais títulos do que os provedores servem.** Dos 150 filmes
   amostrados, 54 não têm NENHUMA opção com `budget != danger`: o `playerflix.ink`
   responde 200 e lista só `superflixapi` marcado `danger` (plano pago). Não é
   falha do player — é o título que o provedor não entrega. O mesmo vale para 188
   de 240 episódios.

2. **`embedplay` não expõe HLS.** O `player.abyssplayer.com` monta o vídeo em JS
   (`core.bundle.js` + jwplayer). Sem executar esse JS não há m3u8 para extrair,
   e o único caminho é iframe (que na TV é o player com anúncio). Por isso esses
   8 filmes ficam como `fonte_valida_mas_falhou` no modo limpo — e continuam
   tocando pelo iframe quando `ALLOW_AD_EMBEDS=1`.

3. **O `superflixapi` responde página de captcha Cloudflare** — nunca tocou vídeo
   em nenhum teste. É o que o provedor chama de `danger`.

## O que essa medição corrigiu no entendimento

O `scripts/auditar-cobertura.mjs` antigo media só a convenção do `watchplay` e
reportava 43,3% em filmes / 3,3% em séries. O número real é 58,0% / 18,8%,
porque ele não testava duas camadas que o servidor usa de fato:
`ajax → embedplayer → getVideo → master.m3u8` (essa camada sozinha responde por
21 filmes e 34 episódios da amostra).

Com isso, **90,6%** dos filmes que TÊM fonte válida reproduzem de ponta a ponta.
O que impede os 99% é a cobertura do catálogo pelos provedores externos, não o
código do player.

## Reprodução (comandos)

```bash
node scripts/auditar-reproducao.mjs --filmes 150 --series 80 --episodios 3
node scripts/auditar-reproducao.mjs --continuar        # retoma do estado salvo
```

O estado fica em `audit/estado-reproducao.json` (fora do git) e o relatório em
`audit/relatorio-reproducao.json`. Rodar de novo retesta só o que falhou.
