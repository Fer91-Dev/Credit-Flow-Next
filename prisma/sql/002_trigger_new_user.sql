-- ============================================================================
-- 002 — Trigger de provisión de perfiles (handle_new_user)
-- ============================================================================
-- Cada alta en auth.users (Supabase Auth) crea automáticamente su fila en
-- public.profiles con DENY-BY-DEFAULT: tenant_id = null, role = null,
-- activo = false. El usuario queda autenticable pero SIN acceso a nada hasta
-- que un admin le asigne tenant + rol y lo active.
--
-- SECURITY DEFINER: la función corre con los privilegios del owner (puede
-- insertar en public.profiles desde el contexto del trigger en el schema auth).
-- search_path fijo a public para evitar secuestro de search_path.
--
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Se puede correr
-- en el SQL Editor de Supabase o vía `prisma db execute`.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing; -- no pisar un profile ya provisionado
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Nota: las columnas tenant_id (null), role (null) y activo (default false) de
-- `profiles` ya garantizan el estado inerte; el trigger solo inserta id + email.
