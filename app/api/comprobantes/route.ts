import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { esCuentaValida, type Cuenta } from "@/lib/domain";
import { formatComprobante, SERIE_RECIBO_PREVIO } from "@/lib/comprobantes";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import { nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/comprobantes  (admin + vendedor)
 * Registro de comprobantes de caja (movimientos numerados). El admin ve TODO
 * (principal + cajas de todos los vendedores); el vendedor ve SOLO su caja
 * (scoping anti-IDOR por `vendedor_id`). Solo lectura (no hay borrado acá).
 * Filtros: q (texto), serie, cuenta, rango de fechas.
 *
 * Suma los recibos de lo cobrado antes del sistema (serie RPA, `recibos_previos`) para que se
 * puedan encontrar y reimprimir. No son caja: un filtro de cuenta los deja afuera, y el vendedor
 * no los ve (no son de su caja). Se ordenan por la fecha del pago, no por cuándo se generaron.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const serie = url.searchParams.get("serie") || "";
  const cuentaParam = url.searchParams.get("cuenta");
  const desdeStr = url.searchParams.get("desde");
  const hastaStr = url.searchParams.get("hasta");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  // Solo movimientos con comprobante (numerados). El vendedor queda scopeado a su caja
  // (movimientos_caja.vendedor_id = el suyo); el admin ve todas.
  const where: Prisma.movimientos_cajaWhereInput = {
    ...withTenant(tenantId),
    ...scopeCreditosVendedor({ role, vendedorId }),
    numero: { not: null },
  };
  if (serie) where.serie = serie;
  if (esCuentaValida(cuentaParam)) where.cuenta = cuentaParam as Cuenta;
  if (desdeStr || hastaStr) {
    where.fecha = {};
    if (desdeStr) (where.fecha as Prisma.DateTimeFilter).gte = new Date(`${desdeStr}T00:00:00.000Z`);
    if (hastaStr) (where.fecha as Prisma.DateTimeFilter).lte = new Date(`${hastaStr}T23:59:59.999Z`);
  }
  if (q) {
    const or: Prisma.movimientos_cajaWhereInput[] = [
      { descripcion: { contains: q, mode: "insensitive" } },
      { origen: { contains: q, mode: "insensitive" } },
      { destino: { contains: q, mode: "insensitive" } },
    ];
    const num = parseInt(q.replace(/\D/g, ""));
    if (!Number.isNaN(num)) or.push({ numero: num });
    where.OR = or;
  }

  // Recibos previos: solo admin, sin filtro de cuenta, y con la serie vacía o la suya.
  const conPrevios = role === "admin" && !esCuentaValida(cuentaParam) && (!serie || serie === SERIE_RECIBO_PREVIO);
  const conCaja = serie !== SERIE_RECIBO_PREVIO;
  const wherePrev: Prisma.recibos_previosWhereInput = { ...withTenant(tenantId) };
  if (desdeStr || hastaStr) {
    wherePrev.fecha = {};
    if (desdeStr) wherePrev.fecha.gte = new Date(`${desdeStr}T00:00:00.000Z`);
    if (hastaStr) wherePrev.fecha.lte = new Date(`${hastaStr}T23:59:59.999Z`);
  }
  if (q) {
    const or: Prisma.recibos_previosWhereInput[] = [
      { credito: { cliente: { nombre: { contains: q, mode: "insensitive" } } } },
      { credito: { cliente: { apellido: { contains: q, mode: "insensitive" } } } },
    ];
    const num = parseInt(q.replace(/\D/g, ""));
    if (!Number.isNaN(num)) or.push({ numero: num }, { credito: { numero: num } });
    wherePrev.OR = or;
  }
  // Dos fuentes con una sola página: de cada una se traen las primeras `offset + limit`, se
  // mezclan por fecha y se corta. Los previos son pocos (uno por cuota cobrada antes).
  const tope = offset + limit;
  const [movs, totalCaja, previos, totalPrevios] = await Promise.all([
    prisma.movimientos_caja.findMany({
      where,
      include: {
        credito: { select: { numero: true, es_refinanciacion: true, refinancia_a: true, cliente: { select: { nombre: true, apellido: true } } } },
        vendedor: { select: { nombre: true } },
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: conCaja ? (conPrevios ? tope : limit) : 0,
      skip: conPrevios ? 0 : offset,
    }),
    conCaja ? prisma.movimientos_caja.count({ where }) : Promise.resolve(0),
    conPrevios
      ? prisma.recibos_previos.findMany({
          where: wherePrev,
          include: { credito: { select: { id: true, numero: true, cliente: { select: { nombre: true, apellido: true } } } } },
          orderBy: [{ fecha: "desc" }, { numero: "desc" }],
          take: conCaja ? tope : limit,
          skip: conCaja ? 0 : offset,
        })
      : Promise.resolve([]),
    conPrevios ? prisma.recibos_previos.count({ where: wherePrev }) : Promise.resolve(0),
  ]);
  const total = totalCaja + totalPrevios;

  // Mismo criterio que la caja: si el movimiento es de una refinanciación, dice REF-.
  const origenesRefi = await numerosRefinanciados(tenantId, movs.map((m) => m.credito).filter((c) => c != null));

  const comprobantes = movs.map((m) => ({
    id: m.id,
    comprobante: formatComprobante(m.serie, m.numero),
    serie: m.serie,
    fecha: m.fecha,
    created_at: m.created_at,
    tipo: m.tipo,
    monto: m.monto,
    metodo: m.metodo,
    cuenta: m.cuenta,
    origen: m.origen,
    destino: m.destino,
    descripcion: m.descripcion,
    credito_numero: m.credito?.numero ?? null,
    credito_refinancia_a_numero: m.credito?.es_refinanciacion && m.credito.refinancia_a ? origenesRefi.get(m.credito.refinancia_a) ?? null : null,
    cliente: m.credito?.cliente ? nombreCompleto(m.credito.cliente) : null,
    vendedor: m.vendedor?.nombre ?? null, // null = caja principal
  }));

  const deCajaYPrevios = [
    ...comprobantes.map((c) => ({ c, orden: c.created_at.getTime() })),
    ...previos.map((r) => {
      const cliente = nombreCompleto(r.credito.cliente);
      return {
        orden: r.fecha.getTime(),
        c: {
          id: r.id,
          comprobante: formatComprobante(SERIE_RECIBO_PREVIO, r.numero),
          serie: SERIE_RECIBO_PREVIO,
          fecha: r.fecha,
          created_at: r.created_at,
          tipo: "recibo_previo" as const,
          monto: r.monto,
          metodo: null,
          cuenta: null,
          origen: cliente,
          destino: null,
          descripcion: `Cobro de ${(r.cuotas as { nro: number }[]).map((x) => `cuota ${x.nro}`).join(", ")}`,
          credito_id: r.credito.id,
          credito_numero: r.credito.numero,
          credito_refinancia_a_numero: null,
          cliente,
          vendedor: null,
        },
      };
    }),
  ];
  // Con una sola fuente la base ya paginó; con las dos se pagina acá, después de mezclar.
  const pagina = conPrevios && conCaja
    ? deCajaYPrevios.sort((a, b) => b.orden - a.orden).slice(offset, tope).map((x) => x.c)
    : deCajaYPrevios.map((x) => x.c);

  return successResponse({ comprobantes: pagina, total, limit, offset });
});
