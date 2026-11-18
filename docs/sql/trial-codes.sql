-- ============================================================================
-- MovieFlix 2.0 — Códigos de 1 mês grátis (versão relacional)
-- ============================================================================
--
-- ⚠️  ESTE SQL NÃO FOI APLICADO. É OPCIONAL.
--     Precisa ser executado manualmente no Supabase → SQL Editor
--     (projeto zhsfqptngzgbcgiwwjug).
--
-- POR QUE É OPCIONAL
--   O MovieFlix já funciona sem ele. Os códigos são gravados em
--   `auth.users.app_metadata.trial_codes` do próprio cliente:
--     - fica no banco (não em memória, não em localStorage);
--     - só a Service Role escreve (o cliente não lê nem altera);
--     - sobrevive a deploy, restart e troca de dispositivo;
--     - não exige DDL.
--
--   A tabela abaixo é a versão relacional: mais rápida de consultar, com
--   índice por e-mail e com histórico centralizado para o painel. Se você
--   rodar este SQL, o código passa a usar a tabela automaticamente — a
--   detecção é feita em runtime, sem precisar de deploy.
--
-- O QUE ESTE SQL FAZ
--   1. cria `public.trial_codes`
--   2. ativa RLS sem policy: ninguém lê nem escreve pelo navegador
--   3. cria uma view de consulta para o painel administrativo
--
-- O QUE ESTE SQL NÃO FAZ
--   - não altera nenhuma tabela existente
--   - não apaga nenhum dado
--   - não toca em profiles / favorites / watch_history / auth.users
-- ============================================================================

create table if not exists public.trial_codes (
  id          bigserial primary key,
  -- Dono do código. O código só vale para este usuário.
  user_id     uuid        not null references auth.users (id) on delete cascade,
  user_email  text,
  -- sha256(pepper + user_id + código). O código em texto puro NUNCA é gravado.
  code_hash   text        not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- Preenchido na primeira validação bem-sucedida: é o que garante uso único.
  used_at     timestamptz,
  -- E-mail do administrador que gerou o código.
  created_by  text,
  -- Tentativas erradas nesta linha (proteção contra força bruta).
  attempts    integer     not null default 0
);

create index if not exists trial_codes_user_id_idx    on public.trial_codes (user_id);
create index if not exists trial_codes_user_email_idx on public.trial_codes (lower(user_email));
create index if not exists trial_codes_created_at_idx on public.trial_codes (created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Nenhuma policy é criada de propósito: com RLS ligada e sem policy, o cliente
-- (anon/authenticated) não lê nem escreve nada. Só a Service Role, usada
-- exclusivamente no backend, tem acesso.
alter table public.trial_codes enable row level security;

revoke all on public.trial_codes from anon, authenticated;
grant all on public.trial_codes to service_role;
grant usage, select on sequence public.trial_codes_id_seq to service_role;

-- ── Consulta para o painel administrativo ───────────────────────────────────
-- Mostra o histórico sem expor o hash.
create or replace view public.trial_codes_admin as
select
  c.id,
  c.user_id,
  c.user_email,
  c.created_at,
  c.expires_at,
  c.used_at,
  c.created_by,
  c.attempts,
  case
    when c.used_at is not null then 'usado'
    when c.expires_at <= now() then 'expirado'
    else 'ativo'
  end as status
from public.trial_codes c
order by c.created_at desc;

revoke all on public.trial_codes_admin from anon, authenticated;
grant select on public.trial_codes_admin to service_role;

-- ── Verificação pós-execução ────────────────────────────────────────────────
-- Deve devolver 0 (tabela vazia, pronta para uso):
--   select count(*) from public.trial_codes;
