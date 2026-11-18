-- ============================================================================
-- MovieFlix 2.0 — Vínculo do benefício de 30 dias grátis (e-mail + dispositivo)
-- ============================================================================
--
-- ⚠️  ESTE SQL NÃO FOI APLICADO. Precisa ser executado manualmente no
--     Supabase → SQL Editor (projeto zhsfqptngzgbcgiwwjug).
--
-- Enquanto ele não for executado, o MovieFlix continua funcionando: o vínculo
-- do dispositivo é gravado em `auth.users.app_metadata.trial` (que fica no
-- banco, só a Service Role escreve, e sobrevive a deploy). A tabela abaixo é a
-- versão relacional — mais rápida e consultável no painel administrativo.
--
-- O código detecta a existência da tabela em runtime e usa a que estiver
-- disponível. Nada quebra se este SQL nunca for rodado.
--
-- O que este SQL faz:
--   1. cria `public.trial_claims` (um vínculo por dispositivo consumido)
--   2. ativa RLS: ninguém lê nem escreve pelo navegador
--   3. cria uma view para o painel administrativo consultar os vínculos
--
-- O que este SQL NÃO faz:
--   - não altera nenhuma tabela existente
--   - não apaga nenhum dado
--   - não toca em profiles / favorites / watch_history
-- ============================================================================

create table if not exists public.trial_claims (
  id          bigserial primary key,
  -- 'device' = cookie emitido pelo servidor; 'fingerprint' = impressão de rede
  kind        text        not null default 'device',
  -- valor do vínculo (UUID do cookie ou hash da impressão de rede)
  value       text        not null,
  user_id     uuid        references auth.users (id) on delete set null,
  user_email  text,
  created_at  timestamptz not null default now(),
  -- É esta restrição que impede duas requisições simultâneas de concederem
  -- dois benefícios para o mesmo aparelho.
  constraint trial_claims_kind_value_key unique (kind, value)
);

create index if not exists trial_claims_user_id_idx on public.trial_claims (user_id);
create index if not exists trial_claims_created_at_idx on public.trial_claims (created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Nenhuma política é criada de propósito: com RLS ligada e sem policy, o
-- cliente (anon/authenticated) não lê nem escreve nada. Só a Service Role,
-- usada exclusivamente no backend, tem acesso.
alter table public.trial_claims enable row level security;

revoke all on public.trial_claims from anon, authenticated;
grant all on public.trial_claims to service_role;
grant usage, select on sequence public.trial_claims_id_seq to service_role;

-- ── Consulta para o painel administrativo ───────────────────────────────────
-- Mostra quais aparelhos já consumiram o benefício e com qual conta.
create or replace view public.trial_claims_admin as
select
  c.id,
  c.kind,
  c.value,
  c.user_id,
  c.user_email,
  c.created_at
from public.trial_claims c
order by c.created_at desc;

revoke all on public.trial_claims_admin from anon, authenticated;
grant select on public.trial_claims_admin to service_role;

-- ── Verificação pós-execução ────────────────────────────────────────────────
-- Deve devolver 0 (tabela vazia, pronta para uso):
--   select count(*) from public.trial_claims;
