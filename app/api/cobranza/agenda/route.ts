import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getCobranzaConfig, getConfiguracion } from "@/lib/config";
import { sincronizarAcuerdos, creditosConAcuerdoVigente, cubiertoPorAcuerdo } from "@/lib/acuerdos";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import { cobroBloqueadoPorCredito } from "@/lib/recupero-server";
import {
  diasMoraActual, ESTADOS_VIVOS, calcularDeudaVencida, moraDelCredito, moraDesdeCronograma,
  round2, type CuotaParaImputar, cargosDeCuota, baseMoraDeCuota } from "@/lib/domain";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/agenda
 * "Agenda del día" de cobranza: cola priorizada de a quién contactar hoy, SCOPEADA al vendedor
 * (admin ve todo). Junta 3 fuentes de la cartera en mora y las clasifica en buckets:
 *  - promesa:  promesa de pago pendiente vencida (o de hoy) sin cumplir.
 *  - agendado: gestión con "próximo contacto" para hoy o vencido.
 *  - enfriado: moroso sin gestión humana en `dias_sin_gestion` días (parametrizable en Config).
 * Prioridad: promesa → agendado → enfriado; dentro de cada uno, según `cobranza.orden`
 * (días de atraso o plata vencida — parametrizable en Config).
 */
/**
 * Los grupos de la cola, en orden de urgencia. Fernando (18/09/2026): "los créditos con
 * acuerdo de pago vencido no los prioriza en Hoy". Antes un acuerdo VIGENTE sacaba al
 * crédito de la agenda sin mirar si el cliente estaba pagando las cuotas del acuerdo, y un
 * acuerdo recién ROTO volvía a la cola solo cuando pasaban los días de "sin gestión". Ahora:
 *  - acuerdo_vencido: el acuerdo sigue vigente pero una cuota suya ya venció impaga. Es el
 *    llamado más urgente que existe: todavía se puede salvar el arreglo.
 *  - acuerdo_roto: se cayó y nadie lo gestionó desde entonces. Hay que llamar hoy.
 */
type Bucket = "acuerdo_vencido" | "promesa" | "acuerdo_roto" | "agendado" | "enfriado";
const PRIORIDAD: Record<Bucket, number> = { acuerdo_vencido: 0, promesa: 1, acuerdo_roto: 2, agendado: 3, enfriado: 4 };

interface AgendaItem {
  credito_id: string;
  /** Titular. Lo necesita el botón de WhatsApp, que contacta por el endpoint de la ficha. */
  cliente_id: string;
  credito_numero: number | null;
  /** N° del crédito que esta refinanciación reemplaza (para mostrarlo como REF-xxxxxx). */
  credito_refinancia_a_numero: number | null;
  cliente: string;
  telefono: string | null;
  /** Capital pendiente del crédito. Se conserva como referencia, NO es lo que se reclama. */
  saldo_pendiente: number;
  /** Lo EXIGIBLE hoy: cuotas ya vencidas impagas + punitorios. Es el número de la cobranza. */
  vencido: number;
  /** Cuántas cuotas están vencidas e impagas (para decir "debe 3 cuotas", no solo un total). */
  cuotas_vencidas: number;
  dias_mora: number;
  /**
   * El plan de este crédito ya venció y la terminal rechaza su cobro: no hay que ir a
   * reclamarle un pago, hay que invitarlo a refinanciar. Lo resuelve el server porque
   * depende también del acuerdo vigente y de los acuerdos rotos.
   */
  cobro_bloqueado: boolean;
  promesa_monto: number | null;
  /** La cuota del acuerdo que venció impaga (lo que falta pagar de ella), solo en `acuerdo_vencido`. */
  acuerdo_monto: number | null;
  bucket: Bucket;
  motivo: string;
  fecha: Date | null;
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { dias_sin_gestion, orden, acuerdos, fallecidos, recupero } = await getCobranzaConfig(tenantId);
  const config = await getConfiguracion(tenantId);

  // Los acuerdos se ponen al día ANTES de armar la cola: uno que se rompió ayer tiene que
  // volver a la agenda hoy, no cuando corra el cron de la madrugada.
  await sincronizarAcuerdos({ tenantId });
  // Quien está cumpliendo un arreglo ya está gestionado. Llamarlo igual es la forma más
  // rápida de que deje de cumplirlo. Es parametrizable: hay financieras que igual llaman.
  /**
   * Los acuerdos vigentes se leen SIEMPRE. La política decide si sacan de la COLA a quien
   * está cumpliendo; el corte de "este crédito ya no se cobra" los necesita igual, porque un
   * acuerdo vigente lo mantiene cobrable por más días de atraso que arrastre.
   */
  const acuerdosVigentes = await creditosConAcuerdoVigente(tenantId);
  const conAcuerdo = acuerdos.saca_de_agenda ? acuerdosVigentes : new Map<string, Date>();

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
      /**
       * Quién NO entra en la cola del día:
       *  - `no_contactar`: lo pidió el titular. Sale SIEMPRE — no depende de ninguna política.
       *  - fallecido: no hay gestión posible y su deuda está en revisión. Parametrizable,
       *    porque hay financieras que igual gestionan con la familia.
       *
       * Va DENTRO de este `where` y no como clave aparte: un segundo `where` en el mismo
       * objeto pisaría el filtro de tenant entero.
       */
      cliente: {
        no_contactar: false,
        ...(fallecidos.saca_de_agenda ? { estado: { not: "fallecido" } } : {}),
      },
    },
    select: {
      id: true, numero: true, saldo_pendiente: true, proximo_pago: true, cliente_id: true,
      es_refinanciacion: true, refinancia_a: true, cronograma: true,
      cliente: { select: { nombre: true, apellido: true, telefono: true, estado: true } },
      /**
       * Sin las cuotas no se puede saber qué está VENCIDO, que es lo único que se reclama en
       * una cobranza. El `saldo_pendiente` es el préstamo entero —cuotas futuras incluidas—
       * y pedirlo completo es exigir la caducidad de plazos, que no se decide desde la
       * agenda del día. Mismo criterio que campañas y acuerdos.
       */
      cuotas: { orderBy: { nro: "asc" } },
    },
  });

  if (creditos.length === 0) {
    return successResponse({ items: [], totales: { acuerdo_vencido: 0, promesa: 0, acuerdo_roto: 0, agendado: 0, enfriado: 0, total: 0, vencido: 0, con_acuerdo_al_dia: 0 }, dias_sin_gestion, orden });
  }

  /**
   * Las cuotas de acuerdo VENCIDAS de acuerdos que siguen vigentes (todavía no se rompió:
   * la financiera tolera N cuotas impagas antes de romper). Una por crédito, la más vieja.
   */
  const cuotasAcuerdoVencidas = await prisma.acuerdo_cuota.findMany({
    where: { ...withTenant(tenantId), acuerdo: { estado: "vigente", credito_id: { in: creditos.map((c) => c.id) } }, vencimiento: { lt: hoy }, estado: { not: "pagada" } },
    select: { numero: true, vencimiento: true, monto: true, pagado: true, acuerdo: { select: { credito_id: true } } },
    orderBy: { vencimiento: "asc" },
  });
  const acuerdoVencidoDe = new Map<string, { numero: number; vencimiento: Date; falta: number }>();
  for (const q of cuotasAcuerdoVencidas) {
    if (!acuerdoVencidoDe.has(q.acuerdo.credito_id)) acuerdoVencidoDe.set(q.acuerdo.credito_id, { numero: q.numero, vencimiento: q.vencimiento, falta: round2(q.monto - q.pagado) });
  }
  // El último acuerdo ROTO de cada crédito (los rotos no impiden un acuerdo nuevo: si hay uno
  // vigente después, manda el vigente).
  const rotos = await prisma.acuerdos_pago.findMany({
    where: { ...withTenant(tenantId), estado: "roto", credito_id: { in: creditos.map((c) => c.id) } },
    select: { credito_id: true, cerrado_at: true, motivo_estado: true },
    orderBy: { cerrado_at: "desc" },
  });
  const rotoDe = new Map<string, { cerrado_at: Date; motivo: string | null }>();
  for (const r of rotos) if (r.cerrado_at && !rotoDe.has(r.credito_id)) rotoDe.set(r.credito_id, { cerrado_at: r.cerrado_at, motivo: r.motivo_estado });

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
  let conAcuerdoAlDia = 0;
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
     *
     * La regla vive en `cubiertoPorAcuerdo` porque la planilla de calle decide lo mismo.
     */
    const acuerdoVencido = acuerdoVencidoDe.get(c.id) ?? null;
    // Cubierto por un acuerdo vigente Y al día: no se lo llama (contarlo, sí: la agenda dice
    // cuántos hay para que no parezca que se los olvidó).
    if (!acuerdoVencido && cubiertoPorAcuerdo(conAcuerdo, c.id, c.proximo_pago)) { conAcuerdoAlDia++; continue; }
    const accs = porCredito.get(c.id) ?? [];
    const promesaPend = accs.find((a) => a.promesa_estado === "pendiente" && a.promesa_fecha);
    const conProx = accs.find((a) => a.proximo_contacto);
    const ultimaHumana = accs.find((a) => !a.automatico);
    const roto = acuerdosVigentes.has(c.id) ? null : rotoDe.get(c.id) ?? null;
    const rotoSinGestionar = !!roto && (!ultimaHumana || ultimaHumana.created_at.getTime() < roto.cerrado_at.getTime());

    let bucket: Bucket | null = null;
    let fecha: Date | null = null;
    let motivo = "";

    if (acuerdoVencido) {
      bucket = "acuerdo_vencido"; fecha = acuerdoVencido.vencimiento; motivo = `Cuota ${acuerdoVencido.numero} del acuerdo vencida`;
    } else if (promesaPend?.promesa_fecha && promesaPend.promesa_fecha.getTime() <= finHoy) {
      bucket = "promesa"; fecha = promesaPend.promesa_fecha; motivo = "Promesa de pago vencida";
    } else if (rotoSinGestionar && roto) {
      bucket = "acuerdo_roto"; fecha = roto.cerrado_at; motivo = roto.motivo ? `Acuerdo roto: ${roto.motivo.replace(/^Incumplió/, "incumplió")}` : "Acuerdo roto";
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

    /**
     * Lo exigible HOY. Se calcula con las condiciones de mora congeladas en el crédito
     * (`moraDelCredito` sobre su propio cronograma), no con la config actual: un crédito
     * otorgado antes del techo de mora no cambia de deuda porque hoy se configure uno.
     */
    const cuotasDom: CuotaParaImputar[] = c.cuotas.map((q) => ({
      id: q.id, nro: q.nro, fechaVencimiento: q.fecha_vencimiento,
      capital: q.capital, interes: q.interes, cargos: cargosDeCuota(q),
      baseMora: baseMoraDeCuota(q),
      pagadoCapital: q.pagado_capital, pagadoInteres: q.pagado_interes,
      pagadoMora: q.pagado_mora, pagadoCargos: q.pagado_cargos,
      condonadoMora: q.condonado_mora,
    }));
    const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
    const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
    const dv = calcularDeudaVencida(cuotasDom, {
      moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct,
      diasGracia: gracia, hoy,
    });

    items.push({
      credito_id: c.id,
      cliente_id: c.cliente_id,
      credito_numero: c.numero,
      credito_refinancia_a_numero: c.es_refinanciacion && c.refinancia_a ? origenes.get(c.refinancia_a) ?? null : null,
      cliente: nombreCompleto(c.cliente),
      telefono: c.cliente?.telefono ?? null,
      saldo_pendiente: c.saldo_pendiente,
      vencido: round2(dv.total),
      cuotas_vencidas: dv.cuotas_vencidas,
      dias_mora: diasMoraActual(c.proximo_pago, hoy),
      cobro_bloqueado: false, // se completa abajo, con una sola consulta para todo el lote
      promesa_monto: bucket === "promesa" ? (promesaPend?.promesa_monto ?? null) : null,
      acuerdo_monto: bucket === "acuerdo_vencido" ? acuerdoVencido?.falta ?? null : null,
      bucket,
      motivo,
      fecha,
    });
  }

  /**
   * ¿Cuáles de estos ya no se cobran? Una sola consulta agrupada para toda la cola, después
   * de armarla: llamar a alguien a reclamarle un pago que la terminal va a rechazar es la
   * misma promesa vacía que ya apareció en las campañas y en la planilla de calle, pero en la
   * pantalla que el vendedor usa todos los días.
   */
  const bloqueados = await cobroBloqueadoPorCredito(
    tenantId,
    items.map((it) => ({
      id: it.credito_id,
      diasMora: it.dias_mora,
      acuerdoVigente: acuerdosVigentes.has(it.credito_id),
    })),
    recupero,
  );
  for (const it of items) it.cobro_bloqueado = bloqueados.get(it.credito_id) ?? false;

  /**
   * El GRUPO manda siempre (promesa → agendado → enfriado): eso es urgencia, no preferencia.
   * Adentro de cada grupo ordena el criterio configurado.
   *
   * 🔴 Por qué es un parámetro y no una decisión fija: ordenar por días de atraso deja al
   * final al que más plata debe. Una deuda de $8.000 con 200 días le ganaba a una de
   * $500.000 con 20, y en una cola que nadie termina de llamar entera, el que queda abajo no
   * se llama. Pero lo contrario tampoco es gratis: por monto, la deuda vieja y chica se
   * envejece sola, y cuanto más vieja menos se recupera. Cada financiera elige.
   *
   * El desempate es siempre el otro criterio, así que dos iguales no quedan en orden
   * arbitrario (que cambiaría de refresco en refresco).
   */
  items.sort((a, b) =>
    PRIORIDAD[a.bucket] - PRIORIDAD[b.bucket] ||
    (orden === "monto"
      ? b.vencido - a.vencido || b.dias_mora - a.dias_mora
      : b.dias_mora - a.dias_mora || b.vencido - a.vencido),
  );

  const totales = {
    acuerdo_vencido: items.filter((i) => i.bucket === "acuerdo_vencido").length,
    promesa: items.filter((i) => i.bucket === "promesa").length,
    acuerdo_roto: items.filter((i) => i.bucket === "acuerdo_roto").length,
    agendado: items.filter((i) => i.bucket === "agendado").length,
    enfriado: items.filter((i) => i.bucket === "enfriado").length,
    total: items.length,
    /** Morosos con acuerdo vigente y al día: no están en la cola, y se dice cuántos son. */
    con_acuerdo_al_dia: conAcuerdoAlDia,
    /** Plata exigible que hay en la cola del día, para saber qué está en juego. */
    vencido: round2(items.reduce((s, i) => s + i.vencido, 0)),
  };

  return successResponse({ items, totales, dias_sin_gestion, orden });
});
