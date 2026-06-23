-- ============================================================================
-- 003 — Trigger de sincronización de email (handle_user_email_change)
-- ============================================================================
-- Cuando un usuario cambia su email desde su perfil, Supabase Auth actualiza
-- auth.users.email SOLO después de que el usuario confirma el cambio desde el
-- correo. En ese momento este trigger replica el nuevo email a public.profiles,
-- que es la fuente de verdad que la app usa para mostrar identidad (sidebar,
-- saludo) y para auditoría.
--
-- Sin este trigger, profiles.email quedaría desincronizado de auth.users.email
-- (el trigger 002 solo cubre el INSERT inicial, no los cambios posteriores).
--
-- WHEN (old.email IS DISTINCT FROM new.email): solo dispara si el email cambió
-- de verdad, evitando escrituras inútiles en cada update de auth.users (que
-- ocurre, por ejemplo, en cada refresh de sesión / last_sign_in_at).
--
-- SECURITY DEFINER + search_path fijo: mismo criterio de seguridad que el 002.
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ============================================================================

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email = new.email
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();
