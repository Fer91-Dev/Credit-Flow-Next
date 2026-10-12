import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getCobranzaConfig } from "@/lib/config";
import { esCreditoVivo, diasMoraActual, severidadMora, estadoOperativo, round2 } from "@/lib/domain";
import { creditosConAcuerdoVigente } from "@/lib/acuerdos";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/creditos/kpis — los números de arriba de Créditos, sobre TODA la cartera.
 *
 * Misma razón y mismo criterio que `/api/cobranza/kpis`: se calculaban en el navegador sobre
 * la lista, que viene topeada en 1.000, así que pasado ese número "Cartera activa" y
 * "Pagados" se habrían quedado cortos sin que nada lo dijera.
 *
 * 🔴 Y por los mismos motivos NO se agrega en SQL: `diasMoraActual` y `severidadMora` —con
 * los tramos que configura la financiera— ya viven en el dominio, y reescribirlas en un
 * `count(*) FILTER` sería la cuarta vez que este sistema tiene dos fórmulas para el mismo
 * número. Se traen CUATRO columnas y se aplican las funciones de siempre.
 *
 * A diferencia del de cobranza, acá hacen falta también los créditos que ya no están vivos
 * (los pagados cuentan), así que no se filtra por estado en la consulta.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const { tenantId } = ctx;

  const { tramos_mora, recupero } = await getCobranzaConfig(tenantId);
  const hoy = hoyComercial();
  // Para "Activos atrasados": con acuerdo vigente el badge ya no dice "Activo atrasado".
  const conAcuerdo = await creditosConAcuerdoVigente(tenantId);

  const filas = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor(ctx) },
    select: {
      id: true, estado: true, proximo_pago: true, saldo_pendiente: true, monto_original: true,
      // Una columna más, ninguna consulta más: con esto salen también los KPI de la pestaña
      // Refinanciados en la misma pasada.
      es_refinanciacion: true,
    },
  });

  let activos = 0, alDia = 0, enMora = 0, cartera = 0;
  let moraCritica = 0, montoCritico = 0;
  let pagados = 0, montoPagado = 0;
  let atrasados = 0, montoAtrasado = 0;

  /**
   * 🔴 LOS NÚMEROS DE LA PESTAÑA REFINANCIADOS, SOBRE EL HISTORIAL ENTERO.
   *
   * Se calculaban en el navegador sobre la ventana de 1.000 créditos: la "tasa de recupero"
   * y el "total consolidado" contaban sobre lo que hubiera entrado y se mostraban como el
   * historial completo. El aviso de lista recortada hablaba de la TABLA, no de estos
   * números, así que nada decía que estuvieran cortos.
   */
  let refiTotal = 0, refiAlDia = 0, refiEnMora = 0;
  let refiConsolidado = 0, refiSaldoAlDia = 0, refiSaldoEnMora = 0;

  for (const c of filas) {
    if (c.estado === "pagado") {
      pagados++;
      montoPagado += c.monto_original;
    }
    // La mora se mira en TODOS, no solo en los vivos: es el mismo criterio que la lista, que
    // calcula la severidad sobre `dias_mora` venga de donde venga el crédito.
    const dias = diasMoraActual(c.proximo_pago, hoy);
    if (severidadMora(dias, tramos_mora) === "critica") {
      moraCritica++;
      montoCritico += c.saldo_pendiente;
    }
    /* Las refinanciaciones cuentan venga de donde venga el crédito —una ya cancelada es
       justamente el caso de éxito del recupero—, así que va ANTES del corte por vivos. */
    if (c.es_refinanciacion) {
      refiTotal++;
      refiConsolidado += c.monto_original;
      if (dias > 0) { refiEnMora++; refiSaldoEnMora += c.saldo_pendiente; }
      else { refiAlDia++; refiSaldoAlDia += c.saldo_pendiente; }
    }

    // Cartera VIVA: incluye los vencidos, que siguen siendo plata en la calle.
    if (!esCreditoVivo(c.estado)) continue;
    activos++;
    cartera += c.saldo_pendiente;
    if (dias > 0) enMora++;
    else alDia++;
    /* "Activo atrasado" con la MISMA función que dibuja el badge. Sin refinanciaciones: el
       KPI filtra la pestaña Créditos, que no las lista, y el número tiene que dar las filas. */
    if (!c.es_refinanciacion &&
        estadoOperativo(c.estado, dias, recupero.dias_min_mora_acuerdo, conAcuerdo.has(c.id) ? { alDia: true } : null) === "atrasado") {
      atrasados++;
      montoAtrasado += c.saldo_pendiente;
    }
  }

  return successResponse({
    activos,
    alDia,
    enMora,
    cartera: round2(cartera),
    // Promedio por crédito vivo: dice si la cartera son pocos grandes o muchos chicos.
    promedio: activos > 0 ? round2(cartera / activos) : 0,
    moraCritica,
    // La plata parada en mora crítica. El conteo solo no alcanza para dimensionar el riesgo.
    montoCritico: round2(montoCritico),
    pagados,
    // Capital que se prestó y volvió completo (los ya cancelados).
    montoPagado: round2(montoPagado),
    atrasados,
    montoAtrasado: round2(montoAtrasado),
    total: filas.length,
    /* Pestaña Refinanciados. `tasaRecupero` es el número que decide si reestructurar sirve o
       solo patea el problema: de cada 100 refinanciaciones, cuántas se están pagando. */
    refi: {
      total: refiTotal,
      alDia: refiAlDia,
      enMora: refiEnMora,
      consolidado: round2(refiConsolidado),
      promedio: refiTotal > 0 ? round2(refiConsolidado / refiTotal) : 0,
      saldoAlDia: round2(refiSaldoAlDia),
      saldoEnMora: round2(refiSaldoEnMora),
      tasaRecupero: refiTotal > 0 ? Math.round((refiAlDia / refiTotal) * 100) : 0,
    },
  });
});
