/**
 * Los datos del pagaré de un crédito. UNA sola consulta, compartida por la ruta que revisa si
 * se puede emitir (JSON) y la que genera el PDF: el aviso "faltan estos datos" y el papel
 * tienen que mirar exactamente lo mismo.
 *
 * Server-only (toca Prisma). El texto vive en `lib/domain/pagare.ts`, que es puro.
 *
 * 🔴 Todo sale de lo CONGELADO al otorgar: las cuotas persistidas (lo que se cobra), los
 * cargos, la convención de la tasa y la mora del snapshot `cronograma`. La configuración
 * vigente es solo el fallback de los créditos viejos que no la congelaban. Un pagaré
 * reimpreso dentro de un año tiene que decir lo mismo que el que se firmó.
 */
import { scopeCreditosVendedor, type AuthContext } from "@/lib/auth";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { getConfiguracion, getDocumentosConfig } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { formatCreditoNumero, nombreCompleto } from "@/lib/utils";
import {
  construirPlanAmortizacion,
  tasaPeriodicaSegunConvencion,
  efectivaAnualDesdePeriodica,
  calcularCFT,
  normalizarFrecuencia,
  frecuenciaLabel,
  resolverFrecuencia,
  resolverCargos,
  convencionDelCredito,
  moraDelCredito,
  moraDesdeCronograma,
  esCreditoVivo,
  esCreditoIncobrable,
  faltantesParaContrato,
  round2,
  type CargosConfig,
  type CronogramaConfig,
  type RedondeoModo,
  type DatosPagare,
  type FaltanteContrato,
} from "@/lib/domain";

export type PagareError = "NOT_FOUND" | "NO_VIGENTE";

/** Domicilio en un renglón: calle y número, piso y depto si están. */
function calle(p: { direccion?: string | null; piso?: string | null; depto?: string | null }): string {
  const partes = [p.direccion?.trim()];
  if (p.piso?.trim()) partes.push(`piso ${p.piso.trim()}`);
  if (p.depto?.trim()) partes.push(`depto. ${p.depto.trim()}`);
  return partes.filter(Boolean).join(", ");
}

export interface ResultadoPagare {
  datos: DatosPagare | null;
  /** Lo que falta para emitir. Con algún bloqueante, `datos` igual viene (para la vista previa). */
  faltantes: FaltanteContrato[];
  error: PagareError | null;
  credito?: { id: string; numero: string; doc_estado: string; doc_emitido_en: Date | null };
}

export async function datosPagare(
  ctx: Pick<AuthContext, "tenantId" | "role" | "vendedorId">,
  creditoId: string,
): Promise<ResultadoPagare> {
  const { tenantId, role, vendedorId } = ctx;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id: creditoId },
    select: {
      id: true, numero: true, estado: true, tipo_credito: true, monto_original: true, tasa: true,
      plazo_meses: true, frecuencia: true, frecuencia_def: true, cargos: true, cronograma: true,
      fecha_inicio: true, es_refinanciacion: true, refinancia_a: true, producto_cantidad: true,
      doc_estado: true, doc_emitido_en: true,
      producto: { select: { nombre: true } },
      cliente: {
        select: {
          nombre: true, apellido: true, documento: true, direccion: true, piso: true, depto: true,
          localidad: true, provincia: true,
        },
      },
      cuotas: {
        select: { nro: true, fecha_vencimiento: true, cuota_total: true, interes: true, iva: true, seguro: true, gastos: true, honorarios: true },
        orderBy: { nro: "asc" },
      },
    },
  });
  if (!credito) return { datos: null, faltantes: [], error: "NOT_FOUND" };

  const [conOrigen] = await conNumeroDeOrigen(tenantId, [credito]);
  const numero = formatCreditoNumero(credito.numero, conOrigen.refinancia_a_numero);
  const resumen = { id: credito.id, numero, doc_estado: credito.doc_estado, doc_emitido_en: credito.doc_emitido_en };

  /*
    Un crédito anulado, cancelado o ya refinanciado no se documenta: no hay deuda que respaldar.
    El INCOBRABLE sí: la deuda sigue viva y es justo el que va a legales, donde el abogado
    necesita el pagaré y la información del art. 36 juntos.
  */
  if (!esCreditoVivo(credito.estado) && !esCreditoIncobrable(credito.estado)) {
    return { datos: null, faltantes: [], error: "NO_VIGENTE", credito: resumen };
  }

  const [config, docs, fin] = await Promise.all([
    getConfiguracion(tenantId), getDocumentosConfig(tenantId), getFinanciera(tenantId),
  ]);

  // El crédito que esta refinanciación reemplaza, con su propio número (puede ser otra REF).
  let refinanciaA: string | null = null;
  if (credito.es_refinanciacion && credito.refinancia_a) {
    const viejo = await prisma.creditos.findFirst({
      where: { ...withTenant(tenantId), id: credito.refinancia_a },
      select: { numero: true, es_refinanciacion: true, refinancia_a: true },
    });
    if (viejo) {
      const [v] = await conNumeroDeOrigen(tenantId, [viejo]);
      refinanciaA = formatCreditoNumero(viejo.numero, v.refinancia_a_numero);
    }
  }

  // ── Condiciones congeladas ──
  const catalogo = credito.frecuencia_def
    ? [credito.frecuencia_def as unknown as (typeof config.simulador.frecuencias)[number]]
    : config.simulador.frecuencias;
  const frecuencia = normalizarFrecuencia(credito.frecuencia);
  const convencion = convencionDelCredito(credito.cronograma, config.convencionTasa);
  const tea = efectivaAnualDesdePeriodica(
    tasaPeriodicaSegunConvencion(credito.tasa, convencion, frecuencia, catalogo), frecuencia, catalogo,
  );
  const cargosDelCredito = resolverCargos(credito.cargos as Partial<CargosConfig> | null, config.simulador.cargos);
  /*
    La comisión de otorgamiento NO está en las cuotas persistidas cuando se paga al firmar, y
    cuando está financiada viene mezclada en el capital a amortizar. Se reconstruye con el
    mismo motor y los mismos parámetros congelados que usa la pantalla de amortización, para
    que el papel diga el mismo importe que el operador ve.
  */
  const plan = construirPlanAmortizacion(
    credito.monto_original, credito.tasa, credito.plazo_meses, credito.fecha_inicio, convencion, frecuencia,
    {
      cargos: cargosDelCredito,
      redondeo: (credito.cronograma as { redondeo?: { modo: RedondeoModo; multiplo: number } } | null)?.redondeo
        ?? config.simulador.redondeoCuota,
      cronograma: (credito.cronograma as CronogramaConfig | null) ?? undefined,
    },
    catalogo,
  );
  const esProducto = credito.tipo_credito === "productos";
  /*
    🔴 En un crédito de PRODUCTO la comisión que no se financia NO se cobra: el otorgamiento
    solo la asienta en caja en los créditos de dinero (en uno de producto no hay caja de por
    medio). Declararla en el papel sería pactar un cobro que el sistema nunca registra.
  */
  const comisionReal = esProducto && !plan.comisionFinanciada ? 0 : plan.comision;
  const comisionAlFirmar = comisionReal > 0 && !plan.comisionFinanciada ? comisionReal : 0;

  const cuotas = credito.cuotas.map((q) => ({ nro: q.nro, vencimiento: q.fecha_vencimiento, total: q.cuota_total }));
  const filas = credito.cuotas;
  const suma = (f: (q: (typeof filas)[number]) => number) => round2(filas.reduce((s, q) => s + (f(q) ?? 0), 0));
  // El C.F.T. sobre lo que se COBRA (cuotas persistidas), no sobre el plan reconstruido.
  const cft = calcularCFT({
    capital: credito.monto_original,
    cargosIniciales: comisionAlFirmar,
    pagos: cuotas.map((c) => c.total),
    periodosAnio: resolverFrecuencia(frecuencia, catalogo).periodosAnio,
  });

  const mora = moraDelCredito(moraDesdeCronograma(credito.cronograma), config);
  const diasGracia = (credito.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;

  const cli = credito.cliente;
  const datos: DatosPagare = {
    numero,
    fechaOtorgamiento: credito.fecha_inicio,
    acreedor: {
      nombre: fin.razon_social?.trim() || fin.nombre,
      documento: fin.cuit?.trim() || null,
      domicilio: calle(fin),
      localidad: fin.localidad,
      provincia: fin.provincia,
    },
    deudor: {
      nombre: nombreCompleto(cli),
      documento: cli.documento?.trim() || null,
      domicilio: calle(cli),
      localidad: cli.localidad,
      provincia: cli.provincia,
    },
    tipo: credito.es_refinanciacion ? "refinanciacion" : credito.tipo_credito === "productos" ? "producto" : "efectivo",
    producto: credito.producto ? { nombre: credito.producto.nombre, cantidad: credito.producto_cantidad ?? 1 } : null,
    refinanciaA,
    capital: credito.monto_original,
    cuotas,
    totalIntereses: suma((q) => q.interes),
    cargos: {
      comision: comisionReal,
      comisionFinanciada: plan.comisionFinanciada,
      iva: suma((q) => q.iva),
      seguro: suma((q) => q.seguro),
      gastos: suma((q) => q.gastos),
      honorarios: suma((q) => q.honorarios),
    },
    frecuenciaLabel: frecuenciaLabel(frecuencia, catalogo).adjetivo,
    tea,
    cft: cft?.anual ?? null,
    mora: { activa: mora.moraActiva, tasaDiaria: mora.tasaMoraDiaria, diasGracia, topePct: mora.topeMoraPct },
    documentos: docs,
  };

  const faltantes = faltantesParaContrato({
    financiera: fin,
    cliente: cli,
    credito: { monto_original: credito.monto_original, cuotas: credito.cuotas.length },
  });

  return { datos, faltantes, error: null, credito: resumen };
}
