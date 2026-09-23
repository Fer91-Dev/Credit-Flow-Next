import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getCobranzaConfig } from "@/lib/config";
import { ESTADOS_VIVOS, diasMoraActual, severidadMora, round2 } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/kpis — los números de arriba de Cobranzas, sobre TODA la cartera.
 *
 * 🔴 POR QUÉ EXISTE.
 *
 * Los KPI se calculaban en el navegador sobre la lista que ya estaba cargada
 * (`CobranzaTable`), y esa lista viene de `/api/creditos?limit=1000`. Con más de mil créditos
 * el corte es invisible: "Total en gestión" y "Saldo expuesto" mostrarían los primeros mil y
 * nada lo diría. Un número que se queda corto sin avisar es peor que una pantalla lenta —
 * sobre esos KPI se decide a quién se sale a visitar.
 *
 * Medido el 23/09/2026: el techo de la lista es 1.000 y `useCreditos()` ni siquiera leía el
 * `total` que el endpoint ya devolvía, así que no había forma de detectarlo.
 *
 * 🔴 POR QUÉ NO SE AGREGA EN SQL.
 *
 * La tentación era un `count(*) FILTER (WHERE proximo_pago < now() - interval ...)`, pero eso
 * reescribe en SQL dos reglas que ya viven en el dominio —`diasMoraActual` y `severidadMora`,
 * con los tramos que configura la financiera— y este sistema ya pagó tres veces el precio de
 * tener dos fórmulas para el mismo número.
 *
 * En su lugar se trae la cartera viva con TRES columnas (`estado`, `proximo_pago`,
 * `saldo_pendiente`) y se aplican las funciones del dominio. Sin cuotas, sin cliente, sin
 * pagos: es una fracción de lo que pesa la lista —3,22 KB por crédito contra unas decenas de
 * bytes— y no tiene techo. El filtro por estado usa el índice `(tenant_id, estado)` que se
 * agregó en la migración 014.
 *
 * Si algún día una financiera tiene cientos de miles de créditos, ACÁ es donde hay que pasar
 * a agregación en SQL, y entonces habrá que mover también `severidadMora` a una sola
 * definición compartida (una vista o una función), no copiarla.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const { tenantId } = ctx;

  const { tramos_mora } = await getCobranzaConfig(tenantId);
  const hoy = hoyComercial();

  const vivos = await prisma.creditos.findMany({
    where: {
      ...withTenant(tenantId),
      ...scopeCreditosVendedor(ctx),
      estado: { in: [...ESTADOS_VIVOS] },
    },
    select: { proximo_pago: true, saldo_pendiente: true },
  });

  let esperado = 0;
  let enMora = 0;
  let total = 0;
  let critica = 0;
  let alta = 0;
  let media = 0;

  for (const c of vivos) {
    esperado += c.saldo_pendiente;
    // La MISMA cuenta que hace la lista: los días salen de `proximo_pago`, en vivo, no del
    // cache `dias_mora` —que no se avanza día a día— y la severidad, de los tramos del tenant.
    const dias = diasMoraActual(c.proximo_pago, hoy);
    if (dias <= 0) continue;
    total++;
    enMora += c.saldo_pendiente;
    const sev = severidadMora(dias, tramos_mora);
    if (sev === "critica") critica++;
    else if (sev === "alta") alta++;
    else media++;
  }

  return successResponse({
    /**
     * La partición de la cartera por SALDO: esperado = al día + en mora. Los tres son
     * `saldo_pendiente` a propósito —es la plata colocada, no la exigible—; si "en mora"
     * fuera lo vencido, las tres barras dejarían de sumar y el gráfico mentiría.
     */
    cartera: {
      esperado: round2(esperado),
      enMora: round2(enMora),
      alDia: round2(Math.max(0, esperado - enMora)),
    },
    mora: { total, saldo: round2(enMora), critica, alta, media },
    /** Cuántos créditos vivos se miraron, para poder cotejarlo contra el largo de la lista. */
    creditos_vivos: vivos.length,
  });
});
