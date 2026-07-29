import { requireRole } from "@/lib/auth";
import { ApiError } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { listarCorridasBackup } from "@/lib/backups";
import { calcularSaludBackup } from "@/lib/backup-salud";
import type { NextRequest } from "next/server";

/**
 * GET /api/backups/salud
 * Salud del respaldo (para la campanita): solo el estado agregado, sin la lista completa.
 * Admin-only. Si el token no está configurado, devuelve "neutro" (no alarma: el backup
 * automático nocturno igual corre con sus propios secrets, independiente de este token).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireRole(["admin"], req);
  try {
    const corridas = await listarCorridasBackup(10);
    return successResponse({ salud: calcularSaludBackup(corridas) });
  } catch (e) {
    // Sin token / GitHub caído: no mostrar alerta (evita falsos positivos en la campanita).
    if (e instanceof ApiError) {
      return successResponse({ salud: { tono: "neutro", titulo: "", detalle: "" } });
    }
    throw e;
  }
});
