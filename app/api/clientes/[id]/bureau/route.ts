import { requireRole } from "@/lib/auth";
import { requireFeature } from "@/lib/entitlements-server";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getRiesgoConfig } from "@/lib/config";
import { consultarBureau } from "@/lib/bureau";
import { registrarAuditoria } from "@/lib/audit";
import type { SenalesBureau, BureauProveedor } from "@/lib/domain";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PROVEEDORES: BureauProveedor[] = ["manual", "bcra", "nosis", "veraz"];

/**
 * GET /api/clientes/[id]/bureau  (admin · feature premium)
 * Última consulta de bureau del cliente (para mostrar en la ficha).
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const ctx = await requireRole(["admin"], req);
  requireFeature(ctx, "bureau_credito");
  const { id } = await params;

  const ultima = await prisma.consultas_bureau.findFirst({
    where: { ...withTenant(ctx.tenantId), cliente_id: id },
    orderBy: { created_at: "desc" },
  });
  return successResponse({ ultima });
});

/**
 * POST /api/clientes/[id]/bureau  (admin · feature premium)
 * Ejecuta una consulta al bureau (BCRA real; Nosis/Veraz stubs; manual = valores cargados)
 * y la guarda como snapshot en `consultas_bureau`. Devuelve las señales normalizadas.
 * Body: { proveedor?, senalesManual?: { situacionBcra, scoreExterno, chequesRechazados, deudaSistemaFinanciero } }
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const ctx = await requireRole(["admin"], req);
  requireFeature(ctx, "bureau_credito");
  const { tenantId, userId, nombre } = ctx;
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({
    where: { ...withTenant(tenantId), id },
    select: { id: true, cuit_cuil: true, documento: true, consentimiento_bureau: true },
  });
  if (!cliente) return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);

  let body: any = {};
  try { body = await req.json(); } catch { /* body opcional */ }

  const { bureau } = await getRiesgoConfig(tenantId);
  const proveedor: BureauProveedor = PROVEEDORES.includes(body.proveedor) ? body.proveedor : bureau.proveedor;

  // Consentimiento del titular (Ley 25.326): obligatorio para consultar bureaus externos.
  // El modo manual (el analista carga datos que ya posee legítimamente) queda exento.
  if (proveedor !== "manual" && !cliente.consentimiento_bureau) {
    return errorResponse(
      "El cliente no prestó conformidad para la consulta a bureaus de crédito (Ley 25.326). Registrala en la ficha del cliente.",
      "SIN_CONSENTIMIENTO",
      409,
    );
  }

  const cuit = (cliente.cuit_cuil || cliente.documento || "").replace(/\D/g, "");
  if (proveedor !== "manual" && cuit.length < 8) {
    return errorResponse("El cliente no tiene CUIT/CUIL cargado para consultar al bureau.", "INVALID_INPUT", 400);
  }

  const senalesManual: SenalesBureau | undefined = body.senalesManual
    ? {
        situacionBcra: body.senalesManual.situacionBcra ?? null,
        scoreExterno: body.senalesManual.scoreExterno ?? null,
        chequesRechazados: body.senalesManual.chequesRechazados ?? null,
        deudaSistemaFinanciero: body.senalesManual.deudaSistemaFinanciero ?? null,
      }
    : undefined;

  const resultado = await consultarBureau(proveedor, cuit, { config: bureau, senalesManual });

  const consulta = await prisma.consultas_bureau.create({
    data: {
      ...withTenant(tenantId),
      cliente_id: cliente.id,
      proveedor,
      cuit: cuit || null,
      ok: resultado.ok,
      mensaje: resultado.mensaje ?? null,
      situacion_bcra: resultado.senales.situacionBcra ?? null,
      score_externo: resultado.senales.scoreExterno ?? null,
      cheques_rechazados: resultado.senales.chequesRechazados ?? null,
      deuda_sistema: resultado.senales.deudaSistemaFinanciero ?? null,
      crudo: (resultado.crudo ?? undefined) as Prisma.InputJsonValue | undefined,
      usuario_id: userId,
      usuario_nombre: nombre ?? null,
    },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: cliente.id,
    accion: "actualizar",
    descripcion: `Consulta de bureau (${proveedor})${resultado.ok ? "" : " — sin datos/erros"}`,
    meta: { proveedor, ok: resultado.ok, situacion_bcra: resultado.senales.situacionBcra },
  });

  return successResponse({ consulta, resultado });
});
