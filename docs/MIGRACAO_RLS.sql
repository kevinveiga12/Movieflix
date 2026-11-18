-- ============================================================================
-- MovieFlix 2.0 — CORREÇÃO DE SEGURANÇA (RLS)
-- ============================================================================
--
-- ⚠️  NÃO EXECUTE SEM APROVAÇÃO DO PROPRIETÁRIO.
--
-- Este arquivo NÃO foi aplicado. Ele existe porque a auditoria de 2026-11-18
-- comprovou, com testes reais contra o banco de produção, duas falhas graves.
--
-- Nenhuma tabela é apagada. Nenhum dado é removido. Nenhum usuário é alterado.
-- São apenas políticas de acesso (RLS) e um trigger.
--
-- ────────────────────────────────────────────────────────────────────────────
-- FALHA 1 — QUALQUER USUÁRIO SE DÁ UM PLANO PREMIUM DE GRAÇA
-- ────────────────────────────────────────────────────────────────────────────
-- Teste executado (usuário recém-criado, token real):
--   POST /rest/v1/subscriptions
--   { user_id: <ele mesmo>, plan_code: "premium", status: "active" }
--   → HTTP 201, linha criada.
--   PATCH /rest/v1/subscriptions?user_id=eq.<ele mesmo>
--   { expires_at: "2027-11-18", status: "active" }
--   → HTTP 200, validade estendida.
--   → /api/playback/authorize passou a devolver allowed=true.
--
-- Consequência: o paywall inteiro é contornável. Basta um INSERT.
--
-- ────────────────────────────────────────────────────────────────────────────
-- FALHA 2 — QUALQUER USUÁRIO SE TORNA ADMINISTRADOR
-- ────────────────────────────────────────────────────────────────────────────
-- Teste executado:
--   POST /rest/v1/profiles { id: <ele mesmo>, name: "Audit", is_admin: true }
--   → HTTP 201, is_admin = true.
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
-- NOTA DE ENGENHARIA — por que NÃO se usa subconsulta na política
-- ============================================================================
-- A primeira versão desta migração tentava impedir a troca de `is_admin` com
--   WITH CHECK (is_admin = (SELECT p.is_admin FROM public.profiles p WHERE ...))
-- Isso é um erro: a subconsulta lê a MESMA tabela cuja política está sendo
-- avaliada, e o Postgres aborta com
--   "infinite recursion detected in policy for relation profiles"
-- derrubando toda leitura de perfil. A solução correta é um TRIGGER
-- BEFORE UPDATE, que roda depois da RLS e não participa da avaliação dela.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — profiles: bloquear escalada de privilégio via TRIGGER
-- ────────────────────────────────────────────────────────────────────────────
-- O trigger roda para qualquer UPDATE, inclusive vindo da API REST com o token
-- do usuário. Ele restaura `is_admin` ao valor anterior quando quem escreve não
-- é a Service Role. A Service Role (servidor/painel) continua podendo promover
-- administradores, porque `auth.uid()` é NULL nesse contexto.

CREATE OR REPLACE FUNCTION public.prevent_is_admin_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() é NULL quando a chamada usa a Service Role (servidor).
  -- Nesse caso, permitimos a alteração (é o painel administrativo agindo).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Usuário comum: `is_admin` nunca muda, mesmo que envie no corpo do PATCH.
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    NEW.is_admin := OLD.is_admin;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_is_admin_escalation ON public.profiles;

CREATE TRIGGER trg_prevent_is_admin_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_is_admin_escalation();

-- INSERT: o app cria a própria linha no cadastro. Garantimos que ela nasce
-- sempre com is_admin = false, sem depender da política.
CREATE OR REPLACE FUNCTION public.force_is_admin_false_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.is_admin := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_force_is_admin_false ON public.profiles;

CREATE TRIGGER trg_force_is_admin_false
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.force_is_admin_false_on_insert();

-- Política de INSERT do próprio perfil (o app faz auto-reparo no login).
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

CREATE POLICY "profiles_insert_own"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Política de UPDATE do próprio perfil — simples, sem subconsulta.
-- A proteção de `is_admin` é responsabilidade do trigger acima.
DROP POLICY IF EXISTS "profiles_update_own_safe" ON public.profiles;

CREATE POLICY "profiles_update_own_safe"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ⚠️ SELECT de profiles: NÃO alteramos.
-- A política pública atual permite ler nome/avatar de qualquer perfil, e o app
-- antigo (site e TV) pode depender disso. Restringir aqui quebraria o sistema
-- legado, o que o pedido proíbe. O risco (exposição de e-mails) é registrado no
-- relatório; a correção exigiria uma view pública separada, com aprovação.


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — subscriptions: usuário só LÊ a própria; nunca escreve
-- ────────────────────────────────────────────────────────────────────────────
-- Assinatura é criada pelo servidor (webhook de pagamento / painel), com a
-- Service Role. O cliente jamais deve poder inserir ou alterar.

DROP POLICY IF EXISTS "Users can insert own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can delete own subscription" ON public.subscriptions;
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

-- Garantir que a RLS está realmente ligada nestas tabelas.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;


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
-- SELECT tgname, tgrelid::regclass FROM pg_trigger
-- WHERE NOT tgisinternal AND tgrelid IN ('public.profiles'::regclass, 'auth.users'::regclass);
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
