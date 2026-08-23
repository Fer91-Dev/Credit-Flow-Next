import { requireAuth, requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { registrarAuditoria } from "@/lib/audit";
import { aplicarYRegistrarStock } from "@/lib/stock";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import { validarTransicionEstado, estadoCoherente } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]
 * Retorna un crédito específico con historial de pagos.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  // Anti-IDOR: el vendedor solo accede a sus créditos (otro dueño → 404).
  const credito = await prisma.creditos.findFirst({
    where: {
      ...withTenant(tenantId),
      ...scopeCreditosVendedor({ role, vendedorId }),
      id,
    },
    include: {
      cliente: true,
      solicitud: true,
      pagos: { orderBy: { fecha: "desc" } },
      cuotas: { select: { estado: true, pagado_capital: true, capital: true } },
      producto: { select: { id: true, nombre: true, categoria: true, imagen_url: true } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  // Estado reconciliado: nunca exponer un terminal saldado con deuda viva.
  const { cuotas, ...rest } = credito;
  const estado = estadoCoherente(credito.estado, credito.saldo_pendiente, cuotas);
  // Número del crédito que esta refinanciación reemplaza → la ficha lo muestra REF-XXXXXX.
  const [conOrigen] = await conNumeroDeOrigen(tenantId, [{ ...rest, estado }]);
  return successResponse(conOrigen);
});

/**
 * PATCH /api/creditos/[id]
 * Actualiza un crédito.
 * Body (todos opcionales):
 * {
 *   "saldo_pendiente": 500000,
 *   "tasa": 2.8,
 *   "proximo_pago": "2024-07-15",
 *   "dias_mora": 0,
 *   "estado": "activo|pagado|vencido|cancelado"
 * }
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  // Alteración del estado/saldo de un crédito: solo admin (gestión financiera).
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  // Verificar que existe y pertenece al usuario
  const existing = await prisma.creditos.findFirst({
    where: {
      ...withTenant(tenantId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  /**
   * 🔴 Las CONDICIONES de un crédito otorgado son firmes.
   *
   * Antes `tasa` y `frecuencia` se aceptaban, `monto_original` y `plazo_meses` se descartaban
   * en silencio, y **el cronograma persistido (`cuotas`) no se regeneraba nunca**. Como la
   * pantalla de amortización RECALCULA el plan a partir de tasa+plazo y el cobro usa las
   * `cuotas` guardadas, cambiar la tasa dejaba al crédito mostrando un plan y cobrando otro
   * (probado: $79.139,24 en pantalla contra $121.212,95 en la terminal de cobro). Y el
   * formulario respondía "Crédito actualizado" en los dos casos.
   *
   * Para cambiar condiciones existen `POST /anular` (revierte la caja) y `POST /refinanciar`
   * (consolida la deuda en un crédito nuevo). Los dos cuadran los libros y quedan auditados.
   *
   * `vendedor_id` también queda firme: el desembolso salió de UNA caja concreta al otorgar, y
   * reasignar el crédito no mueve ese asiento — dejaría la comisión de un vendedor colgada de
   * la caja de otro.
   */
  const CONDICIONES_FIRMES: { campo: string; etiqueta: string }[] = [
    { campo: "monto_original", etiqueta: "el capital" },
    { campo: "plazo_meses", etiqueta: "la cantidad de cuotas" },
    { campo: "tasa", etiqueta: "la tasa" },
    { campo: "frecuencia", etiqueta: "la frecuencia" },
    { campo: "cliente_id", etiqueta: "el cliente" },
    { campo: "vendedor_id", etiqueta: "el vendedor" },
  ];
  for (const { campo, etiqueta } of CONDICIONES_FIRMES) {
    if (!(campo in body) || body[campo] === undefined) continue;
    const actual = (existing as Record<string, any>)[campo];
    // El formulario reenvía todos los campos aunque no se hayan tocado: solo molesta el que
    // CAMBIA. Los números se comparan con tolerancia de un centavo.
    const igual = typeof actual === "number" && typeof body[campo] === "number"
      ? Math.abs(actual - body[campo]) < 0.01
      : (actual ?? null) === (body[campo] ?? null);
    if (!igual) {
      return errorResponse(
        `No se puede cambiar ${etiqueta} de un crédito ya otorgado. Anulá el crédito y otorgalo de nuevo, o refinancialo si ya cobró cuotas.`,
        "CONDICIONES_FIRMES",
        409
      );
    }
  }

  // Preparar datos para actualizar
  const updateData: Record<string, any> = {};
  // `tipo_credito` es la única condición reclasificable: no toca plata ni cronograma. Queda
  // afuera si el crédito es de PRODUCTOS o se lo quiere volver de productos — ese tipo está
  // atado al stock y al `producto_id`, y cambiarlo por acá dejaría el kardex descuadrado.
  const puedeReclasificar = existing.tipo_credito !== "productos" && body.tipo_credito !== "productos";
  const allowedFields = ["saldo_pendiente", "proximo_pago", "dias_mora", "estado",
    ...(puedeReclasificar ? ["tipo_credito"] : [])];

  allowedFields.forEach((field) => {
    if (field in body) {
      if (field === "proximo_pago") {
        updateData[field] = body[field] ? new Date(body[field]) : null;
      } else {
        updateData[field] = body[field];
      }
    }
  });

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No hay cambios para guardar.", "SIN_CAMBIOS", 400);
  }

  // ── Defensa de consistencia de estado ──────────────────────────────────────
  // Un estado terminal SALDADO (pagado/cancelado) no puede convivir con deuda.
  // El void administrativo (`anulado`) tiene su propio endpoint (/anular) que
  // cuadra la caja; no se permite setearlo por PATCH para no descuadrar el libro.
  if ("estado" in updateData) {
    const objetivo = String(updateData.estado);
    if (objetivo === "anulado") {
      return errorResponse(
        "Para anular un crédito usá POST /api/creditos/[id]/anular (cuadra la caja).",
        "INVALID_STATE",
        400
      );
    }
    // Saldo efectivo tras este PATCH (puede venir junto en el mismo body).
    const saldoEfectivo =
      "saldo_pendiente" in updateData ? Number(updateData.saldo_pendiente) : existing.saldo_pendiente;
    const cuotas = await prisma.cuotas.findMany({
      where: { credito_id: id },
      select: { estado: true, pagado_capital: true, capital: true },
    });
    const motivoRechazo = validarTransicionEstado(objetivo, saldoEfectivo, cuotas);
    if (motivoRechazo) {
      return errorResponse(motivoRechazo, "INVALID_STATE", 409);
    }
  }

  const updated = await prisma.creditos.update({
    where: { id },
    data: updateData,
    include: { cliente: true, pagos: { take: 5, orderBy: { fecha: "desc" } } },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Crédito de ${nombreCompleto(updated.cliente)} actualizado`,
    meta: updateData,
  });

  return successResponse(updated);
});

/**
 * DELETE /api/creditos/[id]
 * Eliminación DEFINITIVA del crédito (hard delete): borra crédito + cuotas +
 * pago_cuota por cascade. Bloqueado si el crédito tiene pagos registrados
 * (en ese caso debe ANULARSE para preservar el historial financiero).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  // Eliminación definitiva: solo admin.
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const existing = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id },
    include: { _count: { select: { pagos: true } } },
  });

  if (!existing) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  // REF-XXXXXX si el crédito nació de una refinanciación (mismo nombre que en pantalla).
  const [{ refinancia_a_numero: origenNumDel }] = await conNumeroDeOrigen(tenantId, [existing]);

  if (existing._count.pagos > 0) {
    return errorResponse(
      "El crédito tiene pagos registrados; anulalo en lugar de eliminarlo",
      "INVALID_STATE",
      409
    );
  }

  // Un crédito ya DESEMBOLSADO en caja no se puede hard-deletear: el cascade borraría el
  // desembolso sin reversa ni traza y la caja quedaría inflada. Debe ANULARSE (la anulación
  // revierte la caja con comprobante). Los créditos de producto no desembolsan efectivo → sí.
  const desembolso = await prisma.movimientos_caja.findFirst({
    where: { ...withTenant(tenantId), credito_id: id, tipo: "desembolso" },
    select: { id: true },
  });
  if (desembolso) {
    return errorResponse(
      "El crédito ya tiene un desembolso registrado en caja; anulalo en lugar de eliminarlo (la anulación revierte la caja con comprobante).",
      "INVALID_STATE",
      409,
    );
  }

  /**
   * 🔴 Un crédito CON CUOTAS VENCIDAS IMPAGAS tampoco se hard-deletea, aunque no tenga pagos
   * ni haya movido caja.
   *
   * Borrarlo no deja plata descuadrada, pero **le limpia el prontuario al deudor**: el score
   * interno (`lib/domain/scoring.ts`) se arma leyendo los `creditos` del cliente y sus
   * `cuotas`. Sin créditos, `calcularScore` devuelve `sin_historial` — el que no te pagó
   * $500.000 vuelve mañana y evalúa como cliente nuevo. La auditoría deja la traza del
   * borrado, pero el motor de riesgo no lee auditoría: lee créditos.
   *
   * "Eliminar" es para el error de carga (se otorgó mal, todavía no venció nada). Para todo
   * lo demás está ANULAR, que conserva el registro con su motivo y queda auditado.
   */
  const vencidas = await prisma.cuotas.findMany({
    where: { ...withTenant(tenantId), credito_id: id, fecha_vencimiento: { lt: hoyComercial() } },
    select: { capital: true, pagado_capital: true },
  });
  // Saldada = capital cubierto, el MISMO criterio con el que el cronograma la pinta como
  // "pagada". No se filtra por `cuotas.estado` porque ese campo solo se reescribe al cobrar:
  // una cuota que venció ayer sigue guardada como "pendiente" hasta que alguien pague.
  const hayVencidaImpaga = vencidas.some(
    (c) => c.pagado_capital < Math.round(c.capital * 100) / 100,
  );
  if (hayVencidaImpaga) {
    return errorResponse(
      "El crédito tiene cuotas vencidas impagas; anulalo en lugar de eliminarlo (eliminarlo le borraría el historial de mora al cliente).",
      "INVALID_STATE",
      409,
    );
  }

  // Crédito de producto: al borrarlo se repone el stock que se descontó al otorgar.
  // Excepción: si ya estaba ANULADO, la anulación ya lo repuso → no duplicar.
  const reponerStock = !!existing.producto_id && !!existing.producto_cantidad && existing.estado !== "anulado";

  await prisma.$transaction(async (tx) => {
    if (reponerStock) {
      // Repone el stock y lo asienta en el kardex ANTES de borrar el crédito (al borrarlo,
      // el credito_id del movimiento queda en null por SetNull, pero el asiento persiste).
      await aplicarYRegistrarStock(tx, {
        tenantId, productoId: existing.producto_id!, tipo: "devolucion_anulacion",
        cantidad: existing.producto_cantidad!, creditoId: id,
        motivo: `Eliminación ${formatCreditoNumero(existing.numero, origenNumDel)}`,
      });
    }
    await tx.creditos.delete({ where: { id } });
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Crédito ${formatCreditoNumero(existing.numero, origenNumDel)} eliminado definitivamente`,
    meta: { numero: existing.numero, monto: existing.monto_original },
  });

  return successResponse({ deleted: true });
});
