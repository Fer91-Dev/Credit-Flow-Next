import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { normalizarUsername } from "@/lib/utils";
import { rateLimit, clientIp, sweepIfNeeded } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

// Mensaje ÚNICO para cualquier fallo (usuario inexistente, email inexistente o
// contraseña incorrecta): no revela qué parte falló → evita enumerar usuarios/emails.
const CREDENCIALES_INVALIDAS = "Credenciales incorrectas. Verificá tu usuario/email y contraseña.";

/**
 * POST /api/auth/login  (PÚBLICO — sin sesión previa)
 * Login por **email o nombre de usuario**. Supabase autentica solo por email, así que
 * si el identificador no tiene `@` se lo trata como username y se resuelve al email
 * asociado (server-side, sin devolverlo al navegador). Luego firma con el cliente SSR
 * (setea las cookies de sesión en la respuesta).
 *
 * Body: { identifier, password }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  let body: { identifier?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const identifier = body.identifier?.trim() ?? "";
  const password = body.password ?? "";
  if (!identifier || !password) {
    return errorResponse("Ingresá tu usuario/email y contraseña", "INVALID_INPUT", 400);
  }

  // Rate limit por IP: frena la fuerza bruta de contraseñas.
  sweepIfNeeded();
  const rl = rateLimit(`login:${clientIp(req)}`, 10, 5 * 60_000);
  if (!rl.ok) {
    return errorResponse("Demasiados intentos. Esperá unos minutos e intentá de nuevo.", "RATE_LIMITED", 429);
  }

  // Resolver a email. Con `@` = email directo; sin `@` = username → buscar su email.
  let email = identifier;
  if (!identifier.includes("@")) {
    const prof = await prisma.profiles.findUnique({
      where: { username: normalizarUsername(identifier) },
      select: { email: true },
    });
    if (!prof?.email) {
      return errorResponse(CREDENCIALES_INVALIDAS, "INVALID_CREDENTIALS", 401);
    }
    email = prof.email;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return errorResponse(CREDENCIALES_INVALIDAS, "INVALID_CREDENTIALS", 401);
  }

  return successResponse({ ok: true });
});
