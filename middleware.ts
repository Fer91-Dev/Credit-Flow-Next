import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rutas públicas para el middleware de sesión.
//  - /auth: pantalla de login.
//  - /api/auth: login server-side (email o usuario). Sin sesión previa: no puede exigir JWT.
//  - /api/cron: jobs disparados externamente (Vercel Cron / cron local). NO usan
//    sesión de usuario; se protegen con su propio Bearer CRON_SECRET en el handler.
//    Sin esta excepción, el middleware (Edge) los redirige al login y nunca corren.
//  - /monitoring: tunnel de Sentry (eventos de error del navegador). Same-origin, sin sesión.
const PUBLIC_PATHS = ["/auth", "/api/auth", "/api/branding", "/api/cron", "/monitoring"];

/**
 * CSP con NONCE por request (OWASP A05).
 *
 * Antes vivía estática en `next.config.ts` con `'unsafe-inline' 'unsafe-eval'` en
 * `script-src`, que es tanto como no tener CSP para scripts: cualquier inyección de HTML
 * se ejecuta igual. Con nonce, solo corren los scripts que llevan el token de ESTE request,
 * y el token cambia en cada uno — un atacante no puede adivinarlo.
 *
 * Next lee el nonce del header `Content-Security-Policy` de la REQUEST y se lo pone solo a
 * sus scripts; por eso se setea en los dos lados (request y response).
 *
 * Dos concesiones deliberadas:
 *  - `style-src 'unsafe-inline'`: Next y Tailwind inyectan estilos inline. Un `<style>`
 *    inyectado no ejecuta código; el riesgo es de otro orden que el de un script.
 *  - `'unsafe-eval'` SOLO en desarrollo: React Refresh lo necesita. En producción se cae.
 */
function armarCSP(nonce: string): string {
  const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const WSS = SUPA.replace(/^https:/, "wss:");
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://api.dicebear.com ${SUPA}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${SUPA} ${WSS}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

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

  // Nonce nuevo en CADA request. `crypto` es el global del Edge runtime (no Node).
  const nonce = btoa(crypto.randomUUID());
  const csp = armarCSP(nonce);
  // En la REQUEST: es de donde Next lo toma para firmar sus propios scripts.
  requestHeaders.set("Content-Security-Policy", csp);
  // Y aparte suelto, para los scripts que NO son de Next y hay que firmar a mano
  // (hoy: el de next-themes, que evita el parpadeo de tema antes de hidratar).
  requestHeaders.set("x-nonce", nonce);

  /** Toda respuesta que salga de acá lleva la CSP; si alguna se escapara, quedaría sin
   *  política y sería justo el agujero que esto viene a cerrar. */
  const conCSP = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  const passthrough = () =>
    conCSP(NextResponse.next({ request: { headers: requestHeaders } }));

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
            // Anti-CSRF: SameSite=Lax explícito + Secure en producción (HTTPS).
            supabaseResponse.cookies.set(name, value, { ...options, sameSite: "lax", secure: process.env.NODE_ENV === "production" })
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
    return conCSP(NextResponse.redirect(loginUrl));
  }

  return conCSP(supabaseResponse);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
