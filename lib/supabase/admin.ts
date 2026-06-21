import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con SERVICE_ROLE_KEY — SOLO SERVIDOR.
 *
 * Bypasea RLS y habilita la Admin API (crear/borrar/actualizar usuarios de
 * `auth.users`). La seguridad recae en que solo se use dentro de Route Handlers
 * protegidos con `requireRole(["admin"])` y forzando el `tenant_id` del contexto.
 *
 * ⚠️ NUNCA importar desde componentes cliente (expondría la service role key).
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
