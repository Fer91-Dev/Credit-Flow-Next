import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/origen-refinanciacion
 *
 * DE DÓNDE SALIÓ ESTE CRÉDITO, cuando nació de una refinanciación.
 *
 * 🔴 POR QUÉ HACE FALTA. La ficha de un crédito refinanciado decía "Proviene de refinanciar
 * CRD-000006" y nada más: se veía un préstamo de $751.949,15 sin ningún rastro de que el
 * cliente había entregado $910.000,00 en el acto, ni de qué deuda se había consolidado, ni de
 * si hubo descuento. Para reconstruirlo había que abrir el crédito viejo y revisar sus pagos.
 * Dentro de seis meses, con el crédito viejo cerrado en $0, eso es arqueología.
 *
 * 🔴 SALE DE LA AUDITORÍA, no de columnas nuevas. La refinanciación ya se registra entera
 * —deuda consolidada, quita, honorarios, capital resultante y el pago de la entrega— en el
 * evento `refinanciar` del crédito ORIGEN. Agregar columnas para volver a guardar lo mismo
 * sería tener dos fuentes para el mismo hecho, que es como se desincronizan.
 *
 * El importe de la entrega se lee del PAGO, que es el dato autoritativo: el `meta` guarda a
 * cuál apunta, no cuánto fue.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id },
    select: { id: true, refinancia_a: true, es_refinanciacion: true },
  });
  if (!credito) return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  // No nació de una refinanciación: no hay origen que contar.
  if (!credito.es_refinanciacion || !credito.refinancia_a) return successResponse({ origen: null });

  const evento = await prisma.auditoria.findFirst({
    where: { ...withTenant(tenantId), entidad: "creditos", entidad_id: credito.refinancia_a, accion: "refinanciar" },
    orderBy: { created_at: "desc" },
    select: { created_at: true, meta: true, usuario_nombre: true },
  });
  if (!evento) return successResponse({ origen: null });

  const meta = (evento.meta ?? {}) as {
    deuda_consolidada?: { capital?: number; interes?: number; cargos?: number; mora?: number; total?: number };
    quita?: { tipo?: string; condonado?: number };
    honorarios?: { pct?: number; monto?: number };
    nuevo_capital?: number;
    entrega_pago_id?: string;
  };

  /**
   * El importe de la entrega sale del PAGO, no del `meta`: si el cobro se anuló después, esto
   * lo refleja en vez de seguir mostrando una entrega que ya no existe.
   */
  let entrega: { monto: number; metodo: string; fecha: Date; anulado: boolean } | null = null;
  if (meta.entrega_pago_id) {
    const pago = await prisma.pagos.findFirst({
      where: { ...withTenant(tenantId), id: meta.entrega_pago_id },
      select: { monto: true, metodo: true, fecha: true, anulado: true },
    });
    if (pago) entrega = { monto: round2(pago.monto), metodo: pago.metodo, fecha: pago.fecha, anulado: pago.anulado };
  }

  return successResponse({
    origen: {
      fecha: evento.created_at,
      /** Quién la hizo. La refinanciación no se deshace: importa saber de quién fue la firma. */
      quien: evento.usuario_nombre,
      deuda_consolidada: meta.deuda_consolidada ?? null,
      quita: meta.quita?.condonado ? round2(meta.quita.condonado) : 0,
      honorarios: meta.honorarios?.monto ? { monto: round2(meta.honorarios.monto), pct: meta.honorarios.pct ?? 0 } : null,
      nuevo_capital: meta.nuevo_capital ?? null,
      entrega,
    },
  });
});
