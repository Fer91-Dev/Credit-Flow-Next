import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import type { Role } from "@/lib/auth/roles";
import { getCobranzaConfig, getConfiguracion } from "@/lib/config";
import { sincronizarAcuerdos, creditosConAcuerdoVigente, cubiertoPorAcuerdo } from "@/lib/acuerdos";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import {
  diasMoraActual, ESTADOS_VIVOS, calcularDeudaVencida, moraDelCredito, moraDesdeCronograma,
  contactoBloqueado, round2, type CuotaParaImputar,
} from "@/lib/domain";
import { nombreCompleto, hoyComercial, formatMonto } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/planilla
 *
 * PLANILLA DE COBRANZA EN CALLE: la lista que se imprime y se le da al cobrador para hacer
 * el recorrido, agrupada por zona.
 *
 * 🔴 POR QUÉ EXISTE Y POR QUÉ ES DE PAPEL
 *
 * El cobrador de Silvio NO usa el sistema: sale a la calle con una lista y vuelve con la
 * plata. Hasta ahora esa lista se armaba a mano, con lo cual los importes que se le
 * reclamaban al cliente en la puerta no salían del motor —o sea, no coincidían con la ficha,
 * ni con lo que la caja iba a imputar después—. Esto la genera desde la misma fuente que
 * todo lo demás.
 *
 * `clientes.zona` ya existía y no lo usaba nadie en Cobranzas. Un recorrido se organiza
 * geográficamente: sin agrupar por zona, la planilla es una lista alfabética que obliga a
 * cruzar el barrio cuatro veces.
 *
 * ⚠️ LÍMITE CONOCIDO: los importes son los del día que se imprime. La mora corre por día,
 * así que una planilla impresa el lunes y usada el jueves pide de menos. Por eso la fecha va
 * grande en el encabezado y el documento la repite en cada página. El descuadre se resuelve
 * solo al cargar el pago: el motor recalcula contra la deuda real de ese momento e imputa lo
 * que entró. Lo que NO existe todavía es el arqueo de lo que el cobrador trajo contra lo que
 * se cargó — eso es una pieza aparte.
 */

/**
 * Una fila de la planilla: UN CRÉDITO, no un cliente.
 *
 * Alguien con tres créditos son tres renglones —cada uno con su importe y su recibo, que es
 * como se cobra y como se imputa después—. El orden por domicilio los deja pegados, así que
 * el cobrador toca una sola puerta. Por eso los totales cuentan las dos cosas por separado:
 * decir "18 clientes" cuando son 18 créditos de 15 personas es un número falso.
 */
interface FilaPlanilla {
  credito_id: string;
  cliente_id: string;
  cliente: string;
  documento: string | null;
  direccion: string | null;
  telefono: string | null;
  credito_numero: number | null;
  credito_refinancia_a_numero: number | null;
  /** Lo exigible hoy: cuotas vencidas impagas + punitorios. 0 si todavía no venció nada. */
  vencido: number;
  cuotas_vencidas: number;
  /** N° de la cuota vencida más vieja: la que el cliente tiene que reconocer en su plan. */
  cuota_desde: number | null;
  dias_mora: number;
  /** Primera cuota impaga (vencida o no) — lo que se cobra en una visita de rutina. */
  proxima_cuota_nro: number | null;
  proxima_cuota_monto: number | null;
  proxima_cuota_fecha: Date | null;
  /** Lo que el cobrador tiene que pedir: lo vencido, o la cuota que está por vencer. */
  a_cobrar: number;
}

/** Contexto de quién pide la planilla (para el scoping anti-IDOR del vendedor). */
interface CtxPlanilla { tenantId: string; role: Role; vendedorId: string | null }

/**
 * Arma el recorrido. **UNA sola definición**, la usan la vista previa (GET) y la emisión
 * (POST): si cada una calculara lo suyo, el papel que sale impreso podría decir un importe
 * distinto del que se vio en pantalla al apretar Imprimir — y el que queda registrado como
 * "esperado" sería un tercer número. Es el mismo error de dos fórmulas que ya costó caro en
 * los acuerdos y en las campañas.
 */
async function armarPlanilla(
  { tenantId, role, vendedorId }: CtxPlanilla,
  opts: { diasAdelante: number; zonasPedidas: string[] },
) {
  const { diasAdelante, zonasPedidas } = opts;
  const { acuerdos, fallecidos } = await getCobranzaConfig(tenantId);
  const config = await getConfiguracion(tenantId);

  // Igual que la agenda: los acuerdos se ponen al día ANTES de decidir a quién visitar.
  await sincronizarAcuerdos({ tenantId });
  const conAcuerdo = acuerdos.saca_de_agenda ? await creditosConAcuerdoVigente(tenantId) : new Map<string, Date>();

  const hoy = hoyComercial();
  const corte = new Date(hoy.getTime() + diasAdelante * 86_400_000);

  const creditos = await prisma.creditos.findMany({
    where: {
      ...withTenant(tenantId),
      ...scopeCreditosVendedor({ role, vendedorId }),
      estado: { in: [...ESTADOS_VIVOS] },
      // `lt` sobre el corte: con `dias_adelante` en 0 es exactamente el filtro de la agenda.
      proximo_pago: { lt: corte },
      /**
       * Una visita a domicilio ES un contacto — el más invasivo de todos. Los mismos cortes
       * que el WhatsApp: `no_contactar` siempre, fallecidos según la política del tenant.
       * Va DENTRO de este `where`: un segundo `where` pisaría el filtro de tenant entero.
       */
      cliente: {
        no_contactar: false,
        ...(fallecidos.saca_de_agenda ? { estado: { not: "fallecido" } } : {}),
      },
    },
    select: {
      id: true, numero: true, proximo_pago: true, cronograma: true, cliente_id: true,
      es_refinanciacion: true, refinancia_a: true,
      cliente: {
        select: {
          nombre: true, apellido: true, documento: true, telefono: true,
          direccion: true, piso: true, depto: true, localidad: true, zona: true,
        },
      },
      cuotas: { orderBy: { nro: "asc" } },
    },
  });

  const origenes = await numerosRefinanciados(tenantId, creditos);

  /** Domicilio en una línea, que es como se lee caminando. */
  const domicilio = (c: { direccion: string | null; piso: string | null; depto: string | null; localidad: string | null }) => {
    const calle = c.direccion?.trim();
    if (!calle) return null;
    const unidad = [c.piso?.trim(), c.depto?.trim()].filter(Boolean).join(" ");
    return [calle, unidad ? `(${unidad})` : null, c.localidad?.trim()].filter(Boolean).join(" · ");
  };

  const porZona = new Map<string, FilaPlanilla[]>();

  for (const c of creditos) {
    if (cubiertoPorAcuerdo(conAcuerdo, c.id, c.proximo_pago)) continue;
    if (!c.cliente) continue;

    const zona = c.cliente.zona?.trim() || "";
    const clave = zona || "__sin__";
    if (zonasPedidas.length > 0 && !zonasPedidas.includes(clave)) continue;

    const cuotasDom: CuotaParaImputar[] = c.cuotas.map((q) => ({
      id: q.id, nro: q.nro, fechaVencimiento: q.fecha_vencimiento,
      capital: q.capital, interes: q.interes, cargos: round2(q.iva + q.seguro + q.gastos),
      cuotaTotal: q.cuota_total,
      pagadoCapital: q.pagado_capital, pagadoInteres: q.pagado_interes,
      pagadoMora: q.pagado_mora, pagadoCargos: q.pagado_cargos,
    }));
    // Condiciones de mora CONGELADAS en el crédito, no las de hoy: el papel que el cliente
    // tiene en la mano tiene que decir lo mismo que su ficha y que la caja.
    const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
    const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
    const dv = calcularDeudaVencida(cuotasDom, {
      moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct,
      diasGracia: gracia, hoy,
    });

    // Primera cuota impaga del plan: la vencida más vieja si hay atraso, o la que viene.
    const impaga = c.cuotas.find((q) => q.pagado_capital < q.capital) ?? null;
    const cuotaDesde = dv.cuotas_vencidas > 0 ? impaga?.nro ?? null : null;

    /**
     * Lo que se pide en la puerta. Si hay algo vencido es ESO —capital, interés, cargos y
     * punitorios de las cuotas atrasadas—; si el cliente está al día y la visita es de
     * rutina, la cuota que está por vencer, a su valor nominal del plan (sin punitorios,
     * porque todavía no debe nada).
     */
    const aCobrar = dv.total > 0 ? round2(dv.total) : round2(impaga?.cuota_total ?? 0);
    if (aCobrar <= 0) continue; // nada que ir a buscar

    const fila: FilaPlanilla = {
      credito_id: c.id,
      cliente_id: c.cliente_id,
      cliente: nombreCompleto(c.cliente),
      documento: c.cliente.documento ?? null,
      direccion: domicilio(c.cliente),
      telefono: c.cliente.telefono ?? null,
      credito_numero: c.numero,
      credito_refinancia_a_numero: c.es_refinanciacion && c.refinancia_a ? origenes.get(c.refinancia_a) ?? null : null,
      vencido: round2(dv.total),
      cuotas_vencidas: dv.cuotas_vencidas,
      cuota_desde: cuotaDesde,
      dias_mora: diasMoraActual(c.proximo_pago, hoy),
      proxima_cuota_nro: impaga?.nro ?? null,
      proxima_cuota_monto: round2(impaga?.cuota_total ?? 0),
      proxima_cuota_fecha: impaga?.fecha_vencimiento ?? null,
      a_cobrar: aCobrar,
    };

    const arr = porZona.get(clave) ?? [];
    arr.push(fila);
    porZona.set(clave, arr);
  }

  /**
   * Dentro de cada zona, por DOMICILIO: la planilla la usa alguien que camina, y el orden
   * útil es el que agrupa las puertas cercanas, no el que ordena por plata. Los que no
   * tienen dirección cargada van al final — no se los puede visitar, pero sí llamar.
   */
  const zonas = [...porZona.entries()]
    .map(([clave, filas]) => ({
      zona: clave === "__sin__" ? null : clave,
      filas: filas.sort((a, b) =>
        (a.direccion ? 0 : 1) - (b.direccion ? 0 : 1) ||
        (a.direccion ?? "").localeCompare(b.direccion ?? "", "es") ||
        a.cliente.localeCompare(b.cliente, "es"),
      ),
      creditos: filas.length,
      clientes: new Set(filas.map((f) => f.cliente_id)).size,
      total: round2(filas.reduce((s, f) => s + f.a_cobrar, 0)),
    }))
    // "Sin zona" siempre al final: es el grupo de los que hay que ir a completar la ficha.
    .sort((a, b) => (a.zona ? 0 : 1) - (b.zona ? 0 : 1) || (a.zona ?? "").localeCompare(b.zona ?? "", "es"));

  return {
    fecha: hoy,
    dias_adelante: diasAdelante,
    zonas,
    totales: {
      // Los clientes se cuentan sobre el conjunto, no sumando zonas: el mismo titular puede
      // tener créditos en dos zonas y sumarlo dos veces inflaría el número.
      clientes: new Set(zonas.flatMap((z) => z.filas.map((f) => f.cliente_id))).size,
      creditos: zonas.reduce((s, z) => s + z.creditos, 0),
      total: round2(zonas.reduce((s, z) => s + z.total, 0)),
      zonas: zonas.length,
    },
  };
}

/** Lee los parámetros del recorrido de la query string, acotados. */
function opcionesDe(req: NextRequest) {
  const url = new URL(req.url);
  /**
   * Cuántos días PARA ADELANTE entran en la planilla.
   *
   * 0 = solo lo vencido (planilla de recupero). Un número mayor suma los que vencen dentro
   * de esa ventana, que es el recorrido de rutina del crédito de barrio: el cobrador pasa
   * por la semana a buscar la cuota, no solo cuando el cliente ya se atrasó. Se acota a
   * 0..90 para que un parámetro raro no traiga la cartera entera.
   */
  const diasAdelante = Math.min(90, Math.max(0, Math.round(Number(url.searchParams.get("dias_adelante")) || 0)));
  /** Zonas pedidas (vacío = todas). "__sin__" es el grupo de los que no tienen zona cargada. */
  const zonasPedidas = (url.searchParams.get("zonas") ?? "")
    .split(",")
    .map((z) => z.trim())
    .filter(Boolean);
  return { diasAdelante, zonasPedidas };
}

/**
 * GET — vista previa del recorrido. No persiste nada: es lo que el diálogo muestra mientras
 * el operador elige zonas.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return successResponse(await armarPlanilla(ctx, opcionesDe(req)));
});

/**
 * POST — EMITE la planilla: la arma, la registra y la devuelve para imprimir.
 *
 * 🔴 El recorrido se RECALCULA acá, no se acepta el que mandó el navegador. Lo que queda
 * grabado como "esperado" es lo que el motor dice hoy: si se confiara en el cliente,
 * bastaría editar la request para registrar una planilla por un importe menor y que la
 * rendición cerrara sola con plata faltante.
 *
 * Body: { cobrador?: string }. Las zonas y los días van en la query, igual que en el GET.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const cobrador = typeof body?.cobrador === "string" ? body.cobrador.trim().slice(0, 60) : "";

  const armada = await armarPlanilla(ctx, opcionesDe(req));
  if (armada.totales.creditos === 0) {
    return errorResponse("No hay nadie para visitar con esos filtros.", "SIN_OBJETIVOS", 400);
  }

  const planilla = await prisma.planillas_cobranza.create({
    data: {
      ...withTenant(ctx.tenantId),
      fecha: armada.fecha,
      cobrador: cobrador || null,
      // Lo que se guarda es lo que el recorrido REALMENTE incluyó, no lo que se pidió: con
      // "todas" el pedido llega vacío y después nadie sabría qué zonas salieron a la calle.
      zonas: armada.zonas.map((z) => z.zona ?? "__sin__"),
      dias_adelante: armada.dias_adelante,
      total_esperado: armada.totales.total,
      clientes: armada.totales.clientes,
      creditos: armada.totales.creditos,
      /**
       * El snapshot de las filas impresas. Los punitorios corren por día, así que mañana el
       * mismo recorrido daría otros importes: sin congelar lo que decía el papel, la
       * rendición no cerraría nunca y la carga de cobros se haría contra otra cosa.
       */
      detalle: armada.zonas as unknown as Prisma.InputJsonValue,
      emitida_por: ctx.userId,
      emitida_por_nombre: ctx.nombre ?? null,
    },
    select: { id: true, fecha: true, cobrador: true },
  });

  await registrarAuditoria({
    tenantId: ctx.tenantId,
    entidad: "planilla",
    entidadId: planilla.id,
    accion: "crear",
    descripcion:
      `Planilla de calle emitida${cobrador ? ` para ${cobrador}` : ""}: ` +
      `${armada.totales.creditos} crédito${armada.totales.creditos === 1 ? "" : "s"} de ` +
      `${armada.totales.clientes} cliente${armada.totales.clientes === 1 ? "" : "s"} ` +
      `por ${formatMonto(armada.totales.total)}`,
    meta: {
      planilla_id: planilla.id,
      zonas: armada.zonas.map((z) => z.zona ?? "(sin zona)"),
      dias_adelante: armada.dias_adelante,
      total_esperado: armada.totales.total,
    },
  });

  return successResponse({ ...armada, planilla_id: planilla.id, cobrador: planilla.cobrador }, 201);
});
