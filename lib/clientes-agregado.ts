import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { calcularScore, diasMoraActual, esCreditoVivo, esClienteEnfriado, DIAS_INACTIVIDAD_COMERCIAL } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";

/**
 * DERIVADOS DEL CLIENTE — lo que no está guardado y se calcula del comportamiento.
 *
 * Vive acá y no en el route porque lo usan DOS endpoints: la lista (`GET /api/clientes`, que
 * enriquece la página que devuelve) y los KPI (`GET /api/clientes/kpis`, que agrega sobre
 * TODA la cartera). Tener la fórmula en un solo lugar es lo que evita que el KPI diga una
 * cosa y la fila de la lista otra.
 */

/** Lo que se acumula por cliente a partir de sus créditos, pagos y cuotas. */
export type AgregadoCliente = {
  tieneCreditos: boolean;
  maxDiasMora: number;
  cuotasVencidas: number;
  cuotasCumplidas: number;
  /** Epoch ms del último pago / alta de crédito, o el alta del cliente si nunca operó. */
  ultimoMovimiento: number;
};

/**
 * Acumula los derivados de un conjunto de clientes con 3 consultas, acotadas a esos ids.
 *
 * 🔴 La mora sale EN VIVO de `proximo_pago`, nunca del cache `creditos.dias_mora`: esa columna
 * solo se escribe al cobrar/anular/refinanciar y no la avanza nadie día a día (regla del
 * proyecto — ver la nota de mora en CLAUDE.md).
 */
export async function agregarClientes(
  tenantId: string,
  rows: Array<{ id: string; created_at: Date }>,
): Promise<Map<string, AgregadoCliente>> {
  const agg = new Map<string, AgregadoCliente>();
  for (const c of rows) {
    agg.set(c.id, {
      tieneCreditos: false,
      maxDiasMora: 0,
      cuotasVencidas: 0,
      cuotasCumplidas: 0,
      ultimoMovimiento: c.created_at.getTime(),
    });
  }
  if (rows.length === 0) return agg;

  const clienteIds = rows.map((c) => c.id);

  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), cliente_id: { in: clienteIds } },
    select: { id: true, cliente_id: true, estado: true, dias_mora: true, proximo_pago: true, created_at: true },
  });

  const creditoIds = creditos.map((c) => c.id);
  const creditoACliente = new Map(creditos.map((c) => [c.id, c.cliente_id]));

  const [pagos, cuotas] = await Promise.all([
    creditoIds.length
      ? prisma.pagos.findMany({
          where: { ...withTenant(tenantId), credito_id: { in: creditoIds } },
          select: { credito_id: true, fecha: true },
        })
      : Promise.resolve([] as Array<{ credito_id: string; fecha: Date }>),
    creditoIds.length
      ? prisma.cuotas.findMany({
          where: { ...withTenant(tenantId), credito_id: { in: creditoIds } },
          select: { credito_id: true, estado: true, fecha_vencimiento: true },
        })
      : Promise.resolve([] as Array<{ credito_id: string; estado: string; fecha_vencimiento: Date }>),
  ]);

  const hoyMora = hoyComercial();
  for (const cr of creditos) {
    const a = agg.get(cr.cliente_id);
    if (!a) continue;
    a.tieneCreditos = true;
    const dm = cr.proximo_pago ? diasMoraActual(cr.proximo_pago, hoyMora) : cr.dias_mora;
    if (esCreditoVivo(cr.estado) && dm > a.maxDiasMora) a.maxDiasMora = dm;
    a.ultimoMovimiento = Math.max(a.ultimoMovimiento, cr.created_at.getTime());
  }

  for (const p of pagos) {
    const clienteId = creditoACliente.get(p.credito_id);
    const a = clienteId ? agg.get(clienteId) : undefined;
    if (a) a.ultimoMovimiento = Math.max(a.ultimoMovimiento, p.fecha.getTime());
  }

  const hoy = Date.now();
  for (const q of cuotas) {
    const clienteId = creditoACliente.get(q.credito_id);
    const a = clienteId ? agg.get(clienteId) : undefined;
    if (!a) continue;
    if (q.fecha_vencimiento.getTime() < hoy) {
      a.cuotasVencidas += 1;
      if (q.estado === "pagada") a.cuotasCumplidas += 1;
    }
  }

  return agg;
}

/**
 * Agrega a cada cliente de la página sus derivados (no persistidos):
 * - `ultimo_movimiento`: fecha del último pago o del último crédito otorgado.
 * - `dias_mora_max`: días del crédito MÁS atrasado. Ya se calculaba para el score y se
 *   descartaba; con él la lista puede decir que la persona tiene un crédito en Legales sin
 *   abrir su ficha, que es donde el operador lo necesita: se lo ve antes de llamarla.
 * - `score`: calificación crediticia derivada del comportamiento (ver lib/domain/scoring).
 */
export async function enriquecerClientes<T extends { id: string; created_at: Date }>(
  tenantId: string,
  rows: T[],
) {
  if (rows.length === 0) return rows;
  const agg = await agregarClientes(tenantId, rows);

  return rows.map((c) => {
    const a = agg.get(c.id)!;
    const score = calcularScore({
      maxDiasMora: a.maxDiasMora,
      cuotasVencidas: a.cuotasVencidas,
      cuotasCumplidas: a.cuotasCumplidas,
      tieneCreditos: a.tieneCreditos,
    });
    return {
      ...c,
      ultimo_movimiento: new Date(a.ultimoMovimiento).toISOString(),
      dias_mora_max: a.maxDiasMora,
      score: { categoria: score.categoria, label: score.label, puntaje: score.puntaje },
    };
  });
}

/** Los recortes que ofrecen los KPI de Clientes. `null` = sin recorte. */
export type FiltroClientes = "enfriados" | "riesgo" | "nuevos" | null;

export type KpisClientes = {
  total: number;
  enfriados: number;
  riesgo: number;
  nuevos: number;
  /** El corte de inactividad vigente, para que la pantalla lo escriba sin repetirlo. */
  dias_inactividad: number;
};

/**
 * KPI de Clientes, agregados sobre TODA la cartera del tenant, y los ids de cada recorte.
 *
 * 🔴 SE CALCULAN EN EL SERVIDOR, y no es un detalle de prolijidad. Sumarlos en el navegador
 * daría el total de la página disfrazado de total de la cartera — el mismo error que ya está
 * documentado en `lib/swr.ts` para los KPI de la terminal de cobro. Un KPI que dice "14
 * enfriados" cuando en realidad son 40 es peor que no tenerlo: se actúa sobre él.
 *
 * Devuelve también los ids por recorte porque `enfriados` y `riesgo` son DERIVADOS: no existen
 * como columna, así que no se pueden filtrar en SQL. Es lo que permite que el KPI, al
 * clickearlo, se convierta en el filtro de la lista.
 */
export async function kpisClientes(tenantId: string): Promise<KpisClientes & { ids: Record<"enfriados" | "riesgo" | "nuevos", string[]> }> {
  const rows = await prisma.clientes.findMany({
    where: { ...withTenant(tenantId) },
    select: { id: true, created_at: true },
  });

  const agg = await agregarClientes(tenantId, rows);
  const ahora = new Date();
  // Primer día del mes en curso, en hora local del server (el tenant es de una sola plaza).
  const desdeMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();

  const ids = { enfriados: [] as string[], riesgo: [] as string[], nuevos: [] as string[] };

  for (const c of rows) {
    const a = agg.get(c.id)!;

    if (esClienteEnfriado(new Date(a.ultimoMovimiento), ahora)) ids.enfriados.push(c.id);

    /**
     * "Riesgo" son C y D. `sin_historial` NO cuenta: es alguien que todavía no pidió nada, y
     * meterlo acá haría que toda financiera nueva abriera la pantalla con su cartera entera
     * marcada en rojo.
     */
    const score = calcularScore({
      maxDiasMora: a.maxDiasMora,
      cuotasVencidas: a.cuotasVencidas,
      cuotasCumplidas: a.cuotasCumplidas,
      tieneCreditos: a.tieneCreditos,
    });
    if (score.categoria === "C" || score.categoria === "D") ids.riesgo.push(c.id);

    if (c.created_at.getTime() >= desdeMes) ids.nuevos.push(c.id);
  }

  return {
    total: rows.length,
    enfriados: ids.enfriados.length,
    riesgo: ids.riesgo.length,
    nuevos: ids.nuevos.length,
    dias_inactividad: DIAS_INACTIVIDAD_COMERCIAL,
    ids,
  };
}
