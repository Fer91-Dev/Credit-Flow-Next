import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { ApiError } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/audit";
import {
  calcularComisionTotal, comisionDeVenta, normalizarComisionConfig, pctParaCredito,
  round2, etiquetaCaja, type Cuenta, type ComisionConfig,
} from "@/lib/domain";
import { siguienteNumeroComprobante, formatComprobante } from "@/lib/comprobantes";
import { assertFondosSuficientesTx, lockCuentaTx } from "@/lib/caja-fondos";
import { nombreCompleto, hoyComercial } from "@/lib/utils";

/**
 * **Liquidación de comisiones** — calcular lo que se le debe a cada agente por un
 * período y dejar constancia congelada de lo que se le pagó.
 *
 * El problema que resuelve: la comisión se calculaba siempre en vivo, así que bajarle el
 * `comision_pct` a alguien o anular un crédito viejo reescribía cuánto se le había pagado
 * el mes pasado. Acá el número se congela con TODO lo que lo explica (config usada, meta,
 * y el detalle crédito por crédito), y no se vuelve a tocar.
 */

/** Una línea del detalle: por qué cada crédito aportó lo que aportó. */
export interface DetalleCreditoComision {
  credito_id: string;
  numero: number | null;
  cliente: string;
  fecha: string;
  monto: number;
  tipo_credito: string;
  pct: number;
  comision: number;
}

/** Lo que se le debe a un agente por el período consultado. */
export interface FilaComision {
  vendedor_id: string;
  nombre: string;
  comision_pct: number;
  /** false si el agente no tiene ni % base ni config avanzada → nunca va a generar comisión. */
  comision_configurada: boolean;
  monto_otorgado: number;
  creditos_cantidad: number;
  comision_base: number;
  comision_bonus: number;
  comision_total: number;
  meta_monto: number;
  meta_cumplida: boolean;
  /** Período de la meta vigente, si la hay (para explicar por qué el bonus es 0). */
  meta_periodo: string | null;
  /** true si la meta vigente cubre EXACTAMENTE el rango liquidado (condición del bonus). */
  meta_coincide: boolean;
  detalle: DetalleCreditoComision[];
  /** Liquidación ya emitida para este período, si existe. */
  liquidacion: LiquidacionResumen | null;
}

export interface LiquidacionResumen {
  id: string;
  periodo: string;
  fecha_desde: string;
  fecha_hasta: string;
  comision_total: number;
  estado: string;
  comprobante: string | null;
  created_at: string;
  liquidado_por_nombre: string | null;
}

const mismaFecha = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/**
 * Calcula, para cada agente activo, la comisión del rango pedido.
 *
 * **El bonus por meta solo se paga si la meta vigente cubre EXACTAMENTE el rango que se
 * está liquidando.** Si el agente tiene meta anual y se liquida un mes, el bonus no entra
 * en ese mes — si no, se pagaría doce veces el mismo premio. Se paga cuando se liquide el
 * período completo de la meta. `meta_coincide` viaja a la UI para poder explicarlo.
 */
export async function comisionesDelPeriodo(
  tenantId: string,
  rango: { desde: Date; hasta: Date },
  periodoEtiqueta: string,
): Promise<FilaComision[]> {
  // `hasta` es inclusive: se compara contra el día siguiente a las 00:00.
  const hastaExcl = new Date(rango.hasta);
  hastaExcl.setDate(hastaExcl.getDate() + 1);

  const [vendedores, creditos, metasVigentes, liquidaciones] = await Promise.all([
    prisma.vendedores.findMany({
      where: { ...withTenant(tenantId), activo: true },
      orderBy: { nombre: "asc" },
    }),
    // Mismo criterio que la ficha y las listas: sin anulados y sin refinanciaciones
    // (una refinanciación no es plata nueva otorgada → no genera comisión).
    prisma.creditos.findMany({
      where: {
        ...withTenant(tenantId),
        vendedor_id: { not: null },
        estado: { not: "anulado" },
        es_refinanciacion: false,
        created_at: { gte: rango.desde, lt: hastaExcl },
      },
      select: {
        id: true, numero: true, monto_original: true, tipo_credito: true,
        created_at: true, vendedor_id: true,
        cliente: { select: { nombre: true, apellido: true } },
      },
      orderBy: { created_at: "asc" },
    }),
    prisma.metas_vendedor.findMany({
      where: { ...withTenant(tenantId), estado: "vigente" },
      orderBy: { fecha_desde: "desc" },
    }),
    prisma.liquidaciones_comision.findMany({
      where: { ...withTenant(tenantId), periodo: periodoEtiqueta },
    }),
  ]);

  const porVendedor = new Map<string, typeof creditos>();
  for (const c of creditos) {
    if (!c.vendedor_id) continue;
    const arr = porVendedor.get(c.vendedor_id) ?? [];
    arr.push(c);
    porVendedor.set(c.vendedor_id, arr);
  }

  const metaDe = new Map<string, (typeof metasVigentes)[number]>();
  for (const m of metasVigentes) if (!metaDe.has(m.vendedor_id)) metaDe.set(m.vendedor_id, m);

  const liqDe = new Map(liquidaciones.map((l) => [l.vendedor_id, l]));

  // El número de comprobante vive en el movimiento de caja, no en la liquidación: se
  // trae en lote (si no, esta fila mostraría siempre "sin comprobante").
  const movIds = liquidaciones.map((l) => l.movimiento_caja_id).filter(Boolean) as string[];
  const movs = movIds.length
    ? await prisma.movimientos_caja.findMany({
        where: { ...withTenant(tenantId), id: { in: movIds } },
        select: { id: true, serie: true, numero: true },
      })
    : [];
  const compDe = new Map(movs.map((m) => [m.id, formatComprobante(m.serie, m.numero)]));

  return vendedores.map((v) => {
    const creds = porVendedor.get(v.id) ?? [];
    const config = normalizarComisionConfig(v.comision_config, v.comision_pct);
    const monto_otorgado = round2(creds.reduce((s, c) => s + (c.monto_original || 0), 0));

    const meta = metaDe.get(v.id) ?? null;
    const meta_coincide = !!meta && mismaFecha(meta.fecha_desde, rango.desde) && mismaFecha(meta.fecha_hasta, rango.hasta);
    const meta_monto = meta?.meta_monto ?? 0;
    const meta_cumplida = meta_coincide && meta_monto > 0 && monto_otorgado >= meta_monto;

    // La base se calcula SIN bonus y el total CON bonus; la diferencia es el bonus.
    // Así el desglose sale del mismo motor que el número final, sin reimplementarlo.
    const paraMotor = creds.map((c) => ({ monto_original: c.monto_original, tipo_credito: c.tipo_credito }));
    const comision_base = config
      ? calcularComisionTotal(paraMotor, { ...config, base_pct: config.base_pct ?? v.comision_pct }, { metaCumplida: false })
      : comisionDeVenta(monto_otorgado, v.comision_pct);
    const comision_total = config
      ? calcularComisionTotal(paraMotor, { ...config, base_pct: config.base_pct ?? v.comision_pct }, { metaCumplida: meta_cumplida })
      : comision_base;

    const detalle: DetalleCreditoComision[] = creds.map((c) => {
      const pct = config
        ? pctParaCredito(c.tipo_credito ?? "otro", { ...config, base_pct: config.base_pct ?? v.comision_pct }, monto_otorgado)
        : v.comision_pct;
      return {
        credito_id: c.id,
        numero: c.numero,
        cliente: c.cliente ? nombreCompleto(c.cliente) : "—",
        fecha: c.created_at.toISOString(),
        monto: c.monto_original,
        tipo_credito: c.tipo_credito,
        pct,
        comision: round2(((c.monto_original || 0) * pct) / 100),
      };
    });

    const l = liqDe.get(v.id) ?? null;

    return {
      vendedor_id: v.id,
      nombre: v.nombre,
      comision_pct: v.comision_pct,
      comision_configurada: v.comision_pct > 0 || config != null,
      monto_otorgado,
      creditos_cantidad: creds.length,
      comision_base,
      comision_bonus: round2(comision_total - comision_base),
      comision_total,
      meta_monto,
      meta_cumplida,
      meta_periodo: meta?.periodo ?? null,
      meta_coincide,
      detalle,
      liquidacion: l
        ? resumirLiquidacion(l, l.movimiento_caja_id ? compDe.get(l.movimiento_caja_id) ?? null : null)
        : null,
    };
  });
}

type LiquidacionRow = {
  id: string; periodo: string; fecha_desde: Date; fecha_hasta: Date;
  comision_total: number; estado: string; created_at: Date;
  liquidado_por_nombre: string | null;
  movimiento_caja_id: string | null;
};

function resumirLiquidacion(l: LiquidacionRow, comprobante: string | null): LiquidacionResumen {
  return {
    id: l.id,
    periodo: l.periodo,
    fecha_desde: l.fecha_desde.toISOString(),
    fecha_hasta: l.fecha_hasta.toISOString(),
    comision_total: l.comision_total,
    estado: l.estado,
    comprobante,
    created_at: l.created_at.toISOString(),
    liquidado_por_nombre: l.liquidado_por_nombre,
  };
}

/**
 * Emite la liquidación de un agente: congela el cálculo y saca la plata de la **caja
 * principal** (tesorería paga; no de la caja personal del vendedor).
 *
 * Todo en UNA transacción — si el egreso de caja falla por fondos, no queda una
 * liquidación fantasma diciendo que se pagó algo que no salió de ningún lado.
 */
export async function liquidarComision(opts: {
  tenantId: string;
  vendedorId: string;
  rango: { desde: Date; hasta: Date };
  periodo: string;
  cuenta: Cuenta;
  notas?: string | null;
  actorId: string;
  actorNombre: string;
}) {
  const { tenantId, vendedorId, rango, periodo, cuenta } = opts;

  const filas = await comisionesDelPeriodo(tenantId, rango, periodo);
  const fila = filas.find((f) => f.vendedor_id === vendedorId);
  if (!fila) throw new ApiError("Agente no encontrado o inactivo", "NOT_FOUND", 404);
  if (fila.comision_total <= 0) {
    throw new ApiError("No hay comisión para liquidar en este período", "SIN_COMISION", 400);
  }

  const vendedor = await prisma.vendedores.findFirst({ where: { ...withTenant(tenantId), id: vendedorId } });
  if (!vendedor) throw new ApiError("Agente no encontrado", "NOT_FOUND", 404);

  const total = round2(fila.comision_total);

  const creada = await prisma.$transaction(async (tx) => {
    // Candado anti doble pago. Va DENTRO de la transacción y bajo advisory lock por
    // (tenant, agente): chequear afuera dejaba una ventana para que dos liquidaciones
    // simultáneas pasaran las dos. Mismo patrón que la numeración de comprobantes.
    //
    // Las ANULADAS se ignoran a propósito: anular existe justamente para poder rehacer.
    // Se compara por RANGO y no por etiqueta de período, así también atrapa "01/07 al
    // 15/07" contra un "2026-07" ya liquidado.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`liq:${tenantId}:${vendedorId}`}, 0))`;
    const solapada = await tx.liquidaciones_comision.findFirst({
      where: {
        ...withTenant(tenantId),
        vendedor_id: vendedorId,
        estado: { not: "anulada" },
        fecha_desde: { lte: rango.hasta },
        fecha_hasta: { gte: rango.desde },
      },
    });
    if (solapada) {
      throw new ApiError(
        `${vendedor.nombre} ya tiene liquidado el período ${solapada.periodo}, que cubre esas fechas. Anulá esa liquidación si querés rehacerla.`,
        "LIQUIDACION_SOLAPADA",
        409,
      );
    }

    // La comisión sale de la CAJA PRINCIPAL (vendedor_id: null).
    await assertFondosSuficientesTx(tx, {
      tenantId, vendedorId: null, cuenta, monto: total,
      mensaje: (disp) =>
        `No hay saldo en ${cuenta} para pagar la comisión de ${vendedor.nombre} (disponible $${disp.toLocaleString("es-AR")}, hacen falta $${total.toLocaleString("es-AR")}).`,
    });

    const numero = await siguienteNumeroComprobante(tx, tenantId, "LIQ");
    const mov = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha: hoyComercial(),
        tipo: "comision",
        monto: -total, // egreso
        cuenta,
        vendedor_id: null, // sale de tesorería, no de la caja del vendedor
        origen: etiquetaCaja(false, cuenta),
        destino: `Comisión ${vendedor.nombre} · ${periodo}`,
        serie: "LIQ",
        numero,
        descripcion: `Liquidación de comisión ${periodo} — ${vendedor.nombre}`,
      },
    });

    return tx.liquidaciones_comision.create({
      data: {
        ...withTenant(tenantId),
        vendedor_id: vendedorId,
        periodo,
        fecha_desde: rango.desde,
        fecha_hasta: rango.hasta,
        monto_otorgado: fila.monto_otorgado,
        creditos_cantidad: fila.creditos_cantidad,
        comision_base: fila.comision_base,
        comision_bonus: fila.comision_bonus,
        comision_total: total,
        meta_monto: fila.meta_monto,
        meta_cumplida: fila.meta_cumplida,
        comision_pct_snapshot: vendedor.comision_pct,
        comision_config_snapshot: (vendedor.comision_config ?? undefined) as never,
        detalle: fila.detalle as never,
        estado: "pagada",
        movimiento_caja_id: mov.id,
        cuenta,
        liquidado_por: opts.actorId,
        liquidado_por_nombre: opts.actorNombre,
        notas: opts.notas?.trim() || null,
      },
    });
  });

  await registrarAuditoria({
    tenantId,
    entidad: "vendedores",
    entidadId: vendedorId,
    accion: "crear",
    descripcion: `Comisión ${periodo} liquidada a ${vendedor.nombre}: $${total.toLocaleString("es-AR")}`,
    meta: { liquidacion_id: creada.id, periodo, total, cuenta },
  });

  return creada;
}

/**
 * Anula una liquidación y **revierte el egreso** con un movimiento de signo opuesto
 * (no se borra el original: el libro de caja es append-only, igual que al anular un
 * crédito). La liquidación queda como registro histórico marcada `anulada`.
 */
export async function anularLiquidacion(opts: {
  tenantId: string;
  id: string;
  motivo: string;
  actorNombre: string;
}) {
  const { tenantId, id } = opts;
  const motivo = opts.motivo.trim();
  if (!motivo) throw new ApiError("Indicá el motivo de la anulación", "INVALID_INPUT", 400);

  const liq = await prisma.liquidaciones_comision.findFirst({
    where: { ...withTenant(tenantId), id },
    include: { vendedor: { select: { nombre: true } } },
  });
  if (!liq) throw new ApiError("Liquidación no encontrada", "NOT_FOUND", 404);
  if (liq.estado === "anulada") throw new ApiError("La liquidación ya está anulada", "YA_ANULADA", 409);

  await prisma.$transaction(async (tx) => {
    /**
     * 🔴 Marcar PRIMERO, y condicionado al estado esperado.
     *
     * El chequeo `liq.estado === "anulada"` corre fuera de la transacción y el update estaba
     * al final: dos anulaciones simultáneas de la misma liquidación pasaban las dos y creaban
     * DOS asientos de comisión de vuelta a la caja principal — la financiera recuperaba dos
     * veces plata que pagó una sola.
     */
    const marcada = await tx.liquidaciones_comision.updateMany({
      where: { ...withTenant(tenantId), id, estado: { not: "anulada" } },
      data: { estado: "anulada", anulada_en: new Date(), anulada_motivo: motivo },
    });
    if (marcada.count === 0) {
      throw new ApiError("Esa liquidación ya fue anulada por otra operación.", "YA_ANULADA", 409);
    }

    if (liq.movimiento_caja_id) {
      await lockCuentaTx(tx, tenantId, null, liq.cuenta as Cuenta);
      const numero = await siguienteNumeroComprobante(tx, tenantId, "LIQ");
      await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: hoyComercial(),
          tipo: "comision",
          monto: round2(liq.comision_total), // ingreso: devuelve la plata a la caja
          cuenta: liq.cuenta,
          vendedor_id: null,
          origen: `Anulación comisión ${liq.vendedor.nombre} · ${liq.periodo}`,
          destino: etiquetaCaja(false, liq.cuenta),
          serie: "LIQ",
          numero,
          descripcion: `Anulación de liquidación ${liq.periodo} — ${liq.vendedor.nombre}: ${motivo}`,
        },
      });
    }
    // (el marcado como "anulada" ya ocurrió arriba: es el que gana la carrera)
  });

  await registrarAuditoria({
    tenantId,
    entidad: "vendedores",
    entidadId: liq.vendedor_id,
    accion: "anular",
    descripcion: `Liquidación ${liq.periodo} de ${liq.vendedor.nombre} anulada: ${motivo}`,
    meta: { liquidacion_id: id, motivo, total: liq.comision_total },
  });
}

/** Historial de liquidaciones de un agente (o de todos si `vendedorId` es null). */
export async function historialLiquidaciones(tenantId: string, vendedorId: string | null) {
  const rows = await prisma.liquidaciones_comision.findMany({
    where: { ...withTenant(tenantId), ...(vendedorId ? { vendedor_id: vendedorId } : {}) },
    include: { vendedor: { select: { nombre: true } } },
    orderBy: [{ fecha_desde: "desc" }, { created_at: "desc" }],
    take: 200,
  });

  // El comprobante vive en el movimiento de caja; se trae en lote para no hacer N queries.
  const movIds = rows.map((r) => r.movimiento_caja_id).filter(Boolean) as string[];
  const movs = movIds.length
    ? await prisma.movimientos_caja.findMany({
        where: { ...withTenant(tenantId), id: { in: movIds } },
        select: { id: true, serie: true, numero: true },
      })
    : [];
  const compDe = new Map(movs.map((m) => [m.id, formatComprobante(m.serie, m.numero)]));

  return rows.map((l) => ({
    id: l.id,
    vendedor_id: l.vendedor_id,
    vendedor_nombre: l.vendedor.nombre,
    periodo: l.periodo,
    fecha_desde: l.fecha_desde.toISOString(),
    fecha_hasta: l.fecha_hasta.toISOString(),
    monto_otorgado: l.monto_otorgado,
    creditos_cantidad: l.creditos_cantidad,
    comision_base: l.comision_base,
    comision_bonus: l.comision_bonus,
    comision_total: l.comision_total,
    meta_monto: l.meta_monto,
    meta_cumplida: l.meta_cumplida,
    comision_pct_snapshot: l.comision_pct_snapshot,
    detalle: l.detalle as unknown as DetalleCreditoComision[],
    estado: l.estado,
    cuenta: l.cuenta,
    comprobante: l.movimiento_caja_id ? compDe.get(l.movimiento_caja_id) ?? null : null,
    liquidado_por_nombre: l.liquidado_por_nombre,
    notas: l.notas,
    anulada_motivo: l.anulada_motivo,
    created_at: l.created_at.toISOString(),
  }));
}

export type LiquidacionDetallada = Awaited<ReturnType<typeof historialLiquidaciones>>[number];
export type { ComisionConfig };
