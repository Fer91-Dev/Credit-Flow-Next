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
import { round2, anteriorDelCredito, imputarParcialAnterior } from "@/lib/domain";
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
    /**
     * Lo PERDONADO en el camino: la quita de un acuerdo cumplido, o lo resignado al cerrar un
     * caso incobrable. Sin este número el certificado no cierra — ver abajo.
     */
    condonado: number;
    pagos: number;
    /** Cuotas pagadas ANTES del sistema (crédito anterior): saldadas sin pago ni recibo. */
    cuotas_antes: number;
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
      es_refinanciacion: true, refinancia_a: true, cronograma: true,
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
    prisma.cuotas.findMany({
      where: { ...withTenant(tenantId), credito_id: creditoId },
      select: { nro: true, capital: true, interes: true, condonado: true, pagado_capital: true, pagado_interes: true, pagado_cargos: true },
    }),
  ]);

  /*
    Crédito ANTERIOR AL SISTEMA: las cuotas que pagó antes no tienen pago (la plata entró a la
    caja vieja) pero están saldadas en `cuotas`. Sin sumarlas, el certificado de alguien que
    canceló todo antes de la carga decía "abonó $0,00".
  */
  const anterior = anteriorDelCredito(credito.cronograma);
  const nrosAntes = new Set((anterior?.pagos ?? []).map((p) => p.nro));
  const antes = cuotas.filter((q) => nrosAntes.has(q.nro));
  // La cuota que quedó A MEDIAS antes del sistema: su `pagado_*` mezcla lo de antes con lo cobrado
  // después (que ya está en `pagos`), así que lo de antes se recalcula con la misma imputación.
  const cuotaParcial = anterior?.parcial ? cuotas.find((q) => q.nro === anterior.parcial!.nro) : undefined;
  const parcialAntes = cuotaParcial && anterior?.parcial
    ? imputarParcialAnterior(cuotaParcial, anterior.parcial.monto)
    : { capital: 0, interes: 0 };
  const antesCapital = round2(antes.reduce((s, q) => s + q.pagado_capital, 0) + parcialAntes.capital);
  const antesInteres = round2(antes.reduce((s, q) => s + q.pagado_interes, 0) + parcialAntes.interes);
  const antesCargos = round2(antes.reduce((s, q) => s + q.pagado_cargos, 0));
  const total_pagado = round2(pagos.reduce((s, p) => s + p.monto, 0) + antesCapital + antesInteres + antesCargos);
  /**
   * 🔴 LO CONDONADO TIENE QUE ESTAR, O EL CERTIFICADO NO CIERRA.
   *
   * El papel dice "capital otorgado $300.000,00" arriba y "Capital $299.990,00" en el
   * desglose, porque el desglose suma lo IMPUTADO y esos $10,00 no se pagaron: se
   * condonaron al cumplirse el acuerdo (eran la quita). Sin decirlo, el certificado tiene
   * diez pesos sin explicación en un documento que certifica cancelación total — y con una
   * quita de verdad son decenas de miles.
   *
   * No es plata que entró, así que NO se suma al total abonado: va nombrada aparte, que es
   * el mismo criterio con el que `cuotas.condonado` existe separado de `pagado`.
   */
  const condonado = round2(cuotas.reduce((s, q) => s + q.condonado, 0));
  /**
   * De qué se compone lo que pagó. El certificado decía un total pelado, así que no había
   * forma de verificarlo ni de explicarle al cliente por qué pagó más que el capital que se
   * llevó: la diferencia es el interés pactado (que es la ganancia) y los punitorios.
   */
  const desglose = {
    capital: round2(pagos.reduce((s, p) => s + p.aplicado_capital, 0) + antesCapital),
    interes: round2(pagos.reduce((s, p) => s + p.aplicado_interes, 0) + antesInteres),
    mora: round2(pagos.reduce((s, p) => s + p.aplicado_mora, 0)),
    cargos: round2(pagos.reduce((s, p) => s + p.aplicado_cargos, 0) + antesCargos),
    condonado,
    pagos: pagos.length,
    cuotas_antes: antes.length,
  };
  const fecha_cancelacion = [
    ...pagos.map((p) => p.created_at),
    ...(anterior?.pagos ?? []).flatMap((p) => (p.fecha ? [new Date(`${p.fecha}T00:00:00.000Z`)] : [])),
    ...(anterior?.parcial?.fecha ? [new Date(`${anterior.parcial.fecha}T00:00:00.000Z`)] : []),
  ].reduce<Date | null>((acc, f) => (acc && acc > f ? acc : f), null);

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
      totales: { total_pagado, ...desglose, cuotas: cuotas.length, fecha_cancelacion },
    },
  };
}
