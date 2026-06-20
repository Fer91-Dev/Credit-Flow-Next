import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { montoConSigno, totalesCaja, saldosPorCuenta, esCuentaValida } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/caja?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tipo=...
 * Libro de movimientos de efectivo del período + saldo total del tenant.
 *  - saldo_total: suma de TODOS los movimientos del tenant (saldo de caja actual).
 *  - periodo: ingresos/egresos/neto de los movimientos del rango.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  const url = new URL(req.url);
  const hoy = new Date();
  const desdeStr = url.searchParams.get("desde")
    || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hastaStr = url.searchParams.get("hasta") || hoy.toISOString().slice(0, 10);
  const tipo = url.searchParams.get("tipo");
  const cuentaParam = url.searchParams.get("cuenta");

  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T23:59:59.999Z`);

  const whereRango: Record<string, unknown> = {
    ...withTenant(userId),
    fecha: { gte: desde, lte: hasta },
  };
  if (tipo && tipo !== "all") whereRango.tipo = tipo;
  if (esCuentaValida(cuentaParam)) whereRango.cuenta = cuentaParam;

  const [movimientos, saldoMovs] = await Promise.all([
    prisma.movimientos_caja.findMany({
      where: whereRango,
      include: { credito: { select: { numero: true, cliente: { select: { nombre: true } } } } },
      orderBy: [{ fecha: "desc" }, { created_at: "desc" }],
      take: 1000,
    }),
    // Todos los movimientos del tenant (sin filtros) para el saldo por cuenta y total.
    prisma.movimientos_caja.findMany({
      where: { ...withTenant(userId) },
      select: { monto: true, cuenta: true },
    }),
  ]);

  const periodo = totalesCaja(movimientos);
  const saldosCuenta = saldosPorCuenta(saldoMovs);
  const saldoTotal = Math.round((saldosCuenta.efectivo + saldosCuenta.banco + saldosCuenta.dolares) * 100) / 100;

  return successResponse({
    periodo: { desde: desdeStr, hasta: hastaStr },
    saldo_total: saldoTotal,
    saldos_por_cuenta: saldosCuenta,
    ingresos: periodo.ingresos,
    egresos: periodo.egresos,
    neto: periodo.neto,
    movimientos: movimientos.map((m) => ({
      id: m.id,
      fecha: m.fecha,
      tipo: m.tipo,
      monto: m.monto,
      metodo: m.metodo,
      cuenta: m.cuenta,
      descripcion: m.descripcion,
      credito_numero: m.credito?.numero ?? null,
      cliente: m.credito?.cliente?.nombre ?? null,
    })),
  });
});

/**
 * POST /api/caja
 * Registra un AJUSTE manual de caja (ingreso o egreso que no proviene de un
 * crédito/pago). Body: { monto > 0, sentido: "ingreso"|"egreso", descripcion, fecha?, metodo? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

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

  const mov = await prisma.movimientos_caja.create({
    data: {
      ...withTenant(userId),
      fecha: body.fecha ? new Date(body.fecha) : new Date(),
      tipo: "ajuste",
      monto: montoConSigno("ajuste", monto, ingreso),
      metodo: body.metodo?.trim() || null,
      cuenta,
      descripcion: body.descripcion.trim(),
    },
  });

  await registrarAuditoria({
    userId,
    entidad: "caja",
    entidadId: mov.id,
    accion: "crear",
    descripcion: `Ajuste de caja (${ingreso ? "ingreso" : "egreso"}) $${monto.toLocaleString("es-AR")} en ${cuenta} — ${mov.descripcion}`,
    meta: { monto: mov.monto, tipo: "ajuste", cuenta },
  });

  return successResponse(mov, 201);
});
