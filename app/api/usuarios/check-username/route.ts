import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { esUsernameValido, normalizarUsername } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/usuarios/check-username?u=<username>&exclude=<profileId?>
 * Disponibilidad de un nombre de usuario, en vivo (para el alta de cuentas). Solo admin.
 * El username es único GLOBAL → la búsqueda NO filtra por tenant. `exclude` permite editar
 * un usuario sin que su propio username figure como "en uso".
 *
 * Respuesta: { available: boolean, reason: "ok" | "invalid" }
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireRole(["admin"], req);

  const url = new URL(req.url);
  const u = normalizarUsername(url.searchParams.get("u") ?? "");
  const exclude = url.searchParams.get("exclude");

  if (!u) return errorResponse("Falta el usuario a verificar", "INVALID_INPUT", 400);
  if (!esUsernameValido(u)) return successResponse({ available: false, reason: "invalid" });

  const found = await prisma.profiles.findUnique({ where: { username: u }, select: { id: true } });
  const available = !found || (exclude ? found.id === exclude : false);
  return successResponse({ available, reason: "ok" });
});
