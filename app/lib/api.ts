import { ApiError } from '@/lib/auth';
import type { NextRequest } from 'next/server';

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
  return async (req: NextRequest, ...args: A) => {
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

        // Error genérico
        console.error('[API Error]', err);
        return errorResponse(
          'Error interno del servidor',
          'INTERNAL_ERROR',
          500
        );
      }

      return errorResponse('Error desconocido', 'UNKNOWN_ERROR', 500);
    }
  };
}
