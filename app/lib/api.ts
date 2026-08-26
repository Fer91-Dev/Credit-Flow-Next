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
 * Reporta a Sentry un error NO esperado (500) y devuelve una REFERENCIA corta para dársela
 * al usuario. Los ApiError y los errores de negocio mapeados (unique/fk/not found → 4xx) NO
 * se reportan: son control de flujo normal.
 *
 * Adjunta el actor del request (quién lo disparó) para el soporte multi-tenant.
 *
 * 🔴 POR QUÉ LA REFERENCIA.
 *
 * El usuario veía "Error interno del servidor", sin nada. Para encontrar qué le pasó había
 * que correlacionar a mano por hora y por persona en Sentry — y si dos cosas parecidas
 * ocurrían cerca, era adivinar. Con esto, "me dio error" pasa a ser "me dio error a3f9c2".
 *
 * El id que devuelve Sentry son 32 caracteres: impronunciable por teléfono. Así que la
 * referencia se genera ACÁ, corta, y se manda como ETIQUETA del evento (`tags.ref`) — se
 * busca en Sentry con `ref:a3f9c2`. Tiene que ir en el capture, no después: etiquetar un
 * scope nuevo cuando el evento ya salió no lo toca.
 *
 * Generarla acá en vez de recortar el id de Sentry además la hace independiente del SDK: si
 * no hay DSN configurado no se manda nada, pero la referencia sigue sirviendo porque queda
 * en el log del servidor junto al stack.
 */
function reportarErrorInterno(err: unknown): string {
  const actor = getAuditActor();
  const ref = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  Sentry.captureException(err, {
    tags: { ref },
    ...(actor ? { user: { id: actor.userId, username: actor.nombre ?? undefined, email: actor.email ?? undefined } } : {}),
  });
  return ref;
}

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  /** Referencia corta del evento en Sentry (solo en los 500). Se busca con `ref:xxxxxxxx`. */
  ref?: string;
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
  statusCode: number = 400,
  ref?: string,
): Response {
  return new Response(JSON.stringify({ ok: false, error, code, ...(ref ? { ref } : {}) } as ApiResponse), {
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
          // 🔴 Se loguea aunque sea un 4xx. Este branch atrapa el P2025 de Prisma ("depends
          // on records that were required but not found"), que puede venir de CUALQUIER
          // update/delete de la transacción — y salía como un "No encontrado" pelado, sin
          // traza ni en el log ni en Sentry. Diagnosticar eso a ciegas cuesta horas.
          console.error('[API 404]', err);
          return errorResponse('No encontrado', 'NOT_FOUND', 404);
        }

        /**
         * Error genérico (no esperado) → 500 + Sentry.
         *
         * La referencia va DENTRO del mensaje además de en su campo: media app lee
         * `json.error` como texto plano (`setError(json.error)`, toasts), así que ponerla
         * solo en `ref` la haría invisible en casi todas las pantallas. Así aparece en
         * todas sin tocar un solo lugar de los que muestran el error.
         */
        const ref = reportarErrorInterno(err);
        console.error('[API Error]', ref, err);
        return errorResponse(
          `Error interno del servidor · ref ${ref}`,
          'INTERNAL_ERROR',
          500,
          ref,
        );
      }

      const refDesconocido = reportarErrorInterno(err);
      console.error('[API Error desconocido]', refDesconocido, err);
      return errorResponse(`Error desconocido · ref ${refDesconocido}`, 'UNKNOWN_ERROR', 500, refDesconocido);
    }
  });
}
