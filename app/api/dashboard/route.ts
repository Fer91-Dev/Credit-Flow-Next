import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { diasMoraActual, severidadMora, ESTADOS_VIVOS, esCreditoVivo } from "@/lib/domain";
import { getCobranzaConfig } from "@/lib/config";
import { hoyComercial } from "@/lib/utils";
import { nombrePropioFinanciera } from "@/lib/branding";
import type { NextRequest } from "next/server";

/**
 * GET /api/dashboard
 * Agregados financieros para el panel de control.
 *
 * Filtros globales opcionales (query):
 *  - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — rango para el avance de cobranzas (default: mes en curso)
 *  - ?vendedor_id=uuid — limita los créditos a los otorgados por ese vendedor
 *  - ?zona=string — limita a los créditos de clientes de esa zona
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId: miVendedorId } = await requireAuth(req);

  const url = new URL(req.url);
  const vendedorParam = url.searchParams.get("vendedor_id");
  const zona = url.searchParams.get("zona");

  // Anti-IDOR: si quien consulta es vendedor, se fuerza su propio vendedor_id e
  // ignora el query param (no puede ver agregados de otro vendedor). Sin vendedor
  // asignado → sentinel imposible (no ve nada). Admin/cobrador ven todo el tenant.
  const vendedorId =
    role === "vendedor" ? (miVendedorId ?? "00000000-0000-0000-0000-000000000000") : vendedorParam;
  const desdeStr = url.searchParams.get("desde");
  const hastaStr = url.searchParams.get("hasta");

  // Rango del avance de cobranzas: el indicado o, por defecto, el mes en curso.
  const ahora = new Date();
  const desde = desdeStr ? new Date(`${desdeStr}T00:00:00.000Z`) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const hasta = hastaStr
    ? new Date(`${hastaStr}T23:59:59.999Z`)
    : new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);

  // Filtro de créditos por vendedor y/o zona del cliente (se reutiliza en varias queries).
  const creditoFiltro: Record<string, unknown> = { ...withTenant(tenantId) };
  if (vendedorId) creditoFiltro.vendedor_id = vendedorId;
  if (zona) creditoFiltro.cliente = { zona };

  // Filtro equivalente para queries que llegan a créditos vía relación (cuotas, pagos).
  const tieneFiltroCredito = !!vendedorId || !!zona;
  const creditoRel: Record<string, unknown> = {};
  if (vendedorId) creditoRel.vendedor_id = vendedorId;
  if (zona) creditoRel.cliente = { zona };

  // El desglose por vendedor (rendimiento + morosidad) es solo para admin.
  const esAdmin = role === "admin";

  const [clientes, creditos, pagosTotal, cuotasPeriodo, cuotasVivas, pagosHoy, personal, cobranzaCfg] = await Promise.all([
    // Clientes activos (filtra por zona si corresponde)
    prisma.clientes.count({
      where: { ...withTenant(tenantId), estado: { in: [...ESTADOS_VIVOS] }, ...(zona ? { zona } : {}) },
    }),

    // Créditos (con filtro de vendedor/zona)
    prisma.creditos.findMany({
      where: creditoFiltro as never,
      select: {
        id: true,
        estado: true,
        monto_original: true,
        saldo_pendiente: true,
        dias_mora: true,
        proximo_pago: true,
        vendedor_id: true,
        es_refinanciacion: true,
        // Para contar CUÁNTOS clientes están prestando ahora mismo. Sale de esta query, que ya
        // se hace: un cliente con tres créditos es UNO, así que un count no serviría.
        cliente_id: true,
      },
    }),

    // Pagos del período (filtra por fecha y por crédito si hay filtro)
    prisma.pagos.aggregate({
      where: {
        ...withTenant(tenantId),
        anulado: false,
        ...(tieneFiltroCredito ? { credito: creditoRel as never } : {}),
      },
      _sum: { monto: true },
      _count: true,
    }),

    // Cuotas que vencen en el período (esperado vs cobrado).
    // Trae el vendedor del crédito: es lo que permite abrir el avance de cobranzas POR
    // vendedor sin una segunda consulta. El período es un mes, no una tabla entera.
    prisma.cuotas.findMany({
      where: {
        ...withTenant(tenantId),
        fecha_vencimiento: { gte: desde, lte: hasta },
        ...(tieneFiltroCredito ? { credito: creditoRel as never } : {}),
      },
      select: { cuota_total: true, pagado: true, credito: { select: { vendedor_id: true, estado: true } } },
    }),

    /**
     * LO QUE FALTA COBRAR de todos los créditos VIVOS: capital + interés + cargos que
     * todavía no entraron. Es el complemento de "capital en la calle": la calle dice cuánta
     * plata salió y no volvió, esto dice cuánta va a volver si todos pagan.
     *
     * No incluye punitorios: la mora se devenga día a día y ya tiene su propio bloque
     * ("Exposición en mora"). Meterla acá haría que el número se moviera solo cada noche sin
     * que nadie hubiera prestado ni cobrado nada.
     */
    prisma.cuotas.findMany({
      where: {
        ...withTenant(tenantId),
        credito: { ...creditoRel, estado: { in: [...ESTADOS_VIVOS] } } as never,
      },
      select: { cuota_total: true, pagado: true },
    }),

    // Movimiento de HOY (día comercial argentino): lo que entró y lo que se colocó.
    // Es el pulso que Silvio mira en vivo; sale de los mismos libros que todo lo demás.
    prisma.pagos.aggregate({
      where: {
        ...withTenant(tenantId),
        anulado: false,
        fecha: { gte: hoyComercial() },
        ...(tieneFiltroCredito ? { credito: creditoRel as never } : {}),
      },
      _sum: { monto: true },
      _count: true,
    }),

    // Personal del tenant (solo admin; sirve para nombrar el desglose por vendedor)
    esAdmin
      ? prisma.vendedores.findMany({
          where: { ...withTenant(tenantId) },
          select: { id: true, nombre: true },
        })
      : Promise.resolve([] as { id: string; nombre: string }[]),
    getCobranzaConfig(tenantId),
  ]);
  // Dónde corta cada tramo de mora, según lo definió la financiera.
  const tramos = cobranzaCfg.tramos_mora;

  // Mora EN VIVO desde `proximo_pago` (el cache `dias_mora` no se avanza día a día): misma
  // fórmula con la que se persiste, pero evaluada hoy → los KPIs de mora no dependen del cron.
  const hoy = hoyComercial();
  const creditosDM = creditos.map((c) => ({
    ...c,
    dias_mora: c.proximo_pago ? diasMoraActual(c.proximo_pago, hoy) : c.dias_mora,
  }));

  const creditosActivos = creditosDM.filter((c) => esCreditoVivo(c.estado)).length;
  /*
    Clientes que HOY tienen plata prestada. Distinto de `clientes_activos`, que son todas las
    fichas vivas: de 103 clientes puede haber 14 prestando y 89 que ya cancelaron o nunca
    tomaron nada. `Set` y no un count, porque un cliente con tres créditos es un solo cliente.
  */
  const clientesConCredito = new Set(
    creditosDM.filter((c) => esCreditoVivo(c.estado)).map((c) => c.cliente_id),
  ).size;
  const creditosPagados = creditosDM.filter((c) => c.estado === "pagado").length;
  /**
   * 🔴 Solo créditos VIVOS. Sumaba TODOS, así que la cartera del Home incluía el saldo de los
   * anulados: $14.371.741,22 contra los $11.721.741,22 que informaba Reportes, un 22,6% de
   * más sobre el número principal de la pantalla principal.
   *
   * El fix de `anular` (que ahora deja el saldo en 0) ya lo corregiría solo, pero el filtro va
   * igual: un KPI de plata no puede depender de que el dato esté prolijo. Es el mismo criterio
   * que `saldo_activo_total` en Reportes.
   */
  const carteraTotal = creditosDM.filter((c) => esCreditoVivo(c.estado)).reduce((sum, c) => sum + c.saldo_pendiente, 0);
  // Los tramos de la financiera, no los que estaban escritos acá (30/60) mientras Reportes
  // usaba otros (15/30). Ver `severidadMora`: es la única definición.
  const moraCritica = creditosDM.filter((c) => severidadMora(c.dias_mora, tramos) === "critica").length;

  const detalleMotaAlerta = {
    // La distribución pasa a ser la MISMA que la de Reportes: media / alta / crítica, con los
    // cortes de la config. Antes eran tramos propios (1-30 / 31-60 / +60) que no coincidían
    // con ninguna otra pantalla.
    media: creditosDM.filter((c) => severidadMora(c.dias_mora, tramos) === "media").length,
    alta: creditosDM.filter((c) => severidadMora(c.dias_mora, tramos) === "alta").length,
    critica: moraCritica,
  };

  const cobranzaEsperado = cuotasPeriodo.reduce((sum, c) => sum + c.cuota_total, 0);
  const cobranzaCobrado = cuotasPeriodo.reduce(
    (sum, c) => sum + Math.min(c.pagado, c.cuota_total),
    0
  );

  /**
   * Lo que falta cobrar de los créditos vivos. `Math.max(0, …)` porque un cobro con excedente
   * deja `pagado` por encima de la cuota y, sin el corte, esa cuota restaría del total.
   */
  const aCobrarTotal = cuotasVivas.reduce((s, c) => s + Math.max(0, c.cuota_total - c.pagado), 0);

  const montosMora = {
    total_mora: creditosDM
      .filter((c) => c.dias_mora > 0)
      .reduce((sum, c) => sum + c.saldo_pendiente, 0),
    // Mismo corte que el conteo de arriba: si el monto usara 30 fijo y el conteo el tramo
    // configurado, la tarjeta diría "3 créditos · $X" con un X que no es de esos 3.
    mora_critica: creditosDM
      .filter((c) => severidadMora(c.dias_mora, tramos) === "critica")
      .reduce((sum, c) => sum + c.saldo_pendiente, 0),
  };

  // ── Rendimiento + morosidad por vendedor (solo admin) ──────────────────────
  // Agrega los créditos (ya filtrados por zona/fecha) por vendedor_id. La cartera
  // y la mora son del saldo pendiente; la morosidad % = saldo en mora / cartera.
  let porVendedor: PorVendedor[] | undefined;
  if (esAdmin) {
    const SIN_ASIGNAR = "sin_asignar";
    // Solo se consulta si hay créditos de la casa; si todos tienen vendedor, no hace falta.
    const nombreCasa = creditosDM.some((c) => !c.vendedor_id)
      ? await nombrePropioFinanciera(tenantId)
      : "La financiera";
    const nombrePorId = new Map(personal.map((p) => [p.id, p.nombre]));
    const grupos = new Map<string, typeof creditosDM>();
    for (const c of creditosDM) {
      const key = c.vendedor_id ?? SIN_ASIGNAR;
      const arr = grupos.get(key) ?? [];
      arr.push(c);
      grupos.set(key, arr);
    }

    porVendedor = Array.from(grupos.entries())
      .map(([key, lista]) => {
        const cartera = lista.reduce((s, c) => s + c.saldo_pendiente, 0);
        const enMora = lista
          .filter((c) => c.dias_mora > 0)
          .reduce((s, c) => s + c.saldo_pendiente, 0);
        /**
         * Avance de cobranzas DE ESTE VENDEDOR en el período: de lo que le vencía, cuánto
         * entró. Es la pregunta que el Home contestaba solo para la financiera entera, así
         * que no se podía saber quién estaba tirando del número y quién lo estaba hundiendo.
         */
        const cuotasSuyas = cuotasPeriodo.filter(
          (q) => (q.credito?.vendedor_id ?? SIN_ASIGNAR) === key,
        );
        const espera = cuotasSuyas.reduce((s, q) => s + q.cuota_total, 0);
        const cobro = cuotasSuyas.reduce((s, q) => s + Math.min(q.pagado, q.cuota_total), 0);
        return {
          vendedor_id: key === SIN_ASIGNAR ? null : key,
          cobranza_esperado: espera,
          cobranza_cobrado: cobro,
          cobranza_avance_pct: espera > 0 ? Math.round((cobro / espera) * 100) : 0,
          // El nombre de la financiera y no "Sin asignar": desde que el dueño puede otorgar
          // sin elegir vendedor, esa fila es su operación propia, no un dato que falta.
          nombre: key === SIN_ASIGNAR ? nombreCasa : nombrePorId.get(key) ?? "—",
          // Otorgado: excluye anulados y refinanciaciones (no es plata nueva colocada).
          // Cartera y mora SÍ incluyen la refinanciación: es deuda viva real a cobrar.
          creditos_otorgados: lista.filter((c) => c.estado !== "anulado" && !c.es_refinanciacion).length,
          monto_otorgado: lista
            .filter((c) => c.estado !== "anulado" && !c.es_refinanciacion)
            .reduce((s, c) => s + c.monto_original, 0),
          cartera,
          en_mora_monto: enMora,
          mora_critica_count: lista.filter((c) => severidadMora(c.dias_mora, tramos) === "critica").length,
          pct_morosidad: cartera > 0 ? Math.round((enMora / cartera) * 100) : 0,
        };
      })
      // Más expuestos primero (mayor monto en mora), luego mayor cartera.
      .sort((a, b) => b.en_mora_monto - a.en_mora_monto || b.cartera - a.cartera);
  }

  return successResponse({
    resumen: {
      clientes_activos: clientes,
      /** De los activos, cuántos tienen al menos un crédito vivo. */
      clientes_con_credito: clientesConCredito,
      creditos_activos: creditosActivos,
      creditos_pagados: creditosPagados,
      cartera_total: carteraTotal,
      /**
       * DINERO EN LA CALLE: el capital que salió y todavía no volvió. Es el mismo número que
       * `cartera_total` —se expone con el nombre que usa el prestamista, no el contable— y el
       * mismo que el gráfico llama "Circulación".
       */
      capital_en_calle: carteraTotal,
      /** Lo que falta cobrar de los créditos vivos (capital + interés + cargos, sin mora). */
      a_cobrar_total: aCobrarTotal,
      mora_critica_count: moraCritica,
    },
    hoy: {
      cobrado: pagosHoy._sum.monto ?? 0,
      cobros: pagosHoy._count,
    },
    mora: {
      detalle: detalleMotaAlerta,
      // Los cortes con los que se armó esa distribución, para poder rotularla con los
      // números reales en vez de un rango fijo que podría no ser el vigente.
      tramos_mora: tramos,
      montos: montosMora,
    },
    transacciones: {
      total_pagos_registrados: pagosTotal._count,
      monto_pagos_total: pagosTotal._sum.monto || 0,
    },
    cobranza_mes: {
      esperado: cobranzaEsperado,
      cobrado: cobranzaCobrado,
      cuotas_total: cuotasPeriodo.length,
    },
    ...(porVendedor ? { por_vendedor: porVendedor } : {}),
  });
});

type PorVendedor = {
  vendedor_id: string | null;
  nombre: string;
  cobranza_esperado: number;
  cobranza_cobrado: number;
  cobranza_avance_pct: number;
  creditos_otorgados: number;
  monto_otorgado: number;
  cartera: number;
  en_mora_monto: number;
  mora_critica_count: number;
  pct_morosidad: number;
};
