import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { registrarAuditoria } from "@/lib/audit";
import { dispararBackup, listarCorridasBackup } from "@/lib/backups";
import type { NextRequest } from "next/server";

/**
 * GET /api/backups
 * Estado de las últimas corridas del backup nocturno (para Configuración → Respaldos).
 * Admin-only. Si falta el token de GitHub, `listarCorridasBackup` lanza BACKUP_NOT_CONFIGURED
 * (503) y el front lo muestra como "disparo manual no configurado".
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireRole(["admin"], req);
  const corridas = await listarCorridasBackup(5);
  return successResponse({ corridas });
});

/**
 * POST /api/backups
 * Dispara un backup manual (workflow_dispatch en GitHub Actions). El respaldo real corre en
 * GitHub (pg_dump → age → R2). Admin-only + verificación de Origin (anti-CSRF).
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireRole(["admin"], req);
  assertSameOrigin(req);

  await dispararBackup();

  await registrarAuditoria({
    tenantId: ctx.tenantId,
    entidad: "plataforma",
    accion: "backup",
    descripcion: "Backup manual disparado desde Configuración",
  });

  return successResponse({ ok: true });
});
