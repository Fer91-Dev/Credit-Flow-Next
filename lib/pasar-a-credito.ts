/**
 * PASAR A CRÉDITO — convierte un crédito vivo del historial de un cliente migrado en un
 * crédito real del sistema. ÚNICO camino: lo usan el botón de la ficha
 * (`POST /api/clientes/[id]/pasar-a-credito`) y la carga por script (`scripts/pasar-a-credito.mjs`).
 *
 * Qué NO hace, a propósito:
 *  - No mueve caja: la plata salió en el sistema anterior y lo ya cobrado entró ahí.
 *  - No pasa por el motor de riesgo ni por los rangos de tasa/plazo del simulador: no es una
 *    originación, es una deuda que ya existe.
 *  - No cuenta como otorgado (comisiones, metas, "monto otorgado"): `migrado = true`.
 *
 * Lo que sí: cartera y mora reales desde la próxima cuota, cobro normal (a la caja de quien
 * cobra), y la fila del historial queda marcada con el crédito para que no se pase dos veces.
 */
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { ApiError } from "@/lib/auth";
import { lockNumeroCreditoTx, TX_PLATA } from "@/lib/locks";
import { getConfiguracion } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import {
  armarPaseMigrado, planACuotas, normalizarFrecuencia, resolverFrecuencia, FRECUENCIAS_BUILTIN,
  diasMoraActual, formatPesos, CARGOS_APAGADOS, REDONDEO_MIGRADO, CRONOGRAMA_MIGRADO,
} from "@/lib/domain";
import type { HistorialMigrado } from "@/lib/swr";
import type { Prisma } from "@prisma/client";

/** Marca que deja el pase en la fila del historial. */
export interface MarcaPase {
  credito_id: string;
  credito_numero: number;
  pasado_el: string;
}

export interface EntradaPase {
  tenantId: string;
  clienteId: string;
  /** Posición de la fila en `historial_migrado.historial`. */
  indice: number;
  /**
   * Lo que el operador VIO en esa fila. Si el historial se editó mientras tanto y la fila ya no
   * es la misma, se rechaza en vez de marcar otra.
   */
  esperado: { descripcion: string; monto: number; cuota: number };
  datos: {
    monto: number;
    cuota: number;
    cuotasTotales: number;
    cuotasPagadas: number;
    /** "YYYY-MM-DD" */
    fechaOtorgamiento: string;
    /** "YYYY-MM-DD" */
    proximaCuota: string;
    frecuencia: string;
  };
  actor: { userId: string | null; nombre: string | null };
  origen: "pantalla" | "script";
  /** Texto libre para la auditoría (el script pone de quién fue el pedido). */
  nota?: string;
}

const fechaYmd = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(NaN));

type FilaHistorial = HistorialMigrado["historial"][number] & Partial<MarcaPase>;

export async function pasarACredito(e: EntradaPase): Promise<{ id: string; numero: number }> {
  const { tenantId } = e;
  const config = await getConfiguracion(tenantId);
  const catalogo = config.simulador.frecuencias;

  const frecuencia = normalizarFrecuencia(e.datos.frecuencia);
  // `resolverFrecuencia` cae en mensual ante una clave desconocida; acá eso sería cobrar en
  // otro ritmo del que se eligió, así que la clave tiene que existir.
  if (!FRECUENCIAS_BUILTIN[frecuencia] && !catalogo.some((f) => f.clave === frecuencia)) {
    throw new ApiError("La frecuencia elegida no existe en la configuración.", "INVALID_INPUT", 400);
  }

  const hoy = hoyComercial();
  let pase;
  try {
    pase = armarPaseMigrado(
      {
        monto: Number(e.datos.monto),
        cuota: Number(e.datos.cuota),
        cuotasTotales: Math.trunc(Number(e.datos.cuotasTotales)),
        cuotasPagadas: Math.trunc(Number(e.datos.cuotasPagadas)),
        fechaOtorgamiento: fechaYmd(e.datos.fechaOtorgamiento),
        proximaCuota: fechaYmd(e.datos.proximaCuota),
        frecuencia,
      },
      hoy, config.convencionTasa, catalogo,
    );
  } catch (err) {
    throw new ApiError((err as Error).message, "INVALID_INPUT", 400);
  }

  const fechaOtorgamiento = fechaYmd(e.datos.fechaOtorgamiento);
  const proximoPago = pase.pendientes[0].fecha;
  const diasMora = diasMoraActual(proximoPago, hoy);

  const cronograma = {
    ...CRONOGRAMA_MIGRADO,
    // Gracia y mora: las de HOY, congeladas como en cualquier crédito. La deuda corre desde
    // la próxima cuota con las reglas vigentes al pasarla.
    diasGracia: config.simulador.diasGracia,
    mora: { activa: config.moraActiva, tasaDiaria: config.tasaMoraDiaria, topePct: config.topeMoraPct },
    redondeo: REDONDEO_MIGRADO,
    convencion: config.convencionTasa,
    migracion: pase.migracion,
  };

  const credito = await prisma.$transaction(async (tx) => {
    // Lock de la fila del cliente: dos pases simultáneos de la misma fila (doble clic, o el
    // botón y el script a la vez) leerían el historial sin marca y crearían dos créditos.
    await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${e.clienteId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
    const cliente = await tx.clientes.findFirst({
      where: { ...withTenant(tenantId), id: e.clienteId },
      select: { id: true, nombre: true, apellido: true, estado: true, migrado: true, historial_migrado: true },
    });
    if (!cliente) throw new ApiError("Cliente no encontrado", "NOT_FOUND", 404);
    if (!cliente.migrado || !cliente.historial_migrado) {
      throw new ApiError("Este cliente no tiene historial del sistema anterior.", "INVALID_STATE", 409);
    }
    if (cliente.estado === "inactivo") {
      throw new ApiError("El cliente está dado de baja. Reactivalo antes de pasarle el crédito.", "CLIENTE_INACTIVO", 409);
    }
    const historial = cliente.historial_migrado as unknown as HistorialMigrado;
    const fila = historial.historial?.[e.indice] as FilaHistorial | undefined;
    if (
      !fila ||
      fila.descripcion !== e.esperado.descripcion ||
      Number(fila.monto) !== Number(e.esperado.monto) ||
      Number(fila.cuota) !== Number(e.esperado.cuota)
    ) {
      throw new ApiError("El historial cambió mientras tanto. Recargá la ficha y volvé a intentar.", "HISTORIAL_CAMBIO", 409);
    }
    if (fila.credito_id) {
      throw new ApiError(
        `Esta fila ya se pasó a crédito (${formatCreditoNumero(fila.credito_numero ?? null)}).`,
        "YA_PASADO", 409,
      );
    }

    await lockNumeroCreditoTx(tx, tenantId);
    const maxNum = await tx.creditos.aggregate({ where: { ...withTenant(tenantId) }, _max: { numero: true } });
    const numero = (maxNum._max.numero ?? 0) + 1;

    const c = await tx.creditos.create({
      data: {
        ...withTenant(tenantId),
        numero,
        cliente_id: cliente.id,
        tipo_credito: "personal",
        monto_original: Number(e.datos.monto),
        saldo_pendiente: pase.saldoCapital,
        tasa: pase.tasa,
        plazo_meses: Math.trunc(Number(e.datos.cuotasTotales)),
        frecuencia,
        frecuencia_def: resolverFrecuencia(frecuencia, catalogo) as object,
        cargos: CARGOS_APAGADOS as object,
        cronograma: cronograma as object,
        fecha_inicio: fechaOtorgamiento,
        proximo_pago: proximoPago,
        dias_mora: diasMora,
        estado: diasMora > 0 ? "vencido" : "activo",
        vendedor_id: null,
        otorgado_por: e.actor.userId,
        otorgado_por_nombre: e.origen === "script" ? "Migración por script" : e.actor.nombre?.trim() || null,
        migrado: true,
      },
    });

    // Solo las cuotas que faltan, con su número real (la 3 de 6 sigue siendo la 3).
    await tx.cuotas.createMany({
      data: planACuotas({ ...pase.plan, cuotas: pase.pendientes }).map((f) => ({
        ...withTenant(tenantId),
        credito_id: c.id,
        nro: f.nro,
        fecha_vencimiento: f.fecha_vencimiento,
        saldo_inicial: f.saldo_inicial,
        capital: f.capital,
        interes: f.interes,
        iva: f.iva,
        seguro: f.seguro,
        gastos: f.gastos,
        honorarios: f.honorarios,
        cuota_total: f.cuota_total,
      })),
    });

    const marca: MarcaPase = { credito_id: c.id, credito_numero: numero, pasado_el: hoy.toISOString().slice(0, 10) };
    const nuevoHistorial = {
      ...historial,
      historial: historial.historial.map((f, i) => (i === e.indice ? { ...f, ...marca } : f)),
    };
    await tx.clientes.update({
      where: { id: cliente.id },
      data: { historial_migrado: nuevoHistorial as object },
    });

    return { id: c.id, numero, cliente };
  }, TX_PLATA);

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: credito.id,
    accion: "crear",
    descripcion:
      `Crédito ${formatCreditoNumero(credito.numero)} pasado desde el historial previo de ${nombreCompleto(credito.cliente)}` +
      ` — ${pase.pendientes.length} cuotas de ${formatPesos(pase.migracion.cuota)}` +
      (e.origen === "script" ? ` (migración por script${e.nota ? `: ${e.nota}` : ""})` : ""),
    meta: {
      numero: credito.numero,
      migrado: true,
      origen: e.origen,
      fila_historial: e.indice,
      descripcion_planilla: e.esperado.descripcion,
      monto: Number(e.datos.monto),
      cuota: pase.migracion.cuota,
      cuotas_totales: Math.trunc(Number(e.datos.cuotasTotales)),
      cuotas_pagadas: pase.migracion.cuotasPagadas,
      fecha_otorgamiento: e.datos.fechaOtorgamiento,
      proxima_cuota: pase.migracion.proximaCuota,
      frecuencia,
      tasa_despejada: pase.tasa,
      saldo_capital: pase.saldoCapital,
      total_a_cobrar: pase.totalACobrar,
      ...(e.nota ? { nota: e.nota } : {}),
    },
  });

  return { id: credito.id, numero: credito.numero };
}

/**
 * Libera la fila del historial cuando el crédito pasado se ANULA o se ELIMINA: la marca existe
 * para no pasar dos veces la misma deuda, y sin el crédito vivo la fila tiene que poder volver a
 * pasarse (corregida). Va dentro de la transacción de la anulación/eliminación.
 */
export async function desmarcarFilaHistorialTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  credito: { id: string; cliente_id: string; migrado: boolean },
): Promise<void> {
  if (!credito.migrado) return;
  const cli = await tx.clientes.findFirst({
    where: { ...withTenant(tenantId), id: credito.cliente_id },
    select: { id: true, historial_migrado: true },
  });
  const h = cli?.historial_migrado as unknown as HistorialMigrado | null;
  if (!cli || !h?.historial?.some((f: FilaHistorial) => f.credito_id === credito.id)) return;
  await tx.clientes.update({
    where: { id: cli.id },
    data: {
      historial_migrado: {
        ...h,
        historial: h.historial.map((f: FilaHistorial) => {
          if (f.credito_id !== credito.id) return f;
          const { credito_id: _a, credito_numero: _b, pasado_el: _c, ...resto } = f;
          return resto;
        }),
      } as object,
    },
  });
}
