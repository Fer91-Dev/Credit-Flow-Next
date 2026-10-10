import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";
import { hoyComercial } from "@/lib/utils";
import { cobrabilidadDeCuota } from "@/lib/domain";

/**
 * GET /api/dashboard/series
 * Serie mensual del gráfico del Home (Fernando, 30/09/2026: "la más inútil" — eran tres
 * curvas sin contra qué compararse y once meses en cero). Ahora dos lecturas:
 *
 *  · COBRABILIDAD — de lo que VENCÍA en el mes, cuánto se cobró. Es el número que mira una
 *    financiera: $4 millones cobrados no dicen nada si vencían $8.
 *      - a_cobrar:  Σ cuota_total de las cuotas con vencimiento en el mes. El mes en curso va
 *                   COMPLETO, como el "Avance de cobranzas" del mismo Home: así la barra de
 *                   este mes y esa tarjeta dicen el mismo porcentaje.
 *      - cobrado_de_eso: Σ lo pagado de esas cuotas SIN la mora (la mora va encima del plan;
 *                   sumarla daría más de 100%), con tope en la cuota. Cuenta lo pagado aunque
 *                   haya entrado después: es la cohorte del mes, no la caja del mes.
 *      La definición (qué cuotas cuentan y qué parte de lo pagado) es `cobrabilidadDeCuota`, la
 *      misma del Avance y del rendimiento por vendedor.
 *  · FLUJO — la plata que salió a la calle (créditos nuevos, sin refinanciaciones ni anulados)
 *    contra la que volvió (todos los pagos no anulados del mes, con mora).
 *
 * La ventana arranca en el PRIMER mes con movimiento (tope 12): un negocio que abrió hace dos
 * meses no se dibuja como diez meses en cero.
 *
 * Scoping: tenant + anti-IDOR (un vendedor ve solo lo suyo; admin/cobrador, todo).
 */
const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId: miVendedorId } = await requireAuth(req);

  const url = new URL(req.url);
  const vendedorParam = url.searchParams.get("vendedor_id");
  // Mismo criterio que /api/dashboard: el vendedor ve solo lo suyo.
  const vendedorId =
    role === "vendedor" ? (miVendedorId ?? "00000000-0000-0000-0000-000000000000") : vendedorParam;

  /**
   * 🔴 EL DÍA ARGENTINO, NO EL DEL SERVIDOR.
   *
   * El servidor corre en UTC, así que entre las 21:00 y la medianoche de Argentina `new Date()`
   * ya está en el día siguiente. Para elegir el período por defecto eso es plata: el 31 a las
   * 22:00 el mes en curso pasaba a ser el SIGUIENTE, y la pantalla abría vacía justo la noche
   * del cierre. `hoyComercial()` es la definición única del día comercial en todo el sistema.
   */
  const now = hoyComercial();
  // 12 buckets: del mes (actual − 11) al actual, en UTC (las fechas son @db.Date UTC).
  const meses: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    meses.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: MESES_ES[d.getUTCMonth()] });
  }
  const idxDe = new Map(meses.map((m, i) => [m.key, i]));
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const keyDe = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  // Filtro por crédito (vendedor) reutilizable directo y vía relación.
  const credFiltro: Record<string, unknown> = { ...withTenant(tenantId) };
  if (vendedorId) credFiltro.vendedor_id = vendedorId;
  const credRel = vendedorId ? { vendedor_id: vendedorId } : undefined;
  const finDeMes = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [pagos, creditos, cuotas] = await Promise.all([
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), anulado: false, fecha: { gte: windowStart }, ...(credRel ? { credito: credRel } : {}) },
      select: { fecha: true, monto: true },
    }),
    prisma.creditos.findMany({
      where: { ...credFiltro, fecha_inicio: { gte: windowStart } } as never,
      select: { fecha_inicio: true, monto_original: true, estado: true, es_refinanciacion: true },
    }),
    prisma.cuotas.findMany({
      where: {
        ...withTenant(tenantId),
        fecha_vencimiento: { gte: windowStart, lt: finDeMes },
        ...(credRel ? { credito: credRel } : {}),
      },
      select: { fecha_vencimiento: true, estado: true, cuota_total: true, pagado: true, pagado_mora: true },
    }),
  ]);

  const aCobrar = new Array(12).fill(0);
  const cobradoDeEso = new Array(12).fill(0);
  const prestado = new Array(12).fill(0);
  const cobrado = new Array(12).fill(0);

  for (const q of cuotas) {
    const i = idxDe.get(keyDe(q.fecha_vencimiento));
    if (i === undefined) continue;
    const c = cobrabilidadDeCuota(q); // misma definición que el Avance de cobranzas del Home
    if (!c) continue;
    aCobrar[i] += c.aCobrar;
    cobradoDeEso[i] += c.cobrado;
  }
  for (const c of creditos) {
    if (c.estado === "anulado" || c.es_refinanciacion) continue; // no es plata nueva en la calle
    const i = idxDe.get(keyDe(c.fecha_inicio));
    if (i !== undefined) prestado[i] += c.monto_original;
  }
  for (const p of pagos) {
    const i = idxDe.get(keyDe(p.fecha));
    if (i !== undefined) cobrado[i] += p.monto;
  }

  // Primer mes con algo que mostrar. Sin nada, la serie va vacía y el gráfico lo dice.
  let desde = 0;
  while (desde < 12 && aCobrar[desde] === 0 && prestado[desde] === 0 && cobrado[desde] === 0) desde++;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const corte = <T,>(a: T[]) => a.slice(desde);

  return successResponse({
    labels: corte(meses.map((m) => m.label)),
    keys: corte(meses.map((m) => m.key)),
    // El último mes siempre es el en curso (completo, como el Avance de cobranzas).
    series: {
      a_cobrar: corte(aCobrar.map(r2)),
      cobrado_de_eso: corte(cobradoDeEso.map(r2)),
      prestado: corte(prestado.map(r2)),
      cobrado: corte(cobrado.map(r2)),
    },
  });
});
