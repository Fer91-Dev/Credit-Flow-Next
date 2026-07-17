import * as Sentry from '@sentry/nextjs';
import { ApiError } from '@/lib/auth';
import { runWithAuditContext, getAuditActor } from '@/lib/audit-context';
import type { NextRequest } from 'next/server';

/**
 * Verificación de Origin (defensa en profundidad anti-CSRF). Complementa a SameSite=Lax:
 * los navegadores mandan `Origin` en las mutaciones (POST/PATCH/DELETE) y NO puede ser
 * forjado por JS de un sitio atacante. Si viene y no coincide con el host del servidor →
 * 403. Si falta (algún cliente same-origin lo omite), se confía en SameSite=Lax.
 * Usar detrás de un proxy: se respeta `x-forwarded-host`. Llamar en handlers que cambian estado.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return; // sin Origin → no es un POST cross-site con credenciales (SameSite=Lax cubre)
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError('Origen inválido', 'BAD_ORIGIN', 403);
  }
  if (!host || originHost !== host) {
    throw new ApiError('Origen no permitido (posible CSRF)', 'BAD_ORIGIN', 403);
  }
}

/**
 * Reporta a Sentry un error NO esperado (500). Los ApiError y los errores de negocio
 * mapeados (unique/fk/not found → 4xx) NO se reportan: son control de flujo normal.
 * Adjunta el actor del request (usuario que disparó el error) para el soporte multi-tenant.
 */
function reportarErrorInterno(err: unknown): void {
  const actor = getAuditActor();
  Sentry.captureException(err, actor ? {
    user: { id: actor.userId, username: actor.nombre ?? undefined, email: actor.email ?? undefined },
  } : undefined);
}

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Respuesta exitosa estandarizada.
 */
export function successResponse<T>(data: T, statusCode: number = 200): Response {
  return new Response(JSON.stringify({ ok: true, data } as ApiResponse<T>), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Respuesta de error estandarizada.
 */
export function errorResponse(
  error: string,
  code: string = 'ERROR',
  statusCode: number = 400
): Response {
  return new Response(JSON.stringify({ ok: false, error, code } as ApiResponse), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Wrapper para manejar errores en Route Handlers.
 * Cachea exceptions y las mapea a respuestas JSON.
 *
 * Propaga TODOS los argumentos al handler (req + contexto con `params`),
 * de modo que las rutas dinámicas reciban su segundo argumento intacto.
 */
export function withErrorHandler<A extends any[]>(
  handler: (req: NextRequest, ...args: A) => Promise<Response>
) {
  // Cada request corre dentro de un contexto de auditoría fresco: requireAuth (dentro del
  // handler) fija el actor y registrarAuditoria lo lee. run() + contenedor mutable es
  // robusto ante el snapshotting de contexto async de Next.js (ver lib/audit-context.ts).
  return async (req: NextRequest, ...args: A) => runWithAuditContext(async () => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      // ApiError ya tiene código y statusCode
      if (err instanceof ApiError) {
        return errorResponse(err.message, err.code, err.statusCode);
      }

      // Errores de validación Prisma
      if (err instanceof Error) {
        const msg = err.message.toLowerCase();

        if (msg.includes('unique constraint')) {
          // Mensaje amable para los casos de negocio más comunes.
          if (msg.includes('documento')) {
            return errorResponse('Ya existe un cliente con ese DNI.', 'DUPLICATE_DOCUMENTO', 409);
          }
          return errorResponse('Recurso duplicado', 'DUPLICATE_RECORD', 409);
        }
        if (msg.includes('foreign key constraint')) {
          return errorResponse('Referencia inválida', 'INVALID_REFERENCE', 400);
        }
        if (msg.includes('not found')) {
          return errorResponse('No encontrado', 'NOT_FOUND', 404);
        }

        // Error genérico (no esperado) → 500 + Sentry.
        console.error('[API Error]', err);
        reportarErrorInterno(err);
        return errorResponse(
          'Error interno del servidor',
          'INTERNAL_ERROR',
          500
        );
      }

      reportarErrorInterno(err);
      return errorResponse('Error desconocido', 'UNKNOWN_ERROR', 500);
    }
  });
}
