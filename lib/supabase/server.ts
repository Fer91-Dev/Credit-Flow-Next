import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // Anti-CSRF: SameSite=Lax explícito + Secure en producción (HTTPS).
              cookieStore.set(name, value, { ...options, sameSite: "lax", secure: process.env.NODE_ENV === "production" })
            );
          } catch {
            // Server Components no pueden setear cookies; el middleware maneja el refresh
          }
        },
      },
    }
  );
}
