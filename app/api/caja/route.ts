import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { montoConSigno, totalesCaja, saldosPorCuenta, esCuentaValida, etiquetaCaja } from "@/lib/domain";
import { siguienteNumeroComprobante, formatComprobante } from "@/lib/comprobantes";
import { nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/caja?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tipo=...
 * Libro de movimientos de efectivo del período + saldo total del tenant.
 *  - saldo_total: suma de TODOS los movimientos del tenant (saldo de caja actual).
 *  - periodo: ingresos/egresos/neto de los movimientos del rango.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Caja: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const hoy = new Date();
  const desdeStr = url.searchParams.get("desde")
    || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hastaStr = url.searchParams.get("hasta") || hoy.toISOString().slice(0, 10);
  const tipo = url.searchParams.get("tipo");
  const cuentaParam = url.searchParams.get("cuenta");

  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T23:59:59.999Z`);

  // La caja del admin representa la CAJA PRINCIPAL (tesorería): solo movimientos sin
  // vendedor. Lo que está en poder de los vendedores vive en sus cajas personales.
  const whereRango: Record<string, unknown> = {
    ...withTenant(tenantId),
    vendedor_id: null,
    fecha: { gte: desde, lte: hasta },
  };
  if (tipo && tipo !== "all") whereRango.tipo = tipo;
  if (esCuentaValida(cuentaParam)) whereRango.cuenta = cuentaParam;

  const [movimientos, saldoMovs, enVendedores] = await Promise.all([
    prisma.movimientos_caja.findMany({
      where: whereRango,
      include: { credito: { select: { numero: true, cliente: { select: { nombre: true, apellido: true } } } } },
      orderBy: [{ fecha: "desc" }, { created_at: "desc" }],
      take: 1000,
    }),
    // Movimientos de la caja principal (sin filtros de período) para el saldo por cuenta.
    prisma.movimientos_caja.findMany({
      where: { ...withTenant(tenantId), vendedor_id: null },
      select: { monto: true, cuenta: true, fecha: true },
    }),
    // Total en poder de vendedores (suma de las cajas personales).
    prisma.movimientos_caja.aggregate({
      where: { ...withTenant(tenantId), vendedor_id: { not: null } },
      _sum: { monto: true },
    }),
  ]);

  const periodo = totalesCaja(movimientos);
  const saldosCuenta = saldosPorCuenta(saldoMovs);
  const saldoTotal = Math.round((saldosCuenta.efectivo + saldosCuenta.banco + saldosCuenta.dolares) * 100) / 100;
  const enPoderVendedores = Math.round((enVendedores._sum.monto ?? 0) * 100) / 100;

  // Desglose por cuenta: saldo actual, ingresos/egresos del período y saldo anterior.
  type Detalle = { saldo: number; anterior: number; ingresos: number; egresos: number };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const saldosDetalle: Record<"efectivo" | "banco" | "dolares", Detalle> = {
    efectivo: { saldo: saldosCuenta.efectivo, anterior: 0, ingresos: 0, egresos: 0 },
    banco:    { saldo: saldosCuenta.banco,    anterior: 0, ingresos: 0, egresos: 0 },
    dolares:  { saldo: saldosCuenta.dolares,  anterior: 0, ingresos: 0, egresos: 0 },
  };
  for (const m of saldoMovs) {
    const cta = esCuentaValida(m.cuenta) ? m.cuenta : "efectivo";
    const t = m.fecha.getTime();
    if (t >= desde.getTime() && t <= hasta.getTime()) {
      if (m.monto >= 0) saldosDetalle[cta].ingresos = r2(saldosDetalle[cta].ingresos + m.monto);
      else saldosDetalle[cta].egresos = r2(saldosDetalle[cta].egresos + Math.abs(m.monto));
    }
  }
  for (const cta of ["efectivo", "banco", "dolares"] as const) {
    const d = saldosDetalle[cta];
    d.anterior = r2(d.saldo - (d.ingresos - d.egresos));
  }

  return successResponse({
    periodo: { desde: desdeStr, hasta: hastaStr },
    saldo_total: saldoTotal,
    en_vendedores: enPoderVendedores,
    saldos_por_cuenta: saldosCuenta,
    saldos_detalle: saldosDetalle,
    ingresos: periodo.ingresos,
    egresos: periodo.egresos,
    neto: periodo.neto,
    movimientos: movimientos.map((m) => ({
      id: m.id,
      fecha: m.fecha,
      created_at: m.created_at,
      tipo: m.tipo,
      monto: m.monto,
      metodo: m.metodo,
      cuenta: m.cuenta,
      origen: m.origen,
      destino: m.destino,
      comprobante: formatComprobante(m.serie, m.numero),
      descripcion: m.descripcion,
      credito_numero: m.credito?.numero ?? null,
      cliente: m.credito?.cliente ? nombreCompleto(m.credito.cliente) : null,
    })),
  });
});

/**
 * POST /api/caja
 * Registra un AJUSTE manual de caja (ingreso o egreso que no proviene de un
 * crédito/pago). Body: { monto > 0, sentido: "ingreso"|"egreso", descripcion, fecha?, metodo? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  // Ajuste manual de caja: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  let body: { monto?: number; sentido?: string; descripcion?: string; fecha?: string; metodo?: string; cuenta?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const monto = Number(body.monto);
  if (!monto || monto <= 0) {
    return errorResponse("El monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }
  if (!body.descripcion?.trim()) {
    return errorResponse("La descripción es requerida", "INVALID_INPUT", 400);
  }
  const ingreso = body.sentido !== "egreso";
  const cuenta = esCuentaValida(body.cuenta) ? body.cuenta : "efectivo";
  const descripcion = body.descripcion.trim();
  const metodo = body.metodo?.trim() || null;
  const fecha = body.fecha ? new Date(body.fecha) : new Date();

  const mov = await prisma.$transaction(async (tx) => {
    const numero = await siguienteNumeroComprobante(tx, tenantId, "AJU");
    return tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: "ajuste",
        monto: montoConSigno("ajuste", monto, ingreso),
        metodo,
        cuenta,
        origen: ingreso ? "Ajuste manual" : etiquetaCaja(false, cuenta),
        destino: ingreso ? etiquetaCaja(false, cuenta) : "Ajuste manual",
        serie: "AJU",
        numero,
        descripcion,
      },
    });
  });

  await registrarAuditoria({
    tenantId,
    entidad: "caja",
    entidadId: mov.id,
    accion: "crear",
    descripcion: `Ajuste de caja (${ingreso ? "ingreso" : "egreso"}) $${monto.toLocaleString("es-AR")} en ${cuenta} — ${mov.descripcion}`,
    meta: { monto: mov.monto, tipo: "ajuste", cuenta },
  });

  return successResponse(mov, 201);
});
