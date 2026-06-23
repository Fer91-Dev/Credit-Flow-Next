import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/auth"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Propagamos el pathname en un header para que el Layout Guard (server
  // component) sepa qué ruta se está pidiendo y aplique el control por rol.
  // El rol NO se valida acá: el middleware corre en el Edge runtime y Prisma no
  // está disponible. La autorización por rol vive en el Layout Guard (Node) y,
  // de forma autoritativa, en cada Route Handler (requireRole). [Hardening
  // futuro: custom claim de rol en el JWT para pre-chequear en este punto.]
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  const passthrough = () =>
    NextResponse.next({ request: { headers: requestHeaders } });

  // DEV_BYPASS_AUTH: omite la validación JWT, pero igual propaga el pathname.
  if (process.env.DEV_BYPASS_AUTH === "true") {
    return passthrough();
  }

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return passthrough();
  }

  let supabaseResponse = passthrough();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() valida el JWT contra Supabase — nunca usar getSession() en servidor.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth";
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
