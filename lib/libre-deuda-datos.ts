/**
 * Los datos del certificado de libre deuda. UNA sola consulta.
 *
 * Vivía dentro del Route Handler que devuelve el JSON. Al sumarse la descarga en PDF hacían
 * falta los mismos datos en otra ruta, y copiarlos habría dejado dos consultas para el mismo
 * papel: el día que una cambie —qué pagos cuentan, cómo se arma el desglose— la pantalla y el
 * PDF empiezan a decir cosas distintas sobre la misma operación.
 *
 * Server-only (toca Prisma). El texto del certificado vive aparte, en `libre-deuda-texto.ts`,
 * porque ese sí lo necesita el cliente.
 */
import { scopeCreditosVendedor, type AuthContext } from "@/lib/auth";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { round2 } from "@/lib/domain";
import { nombreCompleto } from "@/lib/utils";

/** Motivo por el que no se puede emitir, para que cada ruta arme su propia respuesta. */
export type LibreDeudaError = "NOT_FOUND" | "NOT_CANCELLED";

export interface DatosLibreDeuda {
  empresa: string;
  emitido_en: Date;
  cliente: { nombre: string; documento: string | null };
  credito: {
    numero: number | null;
    tipo: string;
    monto_original: number;
    tasa: number;
    plazo_meses: number;
    frecuencia: string;
    fecha_otorgamiento: Date;
    refinancia_a_numero: number | null;
  };
  totales: {
    total_pagado: number;
    capital: number;
    interes: number;
    mora: number;
    cargos: number;
    pagos: number;
    cuotas: number;
    fecha_cancelacion: Date | null;
  };
}

/**
 * Reúne el certificado de un crédito CANCELADO.
 *
 * Devuelve `{ error }` en vez de tirar, porque las dos rutas que lo usan responden distinto:
 * la de JSON con `errorResponse`, la del PDF con un `Response` a secas.
 */
export async function datosLibreDeuda(
  ctx: Pick<AuthContext, "tenantId" | "role" | "vendedorId">,
  creditoId: string,
): Promise<{ datos: DatosLibreDeuda | null; error: LibreDeudaError | null }> {
  const { tenantId, role, vendedorId } = ctx;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id: creditoId },
    select: {
      id: true, numero: true, tipo_credito: true, monto_original: true, tasa: true,
      plazo_meses: true, frecuencia: true, fecha_inicio: true, created_at: true, estado: true,
      es_refinanciacion: true, refinancia_a: true,
      cliente: { select: { nombre: true, apellido: true, documento: true } },
    },
  });

  if (!credito) return { datos: null, error: "NOT_FOUND" };
  // El certificado nombra el crédito como lo ve el operador: REF-XXXXXX si es una refi.
  const [{ refinancia_a_numero: origenNum }] = await conNumeroDeOrigen(tenantId, [credito]);
  if (credito.estado !== "pagado") return { datos: null, error: "NOT_CANCELLED" };

  const [tenant, pagos, cuotas] = await Promise.all([
    prisma.tenants.findUnique({ where: { id: tenantId }, select: { nombre: true } }),
    // Con la imputación: un certificado que dice "pagó $X" y nada más no deja verificar de
    // dónde sale ese número, y es un papel que el cliente guarda como prueba.
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), credito_id: creditoId, anulado: false },
      select: {
        monto: true, created_at: true,
        aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true,
      },
    }),
    prisma.cuotas.count({ where: { ...withTenant(tenantId), credito_id: creditoId } }),
  ]);

  const total_pagado = round2(pagos.reduce((s, p) => s + p.monto, 0));
  /**
   * De qué se compone lo que pagó. El certificado decía un total pelado, así que no había
   * forma de verificarlo ni de explicarle al cliente por qué pagó más que el capital que se
   * llevó: la diferencia es el interés pactado (que es la ganancia) y los punitorios.
   */
  const desglose = {
    capital: round2(pagos.reduce((s, p) => s + p.aplicado_capital, 0)),
    interes: round2(pagos.reduce((s, p) => s + p.aplicado_interes, 0)),
    mora: round2(pagos.reduce((s, p) => s + p.aplicado_mora, 0)),
    cargos: round2(pagos.reduce((s, p) => s + p.aplicado_cargos, 0)),
    pagos: pagos.length,
  };
  const fecha_cancelacion = pagos.reduce<Date | null>(
    (acc, p) => (acc && acc > p.created_at ? acc : p.created_at),
    null,
  );

  return {
    error: null,
    datos: {
      empresa: tenant?.nombre ?? "—",
      emitido_en: new Date(),
      cliente: {
        nombre: nombreCompleto(credito.cliente),
        documento: credito.cliente?.documento ?? null,
      },
      credito: {
        numero: credito.numero,
        tipo: credito.tipo_credito,
        monto_original: credito.monto_original,
        tasa: credito.tasa,
        plazo_meses: credito.plazo_meses,
        frecuencia: credito.frecuencia,
        fecha_otorgamiento: credito.fecha_inicio ?? credito.created_at,
        refinancia_a_numero: origenNum ?? null,
      },
      totales: { total_pagado, ...desglose, cuotas, fecha_cancelacion },
    },
  };
}
