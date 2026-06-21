"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut, Loader2 } from "lucide-react";

/**
 * Botón de cierre de sesión real: invalida la sesión en Supabase (limpia las
 * cookies httpOnly) y redirige limpio a /auth. Reutilizable: acepta className y
 * children para adaptarse a cada contexto (sidebar, drawer, pantalla pendiente).
 */
export function SignOutButton({
  className,
  children,
  title,
}: {
  className?: string;
  children?: React.ReactNode;
  title?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/auth");
      router.refresh();
    }
  }

  return (
    <button onClick={signOut} disabled={loading} title={title} className={className}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}
