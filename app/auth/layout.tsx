import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

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

  if (user && !esReset) redirect("/");

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
      {children}
    </div>
  );
}
