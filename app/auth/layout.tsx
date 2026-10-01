import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getBrandingPublico } from "@/lib/branding";
import { BrandingProvider } from "@/components/auth/AuthShell";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // La recuperación de contraseña crea una sesión válida (recovery); NO hay que rebotar al
  // inicio en esa pantalla o el usuario nunca llega a setear su clave nueva.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const esReset = pathname.startsWith("/auth/reset-password");
  // El paso 2 del ingreso (código de la app) también se hace CON sesión (aal1): rebotarlo al
  // inicio armaba un bucle con el layout autenticado, que manda acá a quien le falta el código.
  const esVerificar = pathname.startsWith("/auth/verificar");

  if (user && !esReset && !esVerificar) redirect("/");

  // Branding resuelto en el SERVIDOR → el logo viene en el HTML inicial (sin parpadeo).
  const branding = await getBrandingPublico();
  return <BrandingProvider value={branding}>{children}</BrandingProvider>;
}
