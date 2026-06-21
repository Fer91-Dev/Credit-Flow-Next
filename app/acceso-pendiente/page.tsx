import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { requireAuth, ApiError, type AuthContext } from "@/lib/auth";
import { homeFor } from "@/lib/auth/roles";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * Pantalla para usuarios AUTENTICADOS pero SIN profile válido (deny-by-default:
 * sin tenant_id / sin role / inactivo). Evita el loop con /auth: el guard del
 * grupo autenticado manda acá (403) en lugar de rebotar al login.
 *
 *  - Si el usuario YA está provisionado → a su home (no debería ver esta pantalla).
 *  - Si no hay sesión → al login.
 *  - Si está logueado pero pendiente → muestra el aviso + cerrar sesión.
 */
export default async function AccesoPendientePage() {
  let ctx: AuthContext | null = null;
  let pendiente = false;

  try {
    ctx = await requireAuth();
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 403) {
      pendiente = true; // logueado, sin profile válido
    } else {
      redirect("/auth"); // sin sesión
    }
  }

  // Redirects fuera del try/catch para no capturar el NEXT_REDIRECT.
  if (ctx) redirect(homeFor(ctx.role)); // ya provisionado → a su home
  if (!pendiente) redirect("/auth");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        aria-hidden
        style={{
          background:
            "radial-gradient(1200px 620px at 50% -260px, rgba(60,86,130,0.22), transparent 62%), linear-gradient(180deg, #0D1626 0%, #0A1018 52%)",
        }}
      />
      <div className="w-full max-w-md rounded-xl bg-card border border-border p-8 shadow-lg shadow-black/20 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10 border border-warning/30">
          <Clock className="h-7 w-7 text-warning" />
        </div>

        <h1 className="text-lg font-semibold text-foreground">Cuenta pendiente de activación</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Tu cuenta fue creada correctamente, pero todavía no tiene acceso asignado.
          Contactá al administrador de la financiera para que te asigne un rol y active tu cuenta.
        </p>

        <div className="mt-6 flex items-center justify-center">
          <SignOutButton className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50">
            Cerrar sesión
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}
