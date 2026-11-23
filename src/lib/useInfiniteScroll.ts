import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * ROLAGEM INFINITA — carrega em blocos de `pageSize` ao chegar no fim.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE UM HOOK E NÃO UM BOTÃO "CARREGAR MAIS"
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O catálogo tem 12.672 filmes e 1.965 séries. Com o botão antigo, chegar ao
 * fim exigia ~210 cliques em Filmes. O pedido é rolagem de verdade: ao chegar
 * ao fim do bloco, o próximo entra sozinho.
 *
 * ── COMO FUNCIONA ────────────────────────────────────────────────────────────
 *
 * Um `IntersectionObserver` vigia um elemento sentinela no fim da lista. Quando
 * ele entra na viewport (com `rootMargin` de 600px, para o próximo bloco já
 * estar pronto antes de a pessoa chegar lá), `visible` cresce em `pageSize`.
 *
 * ── O QUE ESTE HOOK NÃO FAZ ──────────────────────────────────────────────────
 *
 * Não busca nada na rede: o catálogo inteiro já está em memória (um único
 * `loadCatalog()`). O que cresce é só quantos itens são RENDERIZADOS. Isso é
 * proposital — 12 mil cards no DOM travariam o celular.
 *
 * ── DETALHES QUE IMPORTAM ────────────────────────────────────────────────────
 *
 * • `total` mudando (troca de gênero, busca, ordenação) reseta para o primeiro
 *   bloco. Sem isso, filtrar por "Terror" mostraria 600 itens de uma lista de
 *   40 e o "fim do catálogo" nunca apareceria.
 * • `hasMore` é derivado, não estado: evita a tela mostrar "carregando" para
 *   sempre quando o catálogo acaba.
 * • O observer é recriado quando `hasMore` muda, porque um sentinela que já
 *   está visível não dispara de novo sozinho.
 */
export function useInfiniteScroll(total: number, pageSize = 50) {
  const [visible, setVisible] = useState(pageSize)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Lista mudou (filtro/busca/ordem): volta ao primeiro bloco.
  useEffect(() => {
    setVisible(pageSize)
  }, [total, pageSize])

  const hasMore = visible < total

  const loadMore = useCallback(() => {
    setVisible((v) => Math.min(v + pageSize, Math.max(total, pageSize)))
  }, [pageSize, total])

  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el) return

    // Navegador sem IntersectionObserver (WebView muito antigo): cai no botão.
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      // 600px de antecedência: o próximo bloco chega antes do fim da tela.
      { rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  return { visible, hasMore, loadMore, sentinelRef }
}
