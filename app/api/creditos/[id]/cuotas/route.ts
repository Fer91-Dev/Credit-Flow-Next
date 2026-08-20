import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { frecuenciaLabel, normalizarFrecuencia, diasAtraso, round2, interesMora, moraDelCredito, moraDesdeCronograma, type FrecuenciaDef } from "@/lib/domain";
import { getConfiguracion } from "@/lib/config";
import { formatComprobante } from "@/lib/comprobantes";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/cuotas
 * Libro mayor PERSISTIDO de cuotas del crédito. Lee el estado AUTORITATIVO que
 * escribe el motor de pagos cuota-dirigido (Fase 6B): `pagado_*` y `estado`. El
 * estado `vencida` se recalcula dinámicamente en lectura (depende de la fecha de
 * hoy y no lo "toca" el motor hasta que llega un pago). `/amortizacion` se conserva
 * como proyección/simulación al vuelo.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id },
    select: {
      id: true,
      frecuencia: true,
      frecuencia_def: true,
      cronograma: true, // condiciones de mora congeladas al otorgar
      cliente: { select: { nombre: true, apellido: true } },
      cuotas: {
        orderBy: { nro: "asc" },
        include: {
          // Comprobantes (recibos) que imputaron a cada cuota: pago → movimiento de caja.
          aplicaciones: {
            include: { pago: { select: { fecha: true, created_at: true, movimientos: { select: { serie: true, numero: true } } } } },
          },
        },
      },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  const frecuencia = normalizarFrecuencia(credito.frecuencia);
  const catalogo = credito.frecuencia_def
    ? [credito.frecuencia_def as unknown as FrecuenciaDef]
    : undefined;

  // Día comercial argentino, no el ahora en UTC: entre las 21:00 y la medianoche de
  // Argentina, una cuota que vence hoy se mostraba ya como vencida en el cronograma.
  const hoy = hoyComercial();

  /**
   * Mora POR CUOTA, para poder cobrar una sola desde el cronograma.
   *
   * Se calcula acá y no en la pantalla a propósito: la mora depende de las condiciones
   * CONGELADAS en el crédito (tasa, días de gracia) y de la misma fórmula con la que se
   * imputa al cobrar. Replicarla en el navegador sería una segunda fuente para un número
   * que es plata — el error que ya se pagó caro con los cargos del plan.
   */
  const config = await getConfiguracion(tenantId);
  const moraCred = moraDelCredito(moraDesdeCronograma(credito.cronograma), config);
  const graciaCred = (credito.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;

  const cuotas = credito.cuotas.map((c) => {
    const restante_capital = round2(Math.max(0, c.capital - c.pagado_capital));
    // Días de atraso de ESTA cuota. Sale de acá y no del navegador porque es el número que
    // explica el importe de mora: los dos tienen que salir del mismo "hoy comercial", o la
    // pantalla mostraría 70 días al lado de una mora calculada sobre 69.
    const dias_atraso = diasAtraso(c.fecha_vencimiento, hoy);
    const capitalSaldado = c.pagado_capital >= round2(c.capital);
    // Estado de presentación: capital saldado = pagada; si no, vencida si ya
    // venció; parcial si hubo alguna imputación; sino pendiente.
    let estado: string;
    if (capitalSaldado) estado = "pagada";
    else if (dias_atraso > 0) estado = "vencida";
    else if (c.pagado_capital > 0 || c.pagado_interes > 0 || c.pagado_mora > 0 || c.pagado_cargos > 0) estado = "parcial";
    else estado = "pendiente";
    const moraPlena = moraCred.moraActiva
      ? interesMora(c.cuota_total, dias_atraso, { tasaDiaria: moraCred.tasaMoraDiaria, diasGracia: graciaCred })
      : 0;
    const moraPend = capitalSaldado ? 0 : round2(Math.max(0, moraPlena - c.pagado_mora));
    const pendienteCuota = round2(Math.max(0, c.cuota_total - (c.pagado_capital + c.pagado_interes + c.pagado_cargos)));

    // Recibos (comprobantes) que imputaron a esta cuota.
    const comprobantes = c.aplicaciones
      .map((a) => {
        const mov = a.pago.movimientos.find((m) => m.serie != null && m.numero != null);
        return {
          comprobante: formatComprobante(mov?.serie, mov?.numero),
          fecha: a.pago.fecha,
          fecha_hora: a.pago.created_at, // momento real en que se registró el pago
          monto: round2(a.aplicado_capital + a.aplicado_interes + a.aplicado_mora + a.aplicado_cargos),
        };
      })
      .filter((x) => x.monto > 0);
    return {
      nro: c.nro,
      fecha_vencimiento: c.fecha_vencimiento,
      saldo_inicial: c.saldo_inicial,
      capital: c.capital,
      interes: c.interes,
      iva: c.iva,
      seguro: c.seguro,
      gastos: c.gastos,
      cuota_total: c.cuota_total,
      estado,
      pagado_capital: c.pagado_capital,
      pagado_interes: c.pagado_interes,
      pagado_mora: c.pagado_mora,
      pagado_cargos: c.pagado_cargos,
      restante_capital,
      // Mora devengada de ESTA cuota (0 si no venció o si la financiera la tiene apagada).
      mora: moraPend,
      dias_atraso,
      // Lo que hay que cobrar para saldarla HOY: lo que falta de la cuota más su mora.
      total_cobrar: round2(pendienteCuota + moraPend),
      comprobantes,
    };
  });

  const pagadas = cuotas.filter((c) => c.estado === "pagada").length;
  const vencidas = cuotas.filter((c) => c.estado === "vencida").length;
  const parciales = cuotas.filter((c) => c.estado === "parcial").length;
  const pendientes = cuotas.filter((c) => c.estado === "pendiente").length;
  const proxima = cuotas.find((c) => c.estado !== "pagada") ?? null;
  const saldo_capital = cuotas.reduce((s, c) => s + c.restante_capital, 0);

  /**
   * Acuerdo de pago VIGENTE, si lo hay, con la próxima cuota a cobrar.
   *
   * Viaja acá y no en un endpoint aparte porque la terminal de cobro ya pide esto al elegir
   * un crédito: sin el dato, quien cobra desde Pagos no tiene forma de saber que hay un
   * arreglo y le cobraría la cuota del crédito en vez de la pactada, que es otro importe.
   */
  const acuerdo = await prisma.acuerdos_pago.findFirst({
    where: { ...withTenant(tenantId), credito_id: id, estado: "vigente" },
    select: {
      // `deuda_original` y `quita` viajan para poder mostrar de qué se COMPONE el total del
      // acuerdo. Sin eso, la terminal de cobro mostraba "$81.876,14" sin origen: el operador
      // lo había visto desglosado al armarlo y acá volvía a aparecer como un número suelto.
      id: true, fecha: true, monto_acordado: true, deuda_original: true, quita: true, congela_punitorios: true,
      cuotas: { orderBy: { numero: "asc" }, select: { numero: true, vencimiento: true, monto: true, pagado: true, estado: true } },
    },
  });
  const proximaAcuerdo = acuerdo?.cuotas.find((c) => c.estado !== "pagada") ?? null;

  return successResponse({
    credito_id: credito.id,
    cliente: credito.cliente ? nombreCompleto(credito.cliente) : null,
    acuerdo: acuerdo
      ? {
          id: acuerdo.id,
          fecha: acuerdo.fecha,
          monto_acordado: acuerdo.monto_acordado,
          deuda_original: acuerdo.deuda_original,
          quita: acuerdo.quita,
          congela_punitorios: acuerdo.congela_punitorios,
          total_cuotas: acuerdo.cuotas.length,
          /**
           * El plan ENTERO del acuerdo. Ya se consultaba para resolver `proxima` y se
           * descartaba: sin él, la terminal de cobro mostraba un importe precargado
           * ($27.292,04) al lado de una tabla con las cuotas del CRÉDITO ($73.441,71) y no
           * había forma de ver de dónde salía. Es "cuota 1 de 3 del acuerdo", y eso se
           * entiende viendo el plan, no leyendo un párrafo que lo explique.
           */
          cuotas: acuerdo.cuotas.map((c) => ({
            numero: c.numero,
            vencimiento: c.vencimiento,
            monto: c.monto,
            pagado: c.pagado,
            estado: c.estado,
          })),
          proxima: proximaAcuerdo
            ? {
                numero: proximaAcuerdo.numero,
                vencimiento: proximaAcuerdo.vencimiento,
                // Lo que falta de esa cuota, no su importe nominal: si se pagó una parte,
                // cobrar el nominal de nuevo sería cobrar de más.
                pendiente: Math.round((proximaAcuerdo.monto - proximaAcuerdo.pagado) * 100) / 100,
              }
            : null,
        }
      : null,
    frecuencia,
    frecuencia_label: frecuenciaLabel(frecuencia, catalogo),
    resumen: {
      total: cuotas.length,
      pagadas,
      parciales,
      pendientes,
      vencidas,
      proxima_cuota: proxima
        ? { nro: proxima.nro, fecha_vencimiento: proxima.fecha_vencimiento, cuota_total: proxima.cuota_total }
        : null,
      saldo_capital: Math.round(saldo_capital * 100) / 100,
    },
    cuotas,
  });
});
