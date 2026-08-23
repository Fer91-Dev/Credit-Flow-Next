import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getCobranzaConfig } from "@/lib/config";
import { sincronizarAcuerdos, creditosConAcuerdoVigente } from "@/lib/acuerdos";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import { diasMoraActual, ESTADOS_VIVOS } from "@/lib/domain";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/agenda
 * "Agenda del día" de cobranza: cola priorizada de a quién contactar hoy, SCOPEADA al vendedor
 * (admin ve todo). Junta 3 fuentes de la cartera en mora y las clasifica en buckets:
 *  - promesa:  promesa de pago pendiente vencida (o de hoy) sin cumplir.
 *  - agendado: gestión con "próximo contacto" para hoy o vencido.
 *  - enfriado: moroso sin gestión humana en `dias_sin_gestion` días (parametrizable en Config).
 * Prioridad: promesa → agendado → enfriado; dentro de cada uno, mayor mora primero.
 */
type Bucket = "promesa" | "agendado" | "enfriado";
const PRIORIDAD: Record<Bucket, number> = { promesa: 0, agendado: 1, enfriado: 2 };

interface AgendaItem {
  credito_id: string;
  credito_numero: number | null;
  /** N° del crédito que esta refinanciación reemplaza (para mostrarlo como REF-xxxxxx). */
  credito_refinancia_a_numero: number | null;
  cliente: string;
  telefono: string | null;
  saldo_pendiente: number;
  dias_mora: number;
  promesa_monto: number | null;
  bucket: Bucket;
  motivo: string;
  fecha: Date | null;
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { dias_sin_gestion, acuerdos, fallecidos } = await getCobranzaConfig(tenantId);

  // Los acuerdos se ponen al día ANTES de armar la cola: uno que se rompió ayer tiene que
  // volver a la agenda hoy, no cuando corra el cron de la madrugada.
  await sincronizarAcuerdos({ tenantId });
  // Quien está cumpliendo un arreglo ya está gestionado. Llamarlo igual es la forma más
  // rápida de que deje de cumplirlo. Es parametrizable: hay financieras que igual llaman.
  const conAcuerdo = acuerdos.saca_de_agenda ? await creditosConAcuerdoVigente(tenantId) : new Map<string, Date>();

  const hoy = hoyComercial();
  const hoyMs = hoy.getTime();
  const finHoy = hoyMs + 86_400_000 - 1; // fin del día de hoy (AR)
  const DIA = 86_400_000;

  // Créditos activos en mora, scopeados (vendedor solo los suyos; admin todo). En mora = con
  // `proximo_pago` vencido (filtro EN VIVO, independiente del cache `dias_mora` que no se avanza
  // día a día); así un moroso nunca cobrado aparece igual en la agenda.
  const creditos = await prisma.creditos.findMany({
    where: {
      ...withTenant(tenantId),
      ...scopeCreditosVendedor({ role, vendedorId }),
      estado: { in: [...ESTADOS_VIVOS] },
      proximo_pago: { lt: hoy },
      // Un cliente fallecido no tiene gestión posible: no se le puede escribir ni llamar, y
      // su deuda está en revisión. Dejarlo en la cola sería darle al cobrador nombres sobre
      // los que no puede hacer nada. Parametrizable: hay financieras que gestionan con la
      // familia. Va DENTRO de este where —y no como una clave aparte— porque un segundo
      // `where` en el mismo objeto pisaría el filtro de tenant entero.
      ...(fallecidos.saca_de_agenda ? { cliente: { estado: { not: "fallecido" } } } : {}),
    },
    select: {
      id: true, numero: true, saldo_pendiente: true, proximo_pago: true,
      es_refinanciacion: true, refinancia_a: true,
      cliente: { select: { nombre: true, apellido: true, telefono: true, estado: true } },
    },
  });

  if (creditos.length === 0) {
    return successResponse({ items: [], totales: { promesa: 0, agendado: 0, enfriado: 0, total: 0 }, dias_sin_gestion });
  }

  // Los que son refinanciación se muestran como REF-<origen>: una sola query para todo el lote.
  const origenes = await numerosRefinanciados(tenantId, creditos);

  const ids = creditos.map((c) => c.id);
  const acciones = await prisma.acciones_cobranza.findMany({
    where: { ...withTenant(tenantId), credito_id: { in: ids } },
    select: { credito_id: true, created_at: true, proximo_contacto: true, promesa_estado: true, promesa_fecha: true, promesa_monto: true, automatico: true },
    orderBy: { created_at: "desc" },
  });

  // Acciones por crédito (ya vienen desc por created_at → find() devuelve la más reciente).
  const porCredito = new Map<string, typeof acciones>();
  for (const a of acciones) {
    const arr = porCredito.get(a.credito_id) ?? [];
    arr.push(a);
    porCredito.set(a.credito_id, arr);
  }

  const items: AgendaItem[] = [];
  for (const c of creditos) {
    /**
     * Acuerdo vigente = ya está gestionado… PERO solo por lo que entró al acuerdo.
     *
     * 🔴 Antes salía de la cola sin condición. Un cliente podía cumplir su arreglo al día y
     * al mismo tiempo dejar de pagar las cuotas corrientes del crédito —que no eran parte
     * del trato— y no lo veía nadie: deuda creciendo, invisible, hasta que el acuerdo
     * terminara. Y ahora esas cuotas además devengan punitorios (`topeMoraDeCuota`), así que
     * el agujero era peor.
     *
     * Se lo saca de la cola solo si lo más viejo que debe ya estaba vencido al acordar. Si
     * arrastra una cuota que venció DESPUÉS, vuelve: cumple el arreglo, pero alguien tiene
     * que llamarlo por lo otro. Decisión del usuario (2026-08-20).
     */
    const acordadoEl = conAcuerdo.get(c.id);
    if (acordadoEl && c.proximo_pago && c.proximo_pago.getTime() <= acordadoEl.getTime()) continue;
    const accs = porCredito.get(c.id) ?? [];
    const promesaPend = accs.find((a) => a.promesa_estado === "pendiente" && a.promesa_fecha);
    const conProx = accs.find((a) => a.proximo_contacto);
    const ultimaHumana = accs.find((a) => !a.automatico);

    let bucket: Bucket | null = null;
    let fecha: Date | null = null;
    let motivo = "";

    if (promesaPend?.promesa_fecha && promesaPend.promesa_fecha.getTime() <= finHoy) {
      bucket = "promesa"; fecha = promesaPend.promesa_fecha; motivo = "Promesa de pago vencida";
    } else if (conProx?.proximo_contacto && conProx.proximo_contacto.getTime() <= finHoy) {
      bucket = "agendado"; fecha = conProx.proximo_contacto; motivo = "Contacto agendado";
    } else {
      const dias = ultimaHumana ? Math.floor((hoyMs - ultimaHumana.created_at.getTime()) / DIA) : Infinity;
      if (dias >= dias_sin_gestion) {
        bucket = "enfriado";
        fecha = ultimaHumana?.created_at ?? null;
        motivo = ultimaHumana ? `Sin gestión hace ${dias} días` : "Nunca gestionado";
      }
    }

    if (!bucket) continue;
    items.push({
      credito_id: c.id,
      credito_numero: c.numero,
      credito_refinancia_a_numero: c.es_refinanciacion && c.refinancia_a ? origenes.get(c.refinancia_a) ?? null : null,
      cliente: nombreCompleto(c.cliente),
      telefono: c.cliente?.telefono ?? null,
      saldo_pendiente: c.saldo_pendiente,
      dias_mora: diasMoraActual(c.proximo_pago, hoy),
      promesa_monto: bucket === "promesa" ? (promesaPend?.promesa_monto ?? null) : null,
      bucket,
      motivo,
      fecha,
    });
  }

  items.sort((a, b) => PRIORIDAD[a.bucket] - PRIORIDAD[b.bucket] || b.dias_mora - a.dias_mora);

  const totales = {
    promesa: items.filter((i) => i.bucket === "promesa").length,
    agendado: items.filter((i) => i.bucket === "agendado").length,
    enfriado: items.filter((i) => i.bucket === "enfriado").length,
    total: items.length,
  };

  return successResponse({ items, totales, dias_sin_gestion });
});
