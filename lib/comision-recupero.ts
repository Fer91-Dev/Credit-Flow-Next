import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { getCobranzaConfig } from "@/lib/config";
import { resumirRecupero, round2, RECUPERO_VACIO, type CobroParaRecupero, type ResumenRecupero } from "@/lib/domain";

export type RangoDias = { desde: Date; hasta: Date } | null;

/**
 * Lee los cobros de los créditos de estos agentes y arma el plus por recupero de cada uno.
 * La regla vive en `lib/domain/comision-recupero.ts`; acá solo se trae el dato.
 *
 * Cada `rango` son DÍAS (inclusive en los dos extremos), no instantes. `pagos.fecha` es un
 * `@db.Date`, y los que llaman traen bordes de dos formas: la meta los guarda como día pelado
 * (00:00 UTC) y la liquidación como inicio del día argentino (03:00 UTC). Comparar un
 * `@db.Date` contra las 03:00 dejaba afuera los cobros del primer día del período. Por eso se
 * normaliza todo a la fecha del calendario antes de preguntar. `null` = toda la historia
 * (el agente no tiene meta vigente y se muestra lo acumulado, como el resto de su comisión).
 */
export async function recuperoPorAgente(
  tenantId: string,
  agentes: { id: string; rango: RangoDias }[],
): Promise<Map<string, ResumenRecupero>> {
  const out = new Map<string, ResumenRecupero>();
  if (agentes.length === 0) return out;

  const { recupero, comision_recupero: cfg } = await getCobranzaConfig(tenantId);
  // Apagado: ni se consulta la base. Es el caso de toda financiera que no lo cargó.
  if (cfg.pct <= 0) return out;

  const dia = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const rangoDe = new Map(agentes.map((a) => [a.id, a.rango ? { desde: dia(a.rango.desde), hasta: dia(a.rango.hasta) } : null]));

  /* Cada agente puede tener su propio período (la meta es por persona), así que se trae UNA
     vez desde el comienzo más temprano y se recorta por agente abajo. Si alguno no tiene
     meta, se mira su historia entera y no hay piso. */
  const rangos = [...rangoDe.values()];
  const piso = rangos.some((r) => r === null)
    ? null
    : new Date(Math.min(...rangos.map((r) => r!.desde.getTime())));

  const pagos = await prisma.pagos.findMany({
    where: {
      ...withTenant(tenantId),
      anulado: false,
      credito: { vendedor_id: { in: agentes.map((a) => a.id) } },
      ...(piso ? { fecha: { gte: piso } } : {}),
    },
    select: {
      id: true,
      credito_id: true,
      fecha: true,
      credito: { select: { vendedor_id: true, es_refinanciacion: true } },
      aplicaciones: {
        select: {
          aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true,
          cuota: { select: { fecha_vencimiento: true } },
        },
      },
    },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });

  const porAgente = new Map<string, CobroParaRecupero[]>();
  for (const p of pagos) {
    const vid = p.credito.vendedor_id;
    if (!vid) continue;
    const r = rangoDe.get(vid);
    if (r && (p.fecha < r.desde || p.fecha > r.hasta)) continue;
    const arr = porAgente.get(vid) ?? [];
    arr.push({
      pago_id: p.id,
      credito_id: p.credito_id,
      fecha: p.fecha,
      imputado: round2(p.aplicaciones.reduce(
        (s, a) => s + a.aplicado_capital + a.aplicado_interes + a.aplicado_mora + a.aplicado_cargos, 0,
      )),
      vencimientos: p.aplicaciones.map((a) => a.cuota.fecha_vencimiento),
      es_refinanciacion: p.credito.es_refinanciacion,
    });
    porAgente.set(vid, arr);
  }

  for (const a of agentes) {
    out.set(a.id, resumirRecupero(porAgente.get(a.id) ?? [], recupero.dias_min_mora_acuerdo, cfg));
  }
  return out;
}

/** El de un agente, o vacío. Para los endpoints que muestran uno solo. */
export async function recuperoDeAgente(
  tenantId: string,
  vendedorId: string,
  rango: RangoDias,
): Promise<ResumenRecupero> {
  return (await recuperoPorAgente(tenantId, [{ id: vendedorId, rango }])).get(vendedorId) ?? RECUPERO_VACIO;
}
