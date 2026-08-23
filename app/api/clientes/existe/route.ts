import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { nombreCompleto } from "@/lib/utils";
import { normalizarCuit } from "@/lib/clientes-validacion";
import type { NextRequest } from "next/server";

/**
 * GET /api/clientes/existe?documento=36049884&cuit=20360498843&excluir=<id?>
 * Chequeo en vivo para el formulario:
 *  - dni: si el DNI ya está cargado (prioridad: el DNI no debería repetirse).
 *  - cuit: si el CUIT ya está cargado (identificador único; diferencia DNI repetidos).
 * `excluir` evita marcar al propio cliente en modo edición.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin", "vendedor"], req);

  const url = new URL(req.url);
  const documento = url.searchParams.get("documento")?.trim() || null;
  const cuit = normalizarCuit(url.searchParams.get("cuit"));
  const excluir = url.searchParams.get("excluir");

  const base: Record<string, unknown> = { ...withTenant(tenantId) };
  if (excluir) base.id = { not: excluir };

  // `estado` viaja también: si el homónimo está fallecido o dado de baja, el formulario
  // tiene que DECIRLO. Sin este dato el aviso quedaba en "ya existe un cliente con este
  // DNI", el operador no entendía por qué no lo encontraba en el simulador y terminaba
  // intentando crearlo de nuevo.
  const campos = { id: true, nombre: true, apellido: true, estado: true };
  const [dni, cuitRow] = await Promise.all([
    documento
      ? prisma.clientes.findFirst({ where: { ...base, documento }, select: campos })
      : Promise.resolve(null),
    cuit
      ? prisma.clientes.findFirst({ where: { ...base, cuit_cuil: cuit }, select: campos })
      : Promise.resolve(null),
  ]);

  return successResponse({
    dni: { existe: !!dni, cliente: dni ? { id: dni.id, nombre: nombreCompleto(dni), estado: dni.estado } : null },
    cuit: { existe: !!cuitRow, cliente: cuitRow ? { id: cuitRow.id, nombre: nombreCompleto(cuitRow), estado: cuitRow.estado } : null },
  });
});
