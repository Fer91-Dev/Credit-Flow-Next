import { requireRole, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { lockCreditoTx } from "@/lib/locks";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, hoyComercial } from "@/lib/utils";
import {
  esCreditoVivo, vencimientosDelPlan, validarCambioFechas, estadoCuotaRefechada, ledgerRefechado,
  estadoTrasMoverLedger, type CronogramaConfig, type FrecuenciaDef,
} from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (s: unknown): Date | null =>
  typeof s === "string" && RE_YMD.test(s) ? new Date(`${s}T00:00:00.000Z`) : null;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Lo que hace falta del crédito para re-fecharlo con SU cronograma congelado. */
async function cargar(tenantId: string, id: string) {
  return prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id },
    select: {
      id: true, numero: true, estado: true, fecha_inicio: true, plazo_meses: true, frecuencia: true,
      frecuencia_def: true, cronograma: true, refinancia_a: true, es_refinanciacion: true,
      cuotas: { orderBy: { nro: "asc" }, select: { id: true, nro: true, fecha_vencimiento: true, estado: true } },
    },
  });
}

function sugerir(c: NonNullable<Awaited<ReturnType<typeof cargar>>>, inicio: Date): Date[] {
  const catalogo = c.frecuencia_def ? [c.frecuencia_def as unknown as FrecuenciaDef] : undefined;
  return vencimientosDelPlan(inicio, c.cuotas.length, c.frecuencia, (c.cronograma ?? undefined) as CronogramaConfig | undefined, catalogo);
}

/**
 * GET /api/creditos/[id]/fechas?inicio=YYYY-MM-DD
 * Los vencimientos que le corresponden al crédito si se hubiera otorgado ese día, con SU
 * cronograma congelado (frecuencia, día fijo, corte, días no hábiles). Solo sugiere: el
 * operador puede ajustar cada fecha antes de guardar.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;
  const inicio = fecha(req.nextUrl.searchParams.get("inicio"));
  if (!inicio) return errorResponse("Fecha de otorgamiento inválida", "INVALID_INPUT", 400);
  const c = await cargar(tenantId, id);
  if (!c) return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  return successResponse({ vencimientos: sugerir(c, inicio).map(ymd) });
});

/**
 * PATCH /api/creditos/[id]/fechas — cambia la fecha de otorgamiento y los vencimientos.
 * Body: { fecha_inicio: "YYYY-MM-DD", vencimientos: ["YYYY-MM-DD", …] (uno por cuota), motivo }
 *
 * Solo admin, solo créditos vivos y sin acuerdo de pago vigente (el acuerdo tiene su propio
 * calendario, armado sobre los vencimientos de hoy). No toca importes, cobros ni caja: ver
 * `lib/domain/cambio-fechas.ts`.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  let body: { fecha_inicio?: unknown; vencimientos?: unknown; motivo?: unknown };
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }

  const inicio = fecha(body.fecha_inicio);
  const lista = Array.isArray(body.vencimientos) ? body.vencimientos.map(fecha) : [];
  const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
  if (!inicio) return errorResponse("Indicá la fecha de otorgamiento.", "INVALID_INPUT", 400);
  if (lista.some((d) => !d)) return errorResponse("Hay un vencimiento sin fecha válida.", "INVALID_INPUT", 400);
  if (!motivo) return errorResponse("Indicá por qué se cambian las fechas: queda en la auditoría.", "INVALID_INPUT", 400);
  const vencimientos = lista as Date[];

  const c = await cargar(tenantId, id);
  if (!c) return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  if (!esCreditoVivo(c.estado)) {
    return errorResponse("Solo se le cambian las fechas a un crédito vivo (activo o vencido).", "INVALID_STATE", 409);
  }
  const acuerdo = await prisma.acuerdos_pago.findFirst({
    where: { ...withTenant(tenantId), credito_id: id, estado: "vigente" },
    select: { id: true },
  });
  if (acuerdo) {
    return errorResponse("Tiene un acuerdo de pago vigente, armado sobre estos vencimientos. Anulá el acuerdo antes de cambiar las fechas.", "INVALID_STATE", 409);
  }

  const hoy = hoyComercial();
  const err = validarCambioFechas(inicio, vencimientos, c.cuotas.length, hoy);
  if (err) return errorResponse(err, "INVALID_INPUT", 400);

  const cuotasNuevas = c.cuotas.map((q, i) => ({
    id: q.id, nro: q.nro, antes: q.fecha_vencimiento, vencimiento: vencimientos[i],
    estado: estadoCuotaRefechada(q.estado, vencimientos[i], hoy),
  }));
  const ledger = ledgerRefechado(cuotasNuevas, hoy);
  const estado = estadoTrasMoverLedger(c.estado, ledger);

  // Un crédito anterior al sistema guarda su 1er vencimiento en el snapshot: se mantiene al día.
  const cronograma = c.cronograma as Record<string, unknown> | null;
  const anterior = cronograma?.anterior as Record<string, unknown> | undefined;
  const cronogramaNuevo = anterior
    ? { ...cronograma, anterior: { ...anterior, primerVencimiento: ymd(vencimientos[0]) } }
    : undefined;

  await prisma.$transaction(async (tx) => {
    await lockCreditoTx(tx, tenantId, id);
    // Re-chequeo adentro del lock: un cobro o un acuerdo pudo entrar entre la lectura y acá.
    const vivo = await tx.creditos.findFirst({ where: { ...withTenant(tenantId), id }, select: { estado: true } });
    if (!vivo || !esCreditoVivo(vivo.estado)) throw new ApiError("El crédito cambió de estado mientras tanto. Recargá la pantalla.", "INVALID_STATE", 409);
    for (const q of cuotasNuevas) {
      await tx.cuotas.update({ where: { id: q.id }, data: { fecha_vencimiento: q.vencimiento, estado: q.estado } });
    }
    await tx.creditos.update({
      where: { id },
      data: {
        fecha_inicio: inicio,
        proximo_pago: ledger.proximoPago,
        dias_mora: ledger.diasMoraMax,
        estado,
        ...(cronogramaNuevo && { cronograma: cronogramaNuevo as object }),
      },
    });
  });

  const [{ refinancia_a_numero }] = await conNumeroDeOrigen(tenantId, [c]);
  const numeroFmt = formatCreditoNumero(c.numero, refinancia_a_numero);
  const cambiadas = cuotasNuevas.filter((q) => q.antes.getTime() !== q.vencimiento.getTime());
  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "cambiar_fechas",
    descripcion: `Crédito ${numeroFmt}: otorgamiento ${ymd(c.fecha_inicio)} → ${ymd(inicio)}, ${cambiadas.length} vencimiento${cambiadas.length === 1 ? "" : "s"} movido${cambiadas.length === 1 ? "" : "s"} — ${motivo}`,
    meta: {
      motivo,
      fecha_inicio: { antes: ymd(c.fecha_inicio), despues: ymd(inicio) },
      vencimientos: cambiadas.map((q) => ({ nro: q.nro, antes: ymd(q.antes), despues: ymd(q.vencimiento) })),
      estado: { antes: c.estado, despues: estado },
      dias_mora: ledger.diasMoraMax,
    },
  });

  return successResponse({ estado, dias_mora: ledger.diasMoraMax, proximo_pago: ledger.proximoPago ? ymd(ledger.proximoPago) : null });
});
