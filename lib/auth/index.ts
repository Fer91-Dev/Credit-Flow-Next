import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// UUID fijo para el usuario de desarrollo (usado cuando DEV_BYPASS_AUTH=true)
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export class ApiError extends Error {
  constructor(
    public message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type AuthContext = {
  userId: string;
};

/**
 * Valida autenticación en Route Handlers (API routes).
 * Parsea JWT del header Authorization: Bearer <token>
 * En DEV_BYPASS_AUTH=true, retorna DEV_USER_ID sin validar.
 */
export async function requireAuth(request: Request): Promise<AuthContext> {
  if (process.env.DEV_BYPASS_AUTH === "true") {
    return { userId: DEV_USER_ID };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ApiError("No authorization header", "UNAUTHORIZED", 401);
  }

  const token = authHeader.slice(7);

  try {
    // Decodificar JWT sin validación completa
    // En producción, validar contra la clave pública de Supabase
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new ApiError("Token JWT inválido", "INVALID_TOKEN", 401);
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf-8")
    );

    if (!payload.sub) {
      throw new ApiError("Token sin user ID", "INVALID_TOKEN", 401);
    }

    return { userId: payload.sub };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Token JWT inválido", "INVALID_TOKEN", 401);
  }
}

/**
 * Inyectar en el where de Prisma: prisma.clientes.findMany({ where: { ...withTenant(userId) } })
 */
export function withTenant(userId: string): { user_id: string } {
  return { user_id: userId };
}
