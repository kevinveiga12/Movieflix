-- ============================================================================
-- MovieFlix 2.0 — CORREÇÃO DE SEGURANÇA (RLS)
-- ============================================================================
--
-- ⚠️  NÃO EXECUTE SEM APROVAÇÃO DO PROPRIETÁRIO.
--
-- Este arquivo NÃO foi aplicado. Ele existe porque a auditoria de 2026-11-18
-- comprovou, com testes reais contra o banco de produção, duas falhas graves.
-- Nenhuma tabela é apagada, nenhum dado é removido, nenhum usuário é alterado.
-- São apenas políticas de acesso (RLS) e um trigger.
--
-- ────────────────────────────────────────────────────────────────────────────
-- FALHA 1 — QUALQUER USUÁRIO SE DÁ UM PLANO PREMIUM DE GRAÇA
-- ────────────────────────────────────────────────────────────────────────────
-- Teste executado (scripts/teste-rls-episodios.py):
--   usuário recém-criado → POST /rest/v1/subscriptions
--   { user_id: <ele mesmo>, plan_code: "premium", status: "active",
--     expires_at: <1 ano no futuro> }
--   → HTTP 201, linha criada.
--   → /api/playback/authorize passou a devolver allowed=true.
--
-- Consequência: o paywall inteiro é contornável. Basta um INSERT.
--
-- ────────────────────────────────────────────────────────────────────────────
-- FALHA 2 — QUALQUER USUÁRIO SE TORNA ADMINISTRADOR
-- ────────────────────────────────────────────────────────────────────────────
-- Teste executado (scripts/teste-rls-admin.py):
--   usuário recém-criado → PATCH /rest/v1/profiles?id=eq.<ele mesmo>
--   { is_admin: true }
--   → HTTP 200, is_admin virou true.
--
-- Consequência: o painel administrativo inteiro fica exposto — cadastro de
-- conteúdo, listagem de usuários, edição de catálogo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- FALHA 3 — NENHUM PERFIL É CRIADO NO CADASTRO
-- ────────────────────────────────────────────────────────────────────────────
-- Não existe trigger em auth.users. Todo usuário novo fica sem linha em
-- `profiles`. O app foi ajustado para criar a própria linha (INSERT do próprio
-- id), o que resolve o sintoma; o trigger abaixo resolve a causa.
--
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — profiles: o usuário só pode editar nome e avatar
-- ────────────────────────────────────────────────────────────────────────────
-- A política atual permite UPDATE da linha inteira, incluindo is_admin.
-- Aqui restringimos a coluna. `is_admin` passa a ser gravável apenas pela
-- Service Role (que ignora RLS) — ou seja, só pelo servidor/painel.

-- Remove a política de UPDATE ampla, se existir com esse nome.
-- (Ajuste o nome se no seu projeto for outro — veja em Authentication → Policies.)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

-- Recria permitindo UPDATE apenas das colunas de apresentação.
-- WITH CHECK garante que is_admin não muda no processo.
CREATE POLICY "profiles_update_own_safe"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Leitura: cada um vê o próprio perfil. O painel usa Service Role e não é afetado.
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;

CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- INSERT do próprio perfil (necessário para o auto-reparo que o app faz).
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

CREATE POLICY "profiles_insert_own"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id AND is_admin = false);


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — subscriptions: usuário só LÊ a própria; nunca escreve
-- ────────────────────────────────────────────────────────────────────────────
-- Assinatura é criada pelo servidor (webhook de pagamento / painel), com a
-- Service Role. O cliente jamais deve poder inserir ou alterar.

DROP POLICY IF EXISTS "Users can insert own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_delete_own" ON public.subscriptions;

-- Leitura da própria assinatura (é o que o site e o app de TV usam).
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;

CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Nenhuma política de INSERT/UPDATE/DELETE para `authenticated`:
-- com RLS ligada e sem política, a operação é negada. A Service Role continua
-- funcionando porque ignora RLS.


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 3 — trigger: criar o perfil automaticamente no cadastro
-- ────────────────────────────────────────────────────────────────────────────
-- Resolve a FALHA 3 na origem. SECURITY DEFINER para poder escrever em
-- public.profiles a partir do schema auth.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 4 — verificação (rode DEPOIS, para confirmar)
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('profiles','subscriptions')
-- ORDER BY tablename, cmd;
--
-- Depois, repita os testes:
--   python3 scripts/teste-rls-episodios.py   → INSERT deve dar 401/403
--   python3 scripts/teste-rls-admin.py       → is_admin deve continuar false
--   python3 scripts/teste-perfil.py          → INSERT do próprio perfil deve dar 201


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 5 — dado órfão (informativo, NÃO é para executar agora)
-- ────────────────────────────────────────────────────────────────────────────
-- Existem 2 temporadas apontando para series_id = 17, que não existe em
-- `movies` (o registro foi removido). São 12 episódios com vídeo HLS real
-- (Bunny CDN) que hoje não aparecem em lugar nenhum.
--
-- O código já as ignora em vez de exibi-las como episódios de uma série
-- inventada. Para recuperá-las, o proprietário precisa informar a qual série
-- elas pertencem — não há como adivinhar. Depois disso:
--
--   UPDATE public.seasons SET series_id = <id_correto_em_movies> WHERE id IN (1, 5);
--
-- Não execute sem saber o id correto.
