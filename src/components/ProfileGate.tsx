import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useProfiles } from '../lib/profiles'
import { setKidsOnly } from '../lib/catalog'

/**
 * Liga o perfil ativo ao modo infantil do catálogo.
 *
 * ── POR QUE UM COMPONENTE ───────────────────────────────────────────────────
 * O catálogo é um módulo com estado próprio (`setKidsOnly`), lido por todas as
 * telas. Alguém precisa avisá-lo quando o perfil ativo muda — e esse alguém
 * tem de estar montado em TODA página, inclusive no player em tela cheia, que
 * fica fora do `Shell`.
 *
 * ── O QUE ELE FAZ ───────────────────────────────────────────────────────────
 * 1. Busca os perfis da conta logada.
 * 2. Liga/desliga o modo infantil no catálogo.
 * 3. Quando o perfil ativo MUDA, incrementa `profileEpoch` no `AuthContext` —
 *    as telas usam esse número como `key`, então home, catálogo e busca são
 *    remontados e releem o catálogo já filtrado. Sem isso, a home continuaria
 *    mostrando os cards carregados antes da troca.
 *
 * Sem conta logada, o modo infantil fica desligado (catálogo público normal).
 */
export default function ProfileGate() {
  const { user, profileEpoch, bumpProfileEpoch } = useAuth()
  const { activeProfileId, kidsOnly, loading } = useProfiles(Boolean(user))

  useEffect(() => {
    if (!user) {
      setKidsOnly(false)
      return
    }
    if (loading) return
    setKidsOnly(kidsOnly)
    // O epoch só muda quando o perfil ativo realmente muda — não a cada render.
    bumpProfileEpoch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, kidsOnly, activeProfileId])

  return null
}
