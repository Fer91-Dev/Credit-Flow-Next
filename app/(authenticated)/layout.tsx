import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SWRProvider } from "@/components/providers/SWRProvider";
import { FeaturesProvider } from "@/components/providers/FeaturesProvider";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm";
import { requireAuth, ApiError, type AuthContext } from "@/lib/auth";
import { canAccess, homeFor } from "@/lib/auth/roles";

/**
 * Guard server-side del grupo autenticado. Dos barreras, ninguna confía en el
 * frontend:
 *  1) Autenticación + contexto (deny-by-default si no hay profile/rol válido).
 *  2) Autorización por ruta según el rol (canAccess sobre el pathname real).
 *
 * Distinción clave para no entrar en loop con /auth:
 *  - Sin sesión (401)            → /auth (login).
 *  - Con sesión, sin profile (403) → /acceso-pendiente (cuenta sin activar).
 *
 * Nota de alcance: este guard corre en carga directa / refresh de página. La
 * navegación soft entre rutas hermanas NO re-ejecuta este layout compartido;
 * la barrera autoritativa para datos es requireRole() en cada Route Handler,
 * y el menú oculta lo prohibido (cosmético).
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let ctx: AuthContext | null = null;
  try {
    ctx = await requireAuth();
  } catch (err) {
    // 403 = autenticado pero sin profile válido (deny-by-default) → pendiente.
    // Cualquier otra cosa (401 sin sesión) → login. (redirect fuera del try.)
    if (err instanceof ApiError && err.statusCode === 403) {
      redirect("/acceso-pendiente");
    }
    redirect("/auth");
  }

  const pathname = (await headers()).get("x-pathname") ?? "/";
  if (!canAccess(ctx!.role, pathname)) {
    redirect(homeFor(ctx!.role)); // sin permiso para esta ruta → a su home
  }

  return (
    <SWRProvider>
      <ToastProvider>
        <ConfirmProvider>
          <FeaturesProvider features={ctx!.features}>
            <AppShell role={ctx!.role} nombre={ctx!.nombre} email={ctx!.email} avatarUrl={ctx!.avatarUrl}>
              {children}
            </AppShell>
          </FeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </SWRProvider>
  );
}
