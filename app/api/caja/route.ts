import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { montoConSigno, totalesCaja, saldosPorCuenta, esCuentaValida, etiquetaCaja, CUENTA_LABEL, type TipoMovimiento } from "@/lib/domain";
import { siguienteNumeroComprobante, formatComprobante, type SerieComprobante } from "@/lib/comprobantes";
import { assertFondosSuficientesTx } from "@/lib/caja-fondos";
import { getDolarBlueVenta } from "@/lib/cotizacion";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
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
  const hoy = hoyComercial(); // fecha de Argentina (evita default de rango corrido por UTC)
  const desdeStr = url.searchParams.get("desde")
    || new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
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
  // Dólares = cuenta REAL en USD → NO se suma 1:1 con los pesos. El "saldo total" es solo
  // pesos (efectivo + banco); los dólares van aparte, con su valorización al blue (referencia).
  const saldoTotal = Math.round((saldosCuenta.efectivo + saldosCuenta.banco) * 100) / 100;
  const saldoDolares = saldosCuenta.dolares; // en USD
  const dolarBlue = await getDolarBlueVenta();
  const valorizacionDolares = dolarBlue != null ? Math.round(saldoDolares * dolarBlue * 100) / 100 : null;
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
    saldo_total: saldoTotal, // solo pesos (efectivo + banco)
    saldo_dolares: saldoDolares, // en USD
    dolar_blue: dolarBlue, // cotización usada para valorizar (venta), null si no disponible
    valorizacion_dolares: valorizacionDolares, // dólares × blue, en pesos (referencia)
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
 * Los tres movimientos manuales de la caja principal. Comparten forma (monto + cuenta +
 * motivo) pero significan cosas distintas, y por eso cada uno tiene su tipo y su serie:
 *
 *  - `ajuste`            — corregir un error de registro. Sentido libre.
 *  - `aporte_capital`    — el dueño pone plata. SIEMPRE ingreso.
 *  - `retiro_utilidades` — el dueño saca plata. SIEMPRE egreso.
 *
 * Antes los tres eran "ajuste": en el libro, un aporte de $10.000.000 y una corrección de
 * $1.500 se leían igual, y para saber cuál era cuál había que leer la descripción a mano.
 */
const CONCEPTOS = {
  ajuste: {
    tipo: "ajuste" as const,
    serie: "AJU" as const,
    /** null = lo decide quien carga; true/false = forzado por la naturaleza del concepto. */
    ingresoForzado: null,
    etiqueta: "Ajuste manual",
    label: "Ajuste de caja",
  },
  aporte_capital: {
    tipo: "aporte_capital" as const,
    serie: "APO" as const,
    ingresoForzado: true,
    etiqueta: "Aporte de capital",
    label: "Aporte de capital",
  },
  retiro_utilidades: {
    tipo: "retiro_utilidades" as const,
    serie: "RET" as const,
    ingresoForzado: false,
    etiqueta: "Retiro de utilidades",
    label: "Retiro de utilidades",
  },
} satisfies Record<string, { tipo: TipoMovimiento; serie: SerieComprobante; ingresoForzado: boolean | null; etiqueta: string; label: string }>;

type Concepto = keyof typeof CONCEPTOS;
const esConcepto = (v: unknown): v is Concepto => typeof v === "string" && v in CONCEPTOS;

/**
 * POST /api/caja
 * Movimiento manual de la caja principal: ajuste, aporte de capital o retiro de utilidades.
 * Body: { monto > 0, concepto?, sentido: "ingreso"|"egreso", descripcion, fecha?, metodo?, cuenta? }
 * `concepto` es opcional y default "ajuste" (compatibilidad con clientes viejos).
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  // Movimiento manual de caja: solo admin. Un aporte o un retiro son decisiones del dueño
  // del negocio, no de quien opera el mostrador.
  const { tenantId } = await requireRole(["admin"], req);

  let body: { monto?: number; concepto?: string; sentido?: string; descripcion?: string; fecha?: string; metodo?: string; cuenta?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (body.concepto !== undefined && !esConcepto(body.concepto)) {
    return errorResponse("Concepto inválido (ajuste | aporte_capital | retiro_utilidades)", "INVALID_INPUT", 400);
  }
  const concepto = CONCEPTOS[(body.concepto ?? "ajuste") as Concepto];

  const monto = Number(body.monto);
  if (!monto || monto <= 0) {
    return errorResponse("El monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }
  if (!body.descripcion?.trim()) {
    return errorResponse("La descripción es requerida", "INVALID_INPUT", 400);
  }
  // El sentido de un aporte/retiro NO se acepta del body: un "aporte de capital" que
  // reste plata no significa nada, y sería una forma de sacar dinero disfrazada.
  const ingreso = concepto.ingresoForzado ?? body.sentido !== "egreso";
  const cuenta = esCuentaValida(body.cuenta) ? body.cuenta : "efectivo";
  const descripcion = body.descripcion.trim();
  const metodo = body.metodo?.trim() || null;
  const fecha = body.fecha ? new Date(`${body.fecha}T00:00:00.000Z`) : hoyComercial();

  const mov = await prisma.$transaction(async (tx) => {
    // Ningún egreso manual puede dejar la caja principal negativa (misma decisión de
    // tesorería que cobros/desembolsos/transferencias). Vale igual para el retiro: no se
    // puede sacar una ganancia que todavía no está en la caja.
    if (!ingreso) {
      await assertFondosSuficientesTx(tx, {
        tenantId, vendedorId: null, cuenta, monto,
        mensaje: (disp) => `${concepto.label} de $${monto.toLocaleString("es-AR")} supera el saldo de ${CUENTA_LABEL[cuenta]} en la caja principal (disponible $${disp.toLocaleString("es-AR")}).`,
      });
    }
    const numero = await siguienteNumeroComprobante(tx, tenantId, concepto.serie);
    return tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: concepto.tipo,
        monto: montoConSigno(concepto.tipo, monto, ingreso),
        metodo,
        cuenta,
        origen: ingreso ? concepto.etiqueta : etiquetaCaja(false, cuenta),
        destino: ingreso ? etiquetaCaja(false, cuenta) : concepto.etiqueta,
        serie: concepto.serie,
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
    descripcion: `${concepto.label} (${ingreso ? "ingreso" : "egreso"}) $${monto.toLocaleString("es-AR")} en ${cuenta} — ${mov.descripcion}`,
    meta: { monto: mov.monto, tipo: concepto.tipo, cuenta },
  });

  return successResponse(mov, 201);
});
