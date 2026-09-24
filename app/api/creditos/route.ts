import { requireAuth, requireRole, scopeCreditosVendedor, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { puedeDarsePorIncobrableManual, round2, normalizarFrecuencia, resolverFrecuencia, sumarPeriodos, construirPlanAmortizacion, planACuotas, estadoCoherente, etiquetaCaja, esCuentaValida, validarParametrosOtorgamiento, diasMoraActual, buscarPlan, nombrePlan, tasaDesdeCoeficiente, cargosConPlan, CUENTA_LABEL, type Cuenta, ESTADOS_VIVOS, ESTADOS_COBRABLES, esCreditoVivo, esCreditoCobrable, topeMoraPorIncobrable, esRecuperoPostCastigo, moraDelCredito, moraDesdeCronograma, moraPendienteTotal, calcularDeudaVencida, deudaEnRevision, esTipoCreditoValido, TIPOS_CREDITO, calcularDeudaConsolidada, puedeRefinanciar, puedeAcordar, cargosDeCuota, baseMoraDeCuota, pendienteSinMoraDeCuota, formatPesos, contactoBloqueado} from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { assertFondosSuficientesTx } from "@/lib/caja-fondos";
import { lockNumeroCreditoTx, TX_PLATA } from "@/lib/locks";
import { getConfiguracion, getCobranzaConfig } from "@/lib/config";
import { plataDeLaCadenaLote } from "@/lib/recupero-server";
import { cobroBloqueadoPorCredito } from "@/lib/recupero-server";
import { situacionAcuerdoPorCredito, creditosConAcuerdoVigente, cubiertoPorAcuerdo } from "@/lib/acuerdos";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { registrarAuditoria } from "@/lib/audit";
import { registrarMovimientoStock } from "@/lib/stock";
import { evaluarClienteParaCredito, cuotaMensualParaRiesgo } from "@/lib/riesgo-server";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { fechaDeCajaTx } from "@/lib/cierre-turno";
import { rangoDeSeveridad, rangoEnMora, type SeveridadMora } from "@/lib/domain";

/**
 * GET /api/creditos
 * Lista de créditos del usuario, con filtros opcionales.
 * Query params:
 * - ?estado=activo — filtrar por estado
 * - ?cliente_id=uuid — filtrar por cliente específico
 * - ?limit=100
 * - ?offset=0
 *
 * Y los que agregó la auditoría de volumen (23/09/2026), para que las pantallas dejen de
 * traerse la cartera entera y filtrar en el navegador:
 *
 * - ?q=texto      — busca por nombre, apellido o documento del cliente, o por número de
 *                   crédito. El mismo criterio que tenía el buscador del navegador.
 * - ?mora=…       — `en_mora` | `al_dia` | `media` | `alta` | `critica`. Sale de
 *                   `rangoDeSeveridad`, la MISMA regla que `severidadMora`, mirada como rango
 *                   de fechas para que la pueda resolver la base.
 * - ?orden=…      — `reciente` (default, como siempre) | `mora` (el más atrasado primero).
 * - ?solo_ids=1   — devuelve únicamente los ids que cumplen el filtro, sin los datos. Es lo
 *                   que necesita "seleccionar todos" cuando la lista está paginada: la
 *                   audiencia de una campaña no puede ser "lo que entró en la página".
 * - ?tipo=…       — tipo de crédito (el de la ficha: efectivo, producto…).
 * - ?refi=solo|sin — solo las refinanciaciones, o solo las que no lo son. Es la pestaña de
 *                   la pantalla de Créditos.
 * - ?contacto=reciente|sin_reciente — si alguien lo gestionó en los últimos `dias_sin_gestion`
 *                   días. Antes se resolvía en el navegador cruzando la lista de gestiones.
 * - ?vence_desde / ?vence_hasta — los que tienen un vencimiento en ese rango. Incluye el de
 *                   la cuota PACTADA de un acuerdo vigente, no solo el del plan.
 * - ?ids=a,b,c    — trae exactamente esos créditos. Con la lista paginada de a 12, abrir un
 *                   crédito desde la Agenda no puede depender de que esté en la página que se
 *                   está mirando.
 *
 * 🔴 TODOS SON OPCIONALES Y NO CAMBIAN EL COMPORTAMIENTO DE ANTES. Sin ellos, la respuesta es
 * exactamente la misma que venía dando.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");
  const clienteId = url.searchParams.get("cliente_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const q = (url.searchParams.get("q") ?? "").trim();
  const mora = url.searchParams.get("mora");
  const orden = url.searchParams.get("orden");
  const soloIds = url.searchParams.get("solo_ids") === "1";
  const tipo = url.searchParams.get("tipo");
  const refi = url.searchParams.get("refi");
  const contacto = url.searchParams.get("contacto");
  const idsPedidos = (url.searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);

  // Anti-IDOR: el vendedor solo ve SUS créditos; admin/cobrador ven todo el tenant.
  const where: Record<string, any> = { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }) };
  /**
   * `estado=vivos` = activo + vencido: sigue en la cartera y en el circuito normal. Un
   * `vencido` es un activo atrasado; filtrar por "activo" a secas deja afuera justo a los
   * morosos. Ver ESTADOS_VIVOS en lib/domain/credito-estado.ts.
   *
   * 🔴 `estado=cobrables` suma los INCOBRABLES, y es el que usa la terminal de cobro. Están
   * fuera de la cartera pero su deuda existe: si el cliente aparece a pagar algo después de
   * que se le ejecutó el pagaré, el operador tiene que poder encontrar el crédito para
   * imputarlo. Con `vivos` la búsqueda no lo devolvía y la plata no tenía dónde entrar.
   */
  if (estado === "vivos") where.estado = { in: [...ESTADOS_VIVOS] };
  else if (estado === "cobrables") where.estado = { in: [...ESTADOS_COBRABLES] };
  else if (estado) where.estado = estado;
  if (clienteId) where.cliente_id = clienteId;

  /**
   * BÚSQUEDA. Lo mismo que hacían los buscadores en el navegador: nombre, apellido, documento
   * o número de crédito. `mode: "insensitive"` para que "PEREZ" encuentre a "Pérez"… no: eso
   * es acentos, que Postgres no ignora; ignora mayúsculas, que es lo que el operador tipea mal.
   *
   * El número se acepta como lo escribe la gente: "7", "000007" o "CRD-000007".
   */
  /**
   * Las condiciones se acumulan en `AND` y no en claves sueltas: la búsqueda es un `OR` y el
   * filtro de "al día" es otro, y dos `OR` de primer nivel no se pueden escribir en el mismo
   * objeto — el segundo pisa al primero en silencio y el filtro deja de aplicarse.
   */
  const condiciones: Record<string, unknown>[] = [];

  if (q) {
    /**
     * 🔴 SE BUSCA PALABRA POR PALABRA, y no la frase entera contra cada columna.
     *
     * El buscador que estaba en el navegador comparaba contra el nombre COMPLETO
     * (`nombreCompleto(cliente).includes(q)`), así que "Juan Pérez" encontraba al cliente.
     * Mandando esa misma frase a la base, `nombre contains "Juan Pérez"` no matchea nada
     * —el nombre es "Juan" y el apellido "Pérez", en dos columnas— y la pantalla habría
     * dicho "sin coincidencias" sobre un cliente que existe. Es el defecto más fácil de
     * cometer al mudar una búsqueda al servidor y el más difícil de notar: no falla, miente.
     *
     * Con una palabra por vez y todas obligatorias, "Juan Pérez" y "Pérez Juan" encuentran
     * lo mismo, y cada palabra puede estar en el nombre, en el apellido o en el documento.
     */
    const palabras = q.split(/\s+/).filter(Boolean);
    const soloDigitos = q.replace(/[^0-9]/g, "");
    const numero = soloDigitos ? parseInt(soloDigitos, 10) : NaN;
    const porPalabra = palabras.map((w) => ({
      OR: [
        { cliente: { nombre: { contains: w, mode: "insensitive" } } },
        { cliente: { apellido: { contains: w, mode: "insensitive" } } },
        { cliente: { documento: { contains: w.replace(/[^0-9]/g, "") || w } } },
      ],
    }));
    condiciones.push({
      OR: [
        // Todas las palabras tienen que aparecer en alguna parte del cliente…
        { AND: porPalabra },
        // …o el texto es el número del crédito ("7", "000007", "CRD-000007").
        ...(Number.isFinite(numero) ? [{ numero }] : []),
      ],
    });
  }

  /**
   * SEVERIDAD DE LA MORA, como rango de fechas de `proximo_pago`.
   *
   * La traducción vive en el dominio (`rangoDeSeveridad`), al lado de `severidadMora`, y el
   * verificador comprueba día por día que las dos digan lo mismo. Acá solo se arma el filtro.
   */
  if (mora && mora !== "todas") {
    const { tramos_mora } = await getCobranzaConfig(tenantId);
    const hoy = hoyComercial();
    const rango = mora === "en_mora"
      ? rangoEnMora(hoy)
      : rangoDeSeveridad(mora as SeveridadMora, tramos_mora, hoy);
    const porFecha: Record<string, Date> = {};
    if (rango.desde) porFecha.gte = rango.desde;
    if (rango.hasta) porFecha.lt = rango.hasta;
    condiciones.push(
      rango.incluyeSinFecha
        // Un crédito sin `proximo_pago` no tiene atraso: cuenta como al día.
        ? { OR: [{ proximo_pago: porFecha }, { proximo_pago: null }] }
        : { proximo_pago: porFecha },
    );
  }

  if (tipo && tipo !== "all") where.tipo_credito = tipo;
  if (refi === "solo") where.es_refinanciacion = true;
  if (refi === "sin") where.es_refinanciacion = false;

  /**
   * CONTACTO RECIENTE. Lo mismo que hacía la pantalla cruzando la lista de gestiones, pero
   * exacto: la pantalla solo tenía las últimas 500 acciones cargadas, así que un crédito
   * gestionado hace tiempo podía contarse como "nunca contactado" por no estar en esa tanda.
   *
   * El corte es el mismo que usa la agenda: `dias_sin_gestion` de Configuración → Cobranza.
   */
  if (contacto === "reciente" || contacto === "sin_reciente") {
    const { dias_sin_gestion } = await getCobranzaConfig(tenantId);
    const corte = new Date(Date.now() - dias_sin_gestion * 86_400_000);
    condiciones.push(
      contacto === "reciente"
        ? { acciones: { some: { created_at: { gte: corte } } } }
        : { acciones: { none: { created_at: { gte: corte } } } },
    );
  }

  /* Ids explícitos: gana sobre cualquier filtro. Se usa para abrir UN crédito que no está en
     la página actual, así que filtrarlo además por mora o por búsqueda lo escondería. */
  /**
   * VENCIMIENTOS EN UN RANGO. La pestaña de Vencimientos filtraba por fecha en el navegador
   * sobre los primeros 1.000 créditos: con una cartera más grande, a alguien fuera de esa
   * página no se le avisaba nunca.
   *
   * 🔴 NO ALCANZA CON `proximo_pago`. Un crédito con acuerdo de pago vigente conserva la
   * fecha vieja del plan —eso es un hecho contable, no su próximo vencimiento— y lo que
   * realmente vence es la cuota PACTADA. Por eso el filtro es un OR con las dos cosas, igual
   * que el badge de la pestaña.
   *
   * Lo que devuelve es un SUPERCONJUNTO a propósito: incluye acuerdos que quizá no estén al
   * día. La pantalla afina con `proximoVencimiento()`, que es la regla exacta — y afinar solo
   * puede sacar filas, nunca inventarlas.
   */
  const venceDesde = url.searchParams.get("vence_desde");
  const venceHasta = url.searchParams.get("vence_hasta");
  if (venceDesde && venceHasta) {
    const rango = { gte: new Date(`${venceDesde}T00:00:00.000Z`), lte: new Date(`${venceHasta}T00:00:00.000Z`) };
    condiciones.push({
      OR: [
        { proximo_pago: rango },
        {
          acuerdos: {
            some: {
              estado: "vigente",
              cuotas: { some: { vencimiento: rango, estado: { not: "pagada" } } },
            },
          },
        },
      ],
    });
  }

  if (idsPedidos.length > 0) where.id = { in: idsPedidos };

  if (condiciones.length > 0) where.AND = condiciones;

  /**
   * SOLO LOS IDS: para "seleccionar todos" con la lista paginada. Una columna, sin `include`
   * ni cuotas — es lo que hace que pedir 5.000 destinatarios cueste una fracción de pedir
   * 5.000 créditos completos.
   */
  if (soloIds) {
    const filas = await prisma.creditos.findMany({
      where,
      select: {
        id: true, proximo_pago: true,
        cliente: { select: { estado: true, no_contactar: true } },
      },
      orderBy: { created_at: "desc" },
    });

    /**
     * 🔴 `campanables=1`: SACA A LOS QUE NO PUEDEN RECIBIR UNA CAMPAÑA.
     *
     * Sin esto, el número del botón "Nueva campaña" cambiaba según la página que se estuviera
     * mirando: la pantalla podía descartar al fallecido o al que cumple su acuerdo solo si lo
     * tenía a la vista, así que en la página 1 decía 8 y en la 2 decía 9 — los mismos créditos,
     * dos números. Un contador que depende de dónde estás parado no sirve para decidir.
     *
     * Los dos cortes son los MISMOS que aplica el POST de campañas al armarla: quien no se
     * puede contactar (`contactoBloqueado`) y quien está cumpliendo un acuerdo que cubre su
     * atraso (`cubiertoPorAcuerdo` + la pactada al día). Acá se adelantan para poder contarlos
     * bien; la barrera real sigue siendo el POST.
     */
    if (url.searchParams.get("campanables") === "1") {
      const { fallecidos } = await getCobranzaConfig(tenantId);
      const vigentes = await creditosConAcuerdoVigente(tenantId);
      const situacion = await situacionAcuerdoPorCredito(tenantId, filas.map((c) => c.id));
      const ok = filas.filter((c) => {
        if (contactoBloqueado(c.cliente, { bloqueaFallecidos: fallecidos.bloquea_contacto }).bloqueado) return false;
        const a = situacion.get(c.id);
        const cumpliendo = !!a && a.al_dia && cubiertoPorAcuerdo(vigentes, c.id, c.proximo_pago);
        return !cumpliendo;
      });
      return successResponse({ ids: ok.map((c) => c.id), total: ok.length });
    }

    return successResponse({ ids: filas.map((c) => c.id), total: filas.length });
  }

  const [creditos, total] = await Promise.all([
    prisma.creditos.findMany({
      where,
      include: {
        // Cuotas mínimas para calcular la mora EXACTA (cuota por cuota, como al cobrar).
        /**
         * Se traen los componentes completos de la cuota, no solo lo que necesita la mora:
         * con esto se calcula también el VENCIDO (lo exigible hoy), que es el número que la
         * cobranza reclama. Antes cada pantalla lo derivaba por su cuenta o —peor— usaba
         * `saldo_pendiente`, que es el préstamo entero.
         */
        cuotas: {
          select: {
            id: true, nro: true, fecha_vencimiento: true, cuota_total: true, capitalizado: true,
            capital: true, interes: true, iva: true, seguro: true, gastos: true, honorarios: true,
            pagado_capital: true, pagado_interes: true, pagado_mora: true, pagado_cargos: true,
            // Punitorios ya perdonados por una campana (migracion 010): sin esto la mora se
            // recalcularia al 100% y lo condonado volveria a ser deuda.
            condonado_mora: true,
          },
        },
        /**
         * 🔴 `telefono` y `email` FALTABAN, y el tipo `Credito` los declaraba igual.
         *
         * Consecuencia: `cliente.telefono` era `undefined` para TODOS los créditos de la
         * lista, siempre. El botón de WhatsApp de la pestaña Morosos —que es por donde se
         * reclama— salía apagado para toda la cartera, tuviera el cliente teléfono o no, y
         * el detalle de cobranza mostraba "—" en Email y Teléfono aunque estuvieran cargados.
         * La agenda del día sí los manda, y ahí el botón funcionaba: mismo dato, dos
         * endpoints, uno solo lo mandaba.
         */
        // `estado`/`estado_fecha`: el terminal de cobro avisa si el titular falleció.
        cliente: { select: { id: true, nombre: true, apellido: true, documento: true, telefono: true, email: true, estado: true, estado_fecha: true, no_contactar: true } },
        vendedor: { select: { id: true, nombre: true } },
        pagos: { orderBy: { fecha: "desc" }, take: 5 },
        // Cobros VIVOS (sin los anulados). Va aparte de `pagos` porque cada uno responde
        // una pregunta distinta: `tiene_pagos` decide si se puede ELIMINAR el crédito —y ahí
        // los anulados cuentan, porque dejaron movimientos en la caja—, mientras que esto
        // decide si al anular hay algo que devolverle al cliente. Un pago anulado ya se
        // revirtió: no hay nada que devolver.
        _count: { select: { pagos: { where: { anulado: false } } } },
        producto: { select: { id: true, nombre: true, categoria: true, imagen_url: true } },
      },
      /* `mora` ordena por el más atrasado primero, que es el orden con el que se trabaja la
         cobranza. `proximo_pago` ascendente = el vencimiento más viejo arriba. Los que no
         tienen fecha van al final. */
      orderBy: orden === "mora" ? [{ proximo_pago: { sort: "asc", nulls: "last" } }] : [{ created_at: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.creditos.count({ where }),
  ]);

  // Enriquecemos con el interés moratorio calculado por el motor de dominio
  // (mismo criterio que el endpoint de pagos: cuota francesa × tasa diaria × días).
  // Solo se calcula para créditos activos en mora; el resto queda en 0.
  const config = await getConfiguracion(tenantId);
  const hoy = hoyComercial();
  // Acuerdos vigentes: con uno encima el crédito NO se lee por su plan viejo (ver
  // `situacionAcuerdoPorCredito`). Sin esto, la lista mostraba "Legales" a alguien que está
  // cumpliendo su arreglo.
  const acuerdosVig = await situacionAcuerdoPorCredito(tenantId, creditos.map((c) => c.id));
  /** La fecha en la que un acuerdo vigente frenó los punitorios de este crédito, o null. */
  const acuerdoVigenteDe = (creditoId: string): Date | null => {
    const a = acuerdosVig.get(creditoId);
    return a && a.congela ? a.fecha : null;
  };

  /**
   * 🔴 CUÁNTO PAGÓ DESPUÉS DE QUE SE LO DIO POR PERDIDO.
   *
   * Es la señal más fuerte de la cartera castigada —alguien que puso plata sobre una deuda que
   * ya nadie le reclamaba sigue enganchado— y el motor de la oferta la usa para pedirle más.
   * Aproximarla con "tiene algún cobro" la haría fallar justo al revés en el caso más común:
   * el que pagó tres cuotas religiosamente y DESPUÉS dejó de aparecer cobraría el bonus que
   * merece el que sigue pagando hoy, y el sistema le sugeriría una oferta demasiado dura.
   *
   * Una sola consulta, y solo si hay incobrables: son pocos por definición.
   */
  const incobrables = creditos.filter((c) => c.estado === "incobrable" && c.incobrable_at);
  /**
   * 🔴 CUÁNTA PLATA SALIÓ DE VERDAD DE LA CAJA, mirando toda la cadena.
   *
   * `monto_original` no sirve para esto en un refinanciado: ahí es la deuda vieja
   * consolidada —capital + interés capitalizado + punitorios—, y sobre el caso de Ricardo Paz
   * dice $3.150.000,00 cuando lo que salió de la ventanilla fueron $1.200.000,00. El
   * `capital_en_riesgo` de este endpoint se calculaba así y estaba mal por casi el triple; la
   * pestaña Incobrables lo sabía y hacía su propia caminata en el navegador para no usarlo.
   *
   * Ahora la cuenta vive en UN lado y viaja desde acá: la pestaña, la campaña de recupero y
   * el cierre del caso hablan del mismo número. Solo para los castigados —son pocos por
   * definición— y en una consulta por salto de cadena, no una por crédito.
   */
  const cadenas = await plataDeLaCadenaLote(tenantId, incobrables.map((c) => c.id));
  /**
   * Cuántas refinanciaciones hay DETRÁS de cada crédito vivo que nació de una. Hace falta
   * para saber si la deuda ya agotó los escalones que la financiera admite, que es una de las
   * señales de `puedeDarsePorIncobrableManual`. Solo para los que son refinanciación: en un
   * crédito original la respuesta es 0 sin consultar nada.
   */
  const refis = creditos.filter((c) => c.es_refinanciacion && c.refinancia_a);
  const cadenasRefi = refis.length > 0 ? await plataDeLaCadenaLote(tenantId, refis.map((c) => c.id)) : new Map();
  const cfgRecupero = (await getCobranzaConfig(tenantId)).recupero;
  /**
   * Acuerdos ROTOS por credito. Los mira `puedeRefinanciar` cuando la financiera exige haber
   * intentado un acuerdo antes de reestructurar. Una consulta agrupada para toda la lista, no
   * una por credito.
   */
  /**
   * GESTIONES HUMANAS por crédito, en UNA consulta para todo el lote.
   *
   * Hace falta desde que la lista también contesta si se puede ACORDAR: la escalera exige
   * haber contactado al deudor, así que con el conteo en cero —como estaba— el botón habría
   * dicho "nadie lo contactó" hasta en los créditos con diez llamadas encima.
   *
   * `automatico: false` es la MISMA definición que usa `senalesRecupero` al hacer cumplir la
   * regla: los envíos de campaña y las alertas del cron no son un contacto con el deudor.
   */
  const gestionesPorCredito = new Map<string, number>(
    (await prisma.acciones_cobranza.groupBy({
      by: ["credito_id"],
      where: { ...withTenant(tenantId), automatico: false, credito_id: { in: creditos.map((c) => c.id) } },
      _count: { _all: true },
    })).map((r) => [r.credito_id, r._count._all]),
  );

  const rotosPorCredito = new Map<string, number>(
    (await prisma.acuerdos_pago.groupBy({
      by: ["credito_id"],
      where: { ...withTenant(tenantId), estado: "roto", credito_id: { in: creditos.map((c) => c.id) } },
      _count: { _all: true },
    })).map((r) => [r.credito_id, r._count._all]),
  );
  /**
   * ÚLTIMO CONTACTO por crédito (gestión humana o automática, campaña incluida). Fernando
   * (18/09/2026): después de mandar una campaña, Morosos seguía mostrando a los doce como si
   * nadie los hubiera tocado. Una consulta para toda la lista: la más reciente de cada uno.
   */
  const ultimoContacto = new Map<string, { fecha: Date; tipo: string; campana: boolean }>();
  for (const a of await prisma.acciones_cobranza.findMany({
    where: { ...withTenant(tenantId), credito_id: { in: creditos.map((c) => c.id) } },
    select: { credito_id: true, created_at: true, tipo: true, nota: true },
    orderBy: { created_at: "desc" },
    distinct: ["credito_id"],
  })) ultimoContacto.set(a.credito_id, { fecha: a.created_at, tipo: a.tipo, campana: (a.nota ?? "").startsWith("[CAMPAÑA") });
  const cobradoPostCastigo = new Map<string, number>();
  if (incobrables.length > 0) {
    const pagos = await prisma.pagos.findMany({
      where: { ...withTenant(tenantId), anulado: false, credito_id: { in: incobrables.map((c) => c.id) } },
      select: { credito_id: true, monto: true, fecha: true },
    });
    const castigoDe = new Map(incobrables.map((c) => [c.id, c.incobrable_at as Date]));
    for (const p of pagos) {
      // La regla ("¿entró después del castigo?") vive en el dominio: la comparten el motor de
      // la oferta, esta lista y el badge de la ficha del cliente.
      if (esRecuperoPostCastigo(p.fecha, castigoDe.get(p.credito_id) ?? null)) {
        cobradoPostCastigo.set(p.credito_id, round2((cobradoPostCastigo.get(p.credito_id) ?? 0) + p.monto));
      }
    }
  }
  const creditosConMora = creditos.map((c) => {
    // Mora EN VIVO desde `proximo_pago` (no del cache `dias_mora`, que no se avanza día a día):
    // misma fórmula con la que se persiste, pero evaluada hoy → independiente del cron.
    const dmora = c.proximo_pago ? diasMoraActual(c.proximo_pago, hoy) : c.dias_mora;
    /**
     * 🔴 HASTA QUÉ DÍA SE EVALÚA ESTE CRÉDITO.
     *
     * Para uno vivo es hoy. Para uno dado por INCOBRABLE es el día en que se lo declaró: los
     * punitorios se frenaron ahí, así que calcular su deuda con la fecha de hoy mostraría una
     * mora que el cobro no le va a cobrar — el error de las dos fórmulas otra vez.
     */
    const hoyCredito = topeMoraPorIncobrable(hoy, c) ?? hoy;
    let interes_mora = 0;
    // Manda lo CONGELADO en el crédito, no la config de hoy. Tener `config.moraActiva` en
    // esta condición hacía que apagar la mora de la financiera mostrara $0 en la lista de
    // morosos, mientras el cobro sí le seguía cobrando lo pactado: la pantalla decía una
    // cosa y la caja hacía otra.
    const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
    if (
      mc.moraActiva &&
      dmora > 0 &&
      // `cobrable` y no `vivo`: un INCOBRABLE tiene deuda reclamable y hay que poder verla.
      // Su mora no crece —`hoyCredito` la congela— pero la acumulada hasta ahí se reclama.
      esCreditoCobrable(c.estado) &&
      c.monto_original > 0 &&
      c.plazo_meses >= 1
    ) {
      const graciaCred = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
      // Cuota por cuota, igual que la imputación al cobrar. Antes era UNA cuota × los días
      // de la más vieja, que con varias vencidas mostraba menos de la mitad de lo real.
      interes_mora = moraPendienteTotal(
        c.cuotas.map((q) => ({ fechaVencimiento: q.fecha_vencimiento, baseMora: baseMoraDeCuota(q), pagadoMora: q.pagado_mora, condonadoMora: q.condonado_mora, pendienteSinMora: pendienteSinMoraDeCuota(q) })),
        {
          tasaDiaria: mc.tasaMoraDiaria, diasGracia: graciaCred, hoy: hoyCredito, topePct: mc.topeMoraPct,
          // El mismo freno que `vencido`, o la fila mostraría punitorios que no suman a su deuda.
          moraCongeladaAl: acuerdoVigenteDe(c.id),
        },
      );
    }
    /**
     * Lo EXIGIBLE hoy: cuotas ya vencidas impagas + sus punitorios. Es lo que se reclama en
     * una cobranza y lo que ofrece una campaña de recupero — NO el `saldo_pendiente`, que es
     * el préstamo entero con las cuotas futuras adentro.
     *
     * Viaja desde acá para que haya UNA sola definición. La vista previa de campañas lo
     * calculaba por su cuenta con `saldo_pendiente + interés`, y el resultado no coincidía
     * con lo que el servidor terminaba ofreciéndole al cliente: a un moroso de 5 cuotas le
     * mostraba $663.140,27 MENOS de lo que debía, y a uno de 2 cuotas, $95.956,84 de más.
     */
    let vencido = 0;
    let cuotas_vencidas = 0;
    if (dmora > 0 && esCreditoCobrable(c.estado) && c.cuotas.length > 0) {
      const graciaV = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
      const dv = calcularDeudaVencida(
        c.cuotas.map((q) => ({
          id: q.id, nro: q.nro, fechaVencimiento: q.fecha_vencimiento,
          capital: q.capital, interes: q.interes, cargos: cargosDeCuota(q), capitalizado: q.capitalizado ?? 0,
          baseMora: baseMoraDeCuota(q),
          pagadoCapital: q.pagado_capital, pagadoInteres: q.pagado_interes,
          pagadoMora: q.pagado_mora, pagadoCargos: q.pagado_cargos,
      condonadoMora: q.condonado_mora,
        })),
        {
          moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct, diasGracia: graciaV, hoy: hoyCredito,
          /* Los punitorios que un acuerdo vigente frenó. Este `vencido` es la fuente de la
             pantalla del moroso Y de la vista previa de las campañas: sin el freno, las dos
             mostraban más de lo que la caja iba a cobrar (CRD-000007: $2.484,27 de más). */
          moraCongeladaAl: acuerdoVigenteDe(c.id),
        },
      );
      vencido = round2(dv.total);
      cuotas_vencidas = dv.cuotas_vencidas;
    }

    /**
     * 🔴 LO QUE SE VA A REFINANCIAR. No es el saldo, y no es lo vencido.
     *
     * La lista de candidatos a refinanciar mostraba `saldo_pendiente` rotulado "SALDO" y el
     * operador entraba a la pantalla creyendo ese numero. Medido sobre la cartera de prueba:
     *
     *     CRD-000007   la lista decia $260.000,00   la operacion era $604.659,31
     *     CRD-000006   la lista decia $300.000,00   la operacion era $628.950,27
     *
     * Mas del doble en todos los casos, porque refinanciar consolida capital + interes
     * devengado + cargos + punitorios, y `saldo_pendiente` es solo el capital. Tampoco sirve
     * `vencido`: ese deja afuera el capital de las cuotas que todavia no vencieron, y la
     * refinanciacion se las lleva igual.
     *
     * Se calcula con `calcularDeudaConsolidada`, LA MISMA funcion que usa
     * `POST /creditos/[id]/refinanciar` para armar el credito nuevo. Una sola definicion: si
     * la lista tuviera la suya, volveria a divergir el dia que se toque una.
     *
     * Sale de las cuotas que ya se traen para la mora: cero consultas extra.
     */
    let deuda_refinanciacion = 0;
    if (dmora > 0 && esCreditoVivo(c.estado) && c.cuotas.length > 0) {
      const graciaR = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
      const dc = calcularDeudaConsolidada(
        c.cuotas.map((q) => ({
          id: q.id, nro: q.nro, fechaVencimiento: q.fecha_vencimiento,
          capital: q.capital, interes: q.interes, cargos: cargosDeCuota(q), capitalizado: q.capitalizado ?? 0,
          baseMora: baseMoraDeCuota(q),
          pagadoCapital: q.pagado_capital, pagadoInteres: q.pagado_interes,
          pagadoMora: q.pagado_mora, pagadoCargos: q.pagado_cargos,
      condonadoMora: q.condonado_mora,
        })),
        {
          moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct,
          diasGracia: graciaR, hoy: hoyCredito, fechaInicio: c.fecha_inicio,
        },
      );
      deuda_refinanciacion = round2(dc.total);
    }

    /**
     * 🔴 CUÁNTO VOLVIÓ DE ESTE CRÉDITO, en total y desde siempre.
     *
     * Es el número que falta para negociar una deuda castigada, y no estaba en ninguna
     * pantalla. La deuda que se reclama es NOMINAL —capital, interés capitalizado y
     * punitorios— y no dice nada sobre si la financiera está ganando o perdiendo. Lo que hay
     * que mirar para decidir cuánto aceptar es otra cosa: cuánta plata salió de la caja y
     * cuánta volvió.
     *
     * Sobre CRD-000019: la deuda dice $2.326.775,16, pero lo que se prestó fueron
     * $880.000,00 y volvieron $0,00. Cobrar $500.000,00 no es "aceptar el 21%": es recuperar
     * más de la mitad del capital. Sin este dato el operador negocia contra un número
     * inflado por su propio interés y regala el caso o lo pierde.
     *
     * Sale de las cuotas que ya se traen para la mora: cero consultas extra.
     */
    const cobrado = round2(
      c.cuotas.reduce((acc, q) => acc + q.pagado_capital + q.pagado_interes + q.pagado_mora + q.pagado_cargos, 0),
    );
    /**
     * Capital que la financiera todavía no recuperó. El piso real de cualquier negociación.
     *
     * En un castigado sale de la CADENA (lo prestado en la raíz menos todo lo cobrado en
     * cualquier eslabón). En el resto, del propio crédito: no hay cadena que recorrer y
     * `monto_original` sí es plata entregada.
     */
    const cadena = cadenas.get(c.id) ?? null;
    const capital_en_riesgo = cadena ? cadena.enRiesgo : round2(Math.max(0, c.monto_original - cobrado));

    // Estado reconciliado: defensa de lectura ante datos legacy.
    const estado = estadoCoherente(c.estado, c.saldo_pendiente);
    const { cuotas: _cuotas, ...credito } = c; // no viajan al cliente: solo alimentan los cálculos
    /*
      LA CUOTA QUE VIENE: lo que falta pagar de la cuota impaga más vieja — la misma que
      apunta `proximo_pago`.

      🔴 No es `cuota_total` a secas: si esa cuota tiene un pago parcial, lo que se le pide
      es el resto. Mandarle un recordatorio por el total de una cuota que ya pagó a medias
      es el tipo de error que hace que el cliente deje de creerle a los avisos.

      Hace falta para las campañas de VENCIMIENTO (avisar antes de que se atrase); en las de
      mora la base sigue siendo `vencido`.
    */
    const proxima = c.cuotas
      .filter((q) => q.cuota_total > (q.pagado_capital + q.pagado_interes + q.pagado_cargos))
      .sort((a, b) => a.nro - b.nro)[0];
    const cuota_proxima = proxima
      ? round2(Math.max(0, proxima.cuota_total - (proxima.pagado_capital + proxima.pagado_interes + proxima.pagado_cargos)))
      : 0;

    /**
     * ¿SE PUEDE DAR POR INCOBRABLE A MANO? `null` = sí; con objeto = no, y por qué.
     *
     * Viaja desde acá para que la pantalla pueda deshabilitar el botón con el motivo a la
     * vista, en vez de dejar apretar y contestar 409. La barrera de verdad sigue siendo el
     * PATCH: esto es para que se vea antes.
     */
    const eslabones = cadenasRefi.get(c.id)?.eslabones ?? 1;
    /*
      Las señales de la escalera, armadas UNA vez y usadas por los dos veredictos. Las
      gestiones y las promesas van en cero: ninguna de las dos reglas que se evaluan aca las
      mira, y traerlas costaria cinco consultas por credito.
    */
    const senales = {
      diasMora: dmora,
      gestiones: gestionesPorCredito.get(c.id) ?? 0,
      promesaPendiente: false, promesasIncumplidas: 0,
      acuerdoVigente: !!acuerdosVig.get(c.id),
      acuerdosRotos: rotosPorCredito.get(c.id) ?? 0,
      refinanciado: estado === "refinanciado",
      refinanciacionesEncadenadas: Math.max(0, eslabones - 1),
    };
    const vered = esCreditoVivo(estado) ? puedeDarsePorIncobrableManual(senales, cfgRecupero) : null;
    /**
     * 🔴 ¿SE PUEDE REFINANCIAR HOY? `null` = si; con objeto = no, y por que.
     *
     * La pestaña Refinanciados armaba su lista de candidatos con "vivo y con mora" a secas, y
     * le ofrecia el boton a creditos que el server rechaza: uno de 9 dias de atraso entraba
     * en la lista y el 409 llegaba recien al confirmar, con el plan nuevo ya armado.
     *
     * Es el mismo veredicto del dominio que hace cumplir `assertPuedeRefinanciar`, asi que la
     * lista no puede opinar distinto del endpoint.
     */
    const veredRefi = esCreditoVivo(estado) && dmora > 0 ? puedeRefinanciar(senales, cfgRecupero) : null;
    /**
     * 🔴 ¿SE PUEDE ACORDAR HOY? Mismo criterio que el de refinanciar, con la función que
     * después hace cumplir `assertPuedeAcordar`.
     *
     * Fernando (21/09/2026): «si el crédito cuenta con los requisitos para acordar, que el
     * botón aparezca acá también». Sin este veredicto la ficha del crédito no tenía cómo
     * saberlo: el acuerdo solo se ofrecía desde Cobranzas.
     */
    const veredAcu = esCreditoVivo(estado) && dmora > 0 ? puedeAcordar(senales, cfgRecupero) : null;

    return { ...credito, estado, dias_mora: dmora, interes_mora, vencido, cuotas_vencidas, cuota_proxima, cobrado, capital_en_riesgo,
      /** Por qué NO se puede dar por incobrable (null = se puede). Ver `puedeDarsePorIncobrableManual`. */
      incobrable_bloqueo: vered && !vered.permitido ? { motivo: vered.motivo ?? "", sugerencia: vered.sugerencia ?? "" } : null,
      /** Se puede, pero conviene saber esto antes de apretar. */
      incobrable_advertencia: vered?.advertencia ?? null,
      /** Por qué NO se puede refinanciar (null = se puede). Ver `puedeRefinanciar`. */
      refinanciar_bloqueo: veredRefi && !veredRefi.permitido
        ? { motivo: veredRefi.motivo ?? "", sugerencia: veredRefi.sugerencia ?? "" } : null,
      /**
       * Por qué NO se puede acordar (null = se puede). `clave` dice QUÉ regla bloquea: con
       * `sin_gestion`, el propio operador la levanta dejando constancia, así que la pantalla
       * no lo manda a buscar un administrador.
       */
      acordar_bloqueo: veredAcu && !veredAcu.permitido
        ? { motivo: veredAcu.motivo ?? "", sugerencia: veredAcu.sugerencia ?? "", clave: veredAcu.clave ?? null } : null,
      /** Lo prestado y lo recuperado de TODA la cadena. Solo en los castigados. */
      prestado_cadena: cadena?.prestado ?? null, recuperado_cadena: cadena?.recuperado ?? null,
      /** Lo que pagó DESPUÉS del castigo. 0 en todo lo que no es incobrable. */
      deuda_refinanciacion,
      cobrado_post_castigo: cobradoPostCastigo.get(c.id) ?? 0, tiene_pagos: c.pagos.length > 0, cobros_vivos: c._count.pagos > 0, acuerdo: acuerdosVig.get(c.id) ?? null, ultimo_contacto: ultimoContacto.get(c.id) ?? null };
  });

  /**
   * ¿Cuáles de estos créditos YA NO SE COBRAN y hay que refinanciar?
   *
   * Lo contesta el server y no la pantalla porque depende de los acuerdos ROTOS de cada
   * crédito, que la lista no trae (ver `cobroBloqueadoPorCredito`). Con esto, las campañas
   * pueden separar a quién se le reclama un pago y a quién se lo invita a reestructurar, en
   * vez de prometerle un descuento a alguien cuyo cobro la terminal va a rechazar.
   *
   * Una sola consulta agrupada para todo el lote, y ninguna si la regla está apagada.
   */
  const { recupero: recuperoCfg } = await getCobranzaConfig(tenantId);
  const bloqueados = await cobroBloqueadoPorCredito(
    tenantId,
    creditosConMora.map((c) => ({ id: c.id, diasMora: c.dias_mora, acuerdoVigente: c.acuerdo != null })),
    recuperoCfg,
  );
  for (const c of creditosConMora as (typeof creditosConMora[number] & { cobro_bloqueado?: boolean })[]) {
    c.cobro_bloqueado = bloqueados.get(c.id) ?? false;
  }

  // El número del crédito que cada refinanciación reemplaza, para poder mostrar REF-000060
  // en vez de un CRD- suelto sin relación visible con su origen. Una sola query para el lote.
  const creditosConOrigen = await conNumeroDeOrigen(tenantId, creditosConMora);

  return successResponse({
    creditos: creditosConOrigen,
    total,
    limit,
    offset,
  });
});

/**
 * POST /api/creditos
 * Crea un nuevo crédito.
 * Body requerido:
 * {
 *   "cliente_id": "uuid",
 *   "tipo_credito": "personal|productos",
 *   "monto_original": 1000000,
 *   "tasa": 2.5,
 *   "plazo_meses": 12,
 *   "solicitud_id": "uuid (optional)"
 * }
 */
/**
 * Asegura que un usuario-vendedor tenga su ficha comercial (`vendedores`).
 * Si su perfil aún no está vinculado, crea la ficha desde sus datos y la vincula.
 * Devuelve el `vendedores.id` a usar para atribuir el crédito y la comisión.
 *
 * Garantiza que CUALQUIER usuario con rol vendedor pueda otorgar créditos sin
 * depender de un alta manual previa en Personal.
 */
async function asegurarFichaVendedor(
  tenantId: string,
  userId: string,
  nombre: string | null,
  email: string | null
): Promise<string> {
  // Ficha + vínculo en una transacción: si el update del profile falla, no queda una ficha
  // comercial huérfana (M2).
  const fichaId = await prisma.$transaction(async (tx) => {
    const ficha = await tx.vendedores.create({
      data: {
        ...withTenant(tenantId),
        nombre: nombre?.trim() || email?.split("@")[0] || "Vendedor",
        email: email ?? null,
        activo: true,
        comision_pct: 0,
        meta_venta: 0,
      },
      select: { id: true },
    });
    await tx.profiles.update({ where: { id: userId }, data: { vendedor_id: ficha.id } });
    return ficha.id;
  });
  return fichaId;
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  // Otorgar créditos: admin y vendedor. El cobrador NO puede otorgar.
  const { tenantId, role, vendedorId: miVendedorId, userId, nombre, email } = await requireRole(["admin", "vendedor"], req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar campos requeridos
  const required = ["cliente_id", "tipo_credito", "monto_original", "tasa", "plazo_meses"];
  for (const field of required) {
    if (!(field in body)) {
      return errorResponse(`Campo '${field}' requerido`, "INVALID_INPUT", 400);
    }
  }

  /**
   * 🔴 El tipo se valida contra la lista del dominio. Antes se guardaba lo que viniera en el
   * body: la pantalla ofrecía cuatro opciones y el server aceptaba cualquier string, así que
   * un tipo desconocido entraba igual y después la lista no sabía cómo rotularlo ni filtrarlo.
   * Ahora que son dos, la barrera está donde tiene que estar.
   */
  if (!esTipoCreditoValido(body.tipo_credito)) {
    return errorResponse(
      `Tipo de crédito inválido. Los admitidos son: ${TIPOS_CREDITO.join(", ")}.`,
      "INVALID_INPUT",
      400,
    );
  }

  // Validar que el cliente existe y pertenece al usuario
  const cliente = await prisma.clientes.findFirst({
    where: { ...withTenant(tenantId), id: body.cliente_id },
  });

  if (!cliente) {
    return errorResponse("Cliente no encontrado o no tiene permisos", "INVALID_REFERENCE", 400);
  }

  /**
   * Un cliente dado de baja no puede recibir un crédito nuevo.
   *
   * El botón Eliminar de Clientes hace un soft delete (`estado` → "inactivo") justamente para
   * sacarlo de circulación conservando su historial. Pero el simulador pedía la lista SIN
   * filtrar, así que el inactivado seguía apareciendo en el buscador y se le podía otorgar:
   * la baja no daba de baja nada. La pantalla ya no lo ofrece, y esta es la barrera que vale.
   */
  if (cliente.estado === "inactivo") {
    return errorResponse(
      `${cliente.nombre} ${cliente.apellido ?? ""} está dado de baja. Reactivalo desde Clientes antes de otorgarle un crédito.`.replace(/\s+/g, " ").trim(),
      "CLIENTE_INACTIVO",
      409
    );
  }

  /**
   * 🔴 Y tampoco a un FALLECIDO.
   *
   * El chequeo de arriba miraba solo "inactivo", así que cuando apareció el estado
   * "fallecido" pasaba de largo: se le podía otorgar un crédito a una persona muerta. No es
   * un caso hipotético — es la puerta por la que alguien usa la identidad de un fallecido, y
   * el contrato sería inejecutable de todos modos.
   */
  if (deudaEnRevision(cliente)) {
    return errorResponse(
      `${cliente.nombre} ${cliente.apellido ?? ""} figura como fallecido: no se le puede otorgar un crédito.`.replace(/\s+/g, " ").trim(),
      "CLIENTE_FALLECIDO",
      409
    );
  }

  // Crédito de PRODUCTO: en vez de desembolsar dinero, el cliente se lleva un producto.
  // El capital lo fija el producto (precio × cantidad, autoritativo: no se confía en el
  // monto del cliente) y NO mueve caja; el control es el descuento de stock.
  const esProducto = body.tipo_credito === "productos";
  let producto: { id: string; nombre: string; precio: number; stock: number; activo: boolean } | null = null;
  let productoCantidad = 0;
  if (esProducto) {
    if (!body.producto_id) {
      return errorResponse("Falta el producto a financiar", "INVALID_INPUT", 400);
    }
    productoCantidad = Math.trunc(Number(body.producto_cantidad) || 0);
    if (productoCantidad < 1) {
      return errorResponse("La cantidad debe ser al menos 1", "INVALID_INPUT", 400);
    }
    producto = await prisma.productos.findFirst({
      where: { ...withTenant(tenantId), id: body.producto_id },
      select: { id: true, nombre: true, precio: true, stock: true, activo: true },
    });
    if (!producto || !producto.activo) {
      return errorResponse("Producto no encontrado o inactivo", "INVALID_REFERENCE", 400);
    }
    if (producto.stock < productoCantidad) {
      return errorResponse(
        `Stock insuficiente de "${producto.nombre}": hay ${producto.stock} u. y se piden ${productoCantidad}.`,
        "INSUFFICIENT_STOCK",
        409,
      );
    }
    // Capital autoritativo = precio × cantidad (snapshot del valor en monto_original).
    body.monto_original = Math.round(producto.precio * productoCantidad * 100) / 100;
  }

  /**
   * Validar montos con COERCIÓN explícita.
   *
   * Sin `Number()`, un `"abc"` no es `<= 0` ni `< 1`, así que atravesaba esta guarda y
   * reventaba recién adentro de Prisma → 500 "error interno" en vez de un 400 que le diga
   * al operador qué escribió mal. Y `plazo_meses` se trunca: un 3,7 llegaba entero al motor
   * en las frecuencias que no fijan cuotas.
   */
  body.monto_original = Number(body.monto_original);
  body.tasa = Number(body.tasa);
  body.plazo_meses = Math.trunc(Number(body.plazo_meses));
  if (
    !Number.isFinite(body.monto_original) || body.monto_original <= 0 ||
    !Number.isFinite(body.tasa) || body.tasa < 0 ||
    !Number.isFinite(body.plazo_meses) || body.plazo_meses < 1
  ) {
    return errorResponse("Montos inválidos: revisá capital, tasa y cantidad de cuotas.", "INVALID_INPUT", 400);
  }

  // Atribución del vendedor.
  //  - Si quien otorga ES vendedor: se fuerza su propio vendedor_id (anti-IDOR;
  //    no puede atribuir el crédito a otro). Su perfil debe estar vinculado.
  //  - Si es admin: puede elegir vendedor_id (opcional), validado contra el tenant.
  let vendedorId: string | null = null;
  if (role === "vendedor") {
    // Un vendedor SIEMPRE puede otorgar (es su función). Si su perfil aún no está
    // vinculado a una ficha comercial, se autoprovisiona y vincula al vuelo: nunca
    // queda bloqueado por un tema de setup.
    vendedorId = miVendedorId ?? (await asegurarFichaVendedor(tenantId, userId, nombre, email));
  } else if (body.vendedor_id) {
    const vendedor = await prisma.vendedores.findFirst({
      where: { ...withTenant(tenantId), id: body.vendedor_id },
      select: { id: true },
    });
    if (!vendedor) {
      return errorResponse("Vendedor no encontrado o sin permisos", "INVALID_REFERENCE", 400);
    }
    vendedorId = vendedor.id;
  }

  // Cuenta de desembolso elegida (efectivo | banco [transferencia] | dolares).
  const cuentaDesembolso: Cuenta = esCuentaValida(body.cuenta_desembolso) ? body.cuenta_desembolso : "efectivo";

  // Límite de otorgamiento (autoritativo): un vendedor no puede otorgar por encima
  // de su tope configurado sin autorización de un superior. El admin no tiene tope.
  if (role === "vendedor" && vendedorId) {
    const ficha = await prisma.vendedores.findFirst({
      where: { ...withTenant(tenantId), id: vendedorId },
      select: { limite_aprobacion: true },
    });
    const limite = ficha?.limite_aprobacion;
    if (limite != null && body.monto_original > limite) {
      return errorResponse(
        `El monto (${formatPesos(Number(body.monto_original))}) supera tu límite de otorgamiento (${formatPesos(limite)}). Requiere autorización de un administrador.`,
        "LIMIT_EXCEEDED",
        403,
      );
    }
  }

  // Fondos disponibles (autoritativo, TODOS los roles): el desembolso sale de la cuenta
  // elegida (efectivo/banco/dólares) de la caja de quien otorga — vendedor → su caja;
  // admin → caja principal (vendedor_id null). No se puede prestar más de lo que hay en
  // esa cuenta. Los créditos de producto NO desembolsan efectivo → se omite este control.
  // (El chequeo usa el mismo `vendedorId` con el que luego se registra el desembolso.)
  if (!esProducto) {
    const saldoCuenta = await prisma.movimientos_caja.aggregate({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId, cuenta: cuentaDesembolso },
      _sum: { monto: true },
    });
    const disponible = Math.round((saldoCuenta._sum.monto ?? 0) * 100) / 100;
    if (body.monto_original > disponible) {
      const dondeCaja = vendedorId ? "tu caja" : "la caja principal";
      const sugerencia = vendedorId
        ? "Pedí una entrega al administrador para poder otorgar."
        : "Registrá un ingreso en la caja antes de otorgar.";
      /*
        🔴 400, NO 403 — y no es cosmético.

        Este pre-chequeo devolvía 403 mientras el control autoritativo que corre dentro de la
        transacción (`assertFondosSuficientesTx`) devuelve 400 para EXACTAMENTE la misma
        condición. O sea: el mismo hecho salía con un estado u otro según quién ganara una
        carrera, y ninguna de las dos respuestas era predecible desde afuera.

        Además 403 acá significa otra cosa. El bloque de arriba lo usa para `LIMIT_EXCEEDED`,
        que SÍ es un permiso: este vendedor no puede otorgar ese monto. Que la caja esté vacía
        no es un permiso — cualquiera con la misma caja financiada puede hacerlo. Mezclarlos
        hace que un monitoreo o una integración que mire el estado lea "acceso denegado" donde
        hay "falta plata".

        400 es lo que ya eligió `lib/caja-fondos.ts`, que usan la caja, la transferencia y el
        control de adentro. El que estaba fuera de línea era este.
      */
      return errorResponse(
        `No hay saldo suficiente en ${dondeCaja} de ${CUENTA_LABEL[cuentaDesembolso]}. Disponible: ${formatPesos(disponible)} — necesitás ${formatPesos(Number(body.monto_original))}. ${sugerencia}`,
        "INSUFFICIENT_FUNDS",
        400,
      );
    }
  }

  // Frecuencia de pago (default mensual). El período de cada cuota lo da este campo.
  const frecuencia = normalizarFrecuencia(body.frecuencia);

  // Snapshot de cargos vigentes: congela las reglas de cargos del tenant en el
  // crédito, para que cambios futuros de configuración no lo alteren.
  const configActual = await getConfiguracion(tenantId);

  // ─── PLANES ───
  // Si el crédito nace de un plan con coeficiente, la tasa la despeja el SERVIDOR. El
  // simulador ya se la mostró al vendedor, pero la que vale es esta: el crédito guarda la
  // TASA (no el coeficiente), así que si se aceptara la del navegador el cliente elegiría
  // su propio precio. Se recalcula y se pisa lo que haya venido.
  const planElegido = buscarPlan(configActual.simulador.plazos, body.plan_id);
  if (body.plan_id && !planElegido) {
    return errorResponse("El plan elegido ya no existe en la configuración.", "PLAN_INVALIDO", 400);
  }
  if (planElegido) {
    if (!planElegido.activo) {
      return errorResponse(`El plan "${nombrePlan(planElegido)}" está desactivado.`, "PLAN_INVALIDO", 400);
    }
    if (planElegido.cuotas !== body.plazo_meses) {
      return errorResponse(`El plan "${nombrePlan(planElegido)}" es de ${planElegido.cuotas} cuotas.`, "PLAN_INVALIDO", 400);
    }
    if (planElegido.frecuencia && planElegido.frecuencia !== frecuencia) {
      return errorResponse(`El plan "${nombrePlan(planElegido)}" solo se ofrece en frecuencia ${planElegido.frecuencia}.`, "PLAN_INVALIDO", 400);
    }
    if (planElegido.coeficiente) {
      const tasaPlan = tasaDesdeCoeficiente(
        planElegido.coeficiente, planElegido.cuotas,
        configActual.convencionTasa, frecuencia, configActual.simulador.frecuencias,
      );
      if (tasaPlan === null) {
        return errorResponse(`El coeficiente del plan "${nombrePlan(planElegido)}" no representa una tasa válida. Revisá la configuración.`, "PLAN_INVALIDO", 400);
      }
      body.tasa = tasaPlan;
    }
  }

  // M1 — Parámetros dentro de lo configurado por el tenant (defensa en profundidad: el
  // simulador ya acota en la UI, pero la API es la barrera autoritativa). Frecuencia
  // habilitada, plazo permitido y tasa/monto dentro de rango.
  // 🔴 Corre DESPUÉS del despeje del plan a propósito: la tasa que sale de un coeficiente
  // también tiene que caer dentro de tasaMin/tasaMax. Es la red que atrapa un 0,038
  // tipeado donde iba 0,38.
  const errParam = validarParametrosOtorgamiento(configActual.simulador, {
    monto: body.monto_original, tasa: body.tasa, plazoMeses: body.plazo_meses,
    frecuencia, esProducto,
  });
  if (errParam) return errorResponse(errParam, "PARAMETROS_INVALIDOS", 400);

  // Los gastos administrativos propios del plan pisan los del bloque Cargos (única
  // herencia del modelo). Se congelan ya resueltos, así el crédito no necesita saber
  // de qué plan salió para recalcular su propio plan de cuotas.
  const cargosSnapshot = cargosConPlan(configActual.simulador.cargos, planElegido);
  // Snapshot de la definición de frecuencia: congela días/períodos del crédito.
  const frecuenciaDef = resolverFrecuencia(frecuencia, configActual.simulador.frecuencias);
  // Snapshot del cronograma (corte/día de vencimiento/gracia/feriados): congela las
  // fechas de cobranza y la tolerancia de mora del crédito ante cambios de config.
  const cronogramaSnapshot = {
    diaCorte: configActual.simulador.diaCorte,
    diaVencimiento: configActual.simulador.diaVencimientoFijo,
    diasGracia: configActual.simulador.diasGracia,
    incluirDomingo: configActual.simulador.incluirDomingoNoHabil,
    incluirSabado: configActual.simulador.incluirSabadoNoHabil,
    feriados: configActual.simulador.feriados,
    // Condiciones de MORA del día en que se firma. Los días de gracia ya se congelaban
    // acá; la tasa y el switch quedaban afuera, así que media condición viajaba con el
    // crédito y la otra media se leía de la config del día en que alguien la mirara.
    // Como la mora se recalcula al vuelo, sin esto cambiar la tasa reescribía hacia atrás
    // los punitorios de todos los morosos.
    mora: {
      activa: configActual.moraActiva,
      tasaDiaria: configActual.tasaMoraDiaria,
      // El TECHO de la mora también se congela. Si mañana la financiera lo baja (o lo saca),
      // los créditos ya otorgados conservan el que estaba vigente cuando el cliente firmó:
      // cambiar la política no puede reescribir hacia atrás lo que se le va a cobrar.
      topePct: configActual.topeMoraPct,
    },
    // Redondeo del día en que se firma. Los cargos y el cronograma ya se congelaban; el
    // redondeo no, y la pantalla de amortización RECALCULA el plan con la config vigente:
    // cambiar el redondeo hoy reescribía la tabla que se le muestra a un crédito viejo,
    // mientras sus cuotas cobradas seguían siendo las originales.
    redondeo: configActual.simulador.redondeoCuota,
    /**
     * 🔴 LA CONVENCIÓN CON LA QUE SE COTIZÓ. Era lo último que faltaba congelar.
     *
     * `tasa` es un número sin sentido propio: 350 significa cosas distintas según se lea como
     * nominal anual, efectiva anual o mensual. Se congelaban los cargos, el cronograma, la mora
     * y el redondeo, pero la convención se seguía leyendo de la config VIGENTE — y la pantalla
     * de amortización RECONSTRUYE el plan para mostrarlo e imprimirlo.
     *
     * Medido sobre CRD-000003 (600.000 al 350, 5 cuotas mensuales): la cuota que se cobra es
     * $242.425,90 (nominal anual, la vigente al firmar). Con el tenant pasado a efectiva anual
     * esa misma pantalla mostraría $172.061,88, y con mensual $2.101.138,65 — mientras las
     * cuotas persistidas, que son las que se cobran, seguirían siendo las de $242.425,90. O
     * sea: el papel que se lleva el cliente dejaría de coincidir con lo que el sistema le
     * cobra, sin que nadie tocara ese crédito.
     */
    convencion: configActual.convencionTasa,
  };

  // ─── Riesgo / originación (motor base, TODOS los planes) ───
  // Siempre se evalúa al cliente contra la política ANTES de otorgar (capacidad de pago por
  // sueldo, tope de créditos activos, bloqueo por mora). "rechazado" + política "bloquear" (o
  // bloqueo duro por mora) → corta. "rechazado" + "autorizar" → solo un admin puede seguir con
  // `autorizacion_riesgo: true` (decisión humana asumiendo el riesgo). Se guarda el snapshot de
  // la evaluación en el crédito (congela la decisión). Las señales de bureau solo pesan si el
  // tenant tiene el plan Pro y consultó (BCRA/Nosis/Veraz); si no, el motor usa datos internos.
  let riesgoSnapshot: Prisma.InputJsonValue | undefined;
  {
    // Lo que el crédito le cuesta al cliente POR MES, con cargos. Antes acá iba la cuota pura
    // de capital + interés y sin mensualizar: con cargos activos o frecuencia no mensual, la
    // barrera del otorgamiento medía menos de lo que el cliente realmente iba a pagar.
    const cuotaEstimada = cuotaMensualParaRiesgo({
      monto: body.monto_original,
      tasa: body.tasa,
      plazoCuotas: body.plazo_meses,
      frecuencia,
      // Alcanza con hoy: la evaluación mira el TAMAÑO de la cuota, no en qué fecha cae, y el
      // cronograma real todavía no se armó en este punto del flujo.
      fechaInicio: hoyComercial(),
      config: configActual,
      // Los cargos del crédito que se está por dar (con los gastos del plan ya resueltos),
      // no los generales: si no, mide contra el sueldo una cuota más barata que la real.
      cargos: cargosSnapshot,
    });
    const ev = await evaluarClienteParaCredito({ tenantId, clienteId: body.cliente_id, montoSolicitado: body.monto_original, cuotaMensualEquivalenteConCargos: cuotaEstimada });
    const autorizadoManual = role === "admin" && body.autorizacion_riesgo === true;
    if (ev.semaforo === "rechazado") {
      if (ev.bloquea) {
        return errorResponse(`El cliente no califica para este crédito. ${ev.motivos.join(" ")}`, "RIESGO_BLOQUEADO", 403);
      }
      if (!autorizadoManual) {
        return errorResponse(
          role === "admin"
            ? `El cliente no califica. Podés autorizar el otorgamiento asumiendo el riesgo. ${ev.motivos.join(" ")}`
            : `El cliente no califica y requiere autorización de un administrador. ${ev.motivos.join(" ")}`,
          "RIESGO_REQUIERE_AUTORIZACION",
          409,
        );
      }
    }
    riesgoSnapshot = {
      semaforo: ev.semaforo,
      motivos: ev.motivos,
      ratioCuotaIngreso: ev.ratioCuotaIngreso,
      cuotaEstimada,
      ingresoNetoMensual: ev.ingresoNetoMensual,
      deudaCuotaMensualVigente: ev.deudaCuotaMensualVigente,
      capacidad: ev.capacidad,
      scoreInterno: ev.scoreInterno.categoria,
      autorizadoManual,
      /*
        QUIÉN lo firmó, no solo que se firmó. `autorizadoManual: true` sin nombre obliga a
        cruzar la hora del crédito contra la auditoría para saber quién asumió el riesgo —
        y este snapshot es justamente lo que se mira meses después, cuando el crédito cayó.
        Se guarda nombre y email (no la contraseña ni el token, obviamente).
      */
      autorizadoPor: autorizadoManual ? { userId, nombre: nombre ?? null, email: email ?? null } : null,
      evaluadoEl: new Date().toISOString(),
    } as unknown as Prisma.InputJsonValue;
  }

  // Fecha de desembolso y vencimiento de la 1ª cuota (un período después).
  const fechaInicio = body.fecha_inicio ? new Date(body.fecha_inicio) : hoyComercial();
  // P2 — El otorgamiento no puede fecharse en el futuro (distorsiona caja, mora y cronograma).
  if (Number.isNaN(fechaInicio.getTime())) {
    return errorResponse("Fecha de otorgamiento inválida", "FECHA_INVALIDA", 400);
  }
  if (fechaInicio.getTime() > hoyComercial().getTime()) {
    return errorResponse("La fecha de otorgamiento no puede ser futura.", "FECHA_INVALIDA", 400);
  }
  // Piso de CORDURA, no regla de negocio: retroceder la fecha es legítimo (así se cargan a
  // mano los créditos vivos que la financiera traía de antes), pero un año 1970 por un typo
  // asienta el desembolso en caja con esa fecha y ensucia todos los reportes por período.
  if (fechaInicio.getUTCFullYear() < 2000) {
    return errorResponse("La fecha de otorgamiento parece equivocada: revisá el año.", "FECHA_INVALIDA", 400);
  }
  const proximoPago = body.proximo_pago
    ? new Date(body.proximo_pago)
    : sumarPeriodos(fechaInicio, 1, frecuencia, configActual.simulador.frecuencias);

  // Si hay solicitud_id, verificar que existe
  if (body.solicitud_id) {
    const solicitud = await prisma.solicitudes.findFirst({
      where: { ...withTenant(tenantId), id: body.solicitud_id },
    });
    if (!solicitud) {
      return errorResponse("Solicitud no encontrada", "INVALID_REFERENCE", 400);
    }
  }

  // Plan de cuotas persistido (Fase 6A): se congela el cronograma al otorgar,
  // reusando el mismo motor y los mismos snapshots (frecuencia/cargos/redondeo).
  const plan = construirPlanAmortizacion(
    body.monto_original,
    body.tasa,
    body.plazo_meses,
    fechaInicio,
    configActual.convencionTasa,
    frecuencia,
    {
      cargos: cargosSnapshot,
      redondeo: configActual.simulador.redondeoCuota,
      cronograma: cronogramaSnapshot,
    },
    configActual.simulador.frecuencias
  );
  const filasCuota = planACuotas(plan);
  /**
   * El próximo pago = 1ª cuota del plan. **Punto.**
   *
   * 🔴 Antes esto era `body.proximo_pago ? ... : plan.cuotas[0].fecha`, o sea que el valor
   * del navegador pisaba el cronograma calculado, sin validarse contra el plan y sin tope.
   * El cronograma de `cuotas` quedaba bien (se cobraba correcto), pero **toda la vista de
   * mora se computa sobre `proximo_pago`**: lista de créditos, dashboard, agenda del día y
   * campañas. Un vendedor que otorgara con `proximo_pago: "2031-01-01"` sacaba ese crédito
   * del radar de cobranza —y de su propio % de morosidad en el ranking— hasta 2031. Solo se
   * corregía si alguna vez entraba un pago, que es justo lo que no pasa con un incobrable.
   *
   * No hay motivo legítimo para que el cliente lo mande: el cronograma ya lo determina.
   */
  const proximoPagoFinal = plan.cuotas[0]?.fecha ?? proximoPago;

  // Crédito + cuotas en una transacción: un crédito nunca queda sin cronograma.
  const credito = await prisma.$transaction(async (tx) => {
    // Número identificador legible, secuencial por tenant (CRD-000123). Advisory lock por
    // tenant para que dos otorgamientos concurrentes no calculen el mismo `_max + 1`
    // (antes eso violaba el @@unique → 500). Se libera al terminar la transacción.
    await lockNumeroCreditoTx(tx, tenantId);
    const maxNum = await tx.creditos.aggregate({
      where: { ...withTenant(tenantId) },
      _max: { numero: true },
    });
    const numero = (maxNum._max.numero ?? 0) + 1;

    const c = await tx.creditos.create({
      data: {
        numero,
        cliente_id: body.cliente_id,
        tipo_credito: body.tipo_credito,
        monto_original: body.monto_original,
        saldo_pendiente: body.monto_original,
        tasa: body.tasa,
        plazo_meses: body.plazo_meses,
        frecuencia,
        frecuencia_def: frecuenciaDef as object,
        cargos: cargosSnapshot as object,
        cronograma: cronogramaSnapshot as object,
        fecha_inicio: fechaInicio,
        proximo_pago: proximoPagoFinal,
        solicitud_id: body.solicitud_id || null,
        vendedor_id: vendedorId,
        // Quién EJECUTÓ el otorgamiento (≠ a quién se le atribuye la venta). Con el nombre
        // congelado, para que la respuesta sobreviva al borrado o renombre de la cuenta.
        otorgado_por: userId,
        otorgado_por_nombre: nombre?.trim() || email || null,
        producto_id: esProducto ? producto!.id : null,
        producto_cantidad: esProducto ? productoCantidad : null,
        riesgo_snapshot: riesgoSnapshot,
        ...withTenant(tenantId),
      },
      include: { cliente: true },
    });

    await tx.cuotas.createMany({
      data: filasCuota.map((f) => ({
        ...withTenant(tenantId),
        credito_id: c.id,
        nro: f.nro,
        fecha_vencimiento: f.fecha_vencimiento,
        saldo_inicial: f.saldo_inicial,
        capital: f.capital,
        interes: f.interes,
        iva: f.iva,
        seguro: f.seguro,
        gastos: f.gastos,
        /*
          🔴 LOS HONORARIOS SE PERSISTEN. Desde la migración 007 el motor los pone en su propia
          columna, pero este `createMany` nunca se actualizó: `cuota_total` los incluía y el
          desglose no, así que la cuota sumaba menos que su total. Y eso no es cosmético:
          `imputarPagoEnCuotas` acota lo cobrable a la suma de los componentes, con lo cual el
          cliente pagaba la cuota "entera", el sobrante caía en la siguiente, y los honorarios
          de gestión —lo que la financiera cobra por haber trabajado ese recupero— no se
          cobraban NUNCA. Medido sobre REF-000013 en dev: $24.506,02 pactados, $0,00 en las
          cuotas. Lo encontró Fernando revisando su primera refinanciación (15/09/2026).
        */
        honorarios: f.honorarios,
        cuota_total: f.cuota_total,
      })),
    });

    if (esProducto) {
      // Crédito de producto: NO mueve caja (el cliente se lleva el producto, no efectivo).
      // El control es el descuento de stock, con guard de carrera (gte) para no sobrevender.
      const upd = await tx.productos.updateMany({
        where: { ...withTenant(tenantId), id: producto!.id, stock: { gte: productoCantidad } },
        data: { stock: { decrement: productoCantidad } },
      });
      if (upd.count === 0) {
        // Otro otorgamiento consumió el stock entre la validación y la transacción.
        throw new ApiError("Stock insuficiente al confirmar (otra operación lo consumió)", "INSUFFICIENT_STOCK", 409);
      }
      // Kardex: registra la salida ligada al crédito (el cache ya bajó atómicamente arriba).
      const prodPost = await tx.productos.findUnique({ where: { id: producto!.id }, select: { stock: true } });
      await registrarMovimientoStock(tx, {
        tenantId, productoId: producto!.id, tipo: "venta_credito",
        cantidad: -productoCantidad, stockResultante: prodPost?.stock ?? 0,
        creditoId: c.id, motivo: `Venta ${formatCreditoNumero(c.numero)}`,
      });
    } else {
      // Fondos (anti-race, autoritativo): revalida DENTRO de la tx con lock de la cuenta,
      // por si otra operación concurrente consumió el saldo tras el pre-chequeo de arriba.
      await assertFondosSuficientesTx(tx, {
        tenantId, vendedorId, cuenta: cuentaDesembolso, monto: Math.abs(c.monto_original),
        mensaje: (disp) => `No hay saldo suficiente en ${vendedorId ? "tu caja" : "la caja principal"} de ${CUENTA_LABEL[cuentaDesembolso]}. Disponible: ${formatPesos(disp)} (otra operación consumió el saldo).`,
      });
      // Movimiento de caja: desembolso (egreso) al otorgar.
      const numComp = await siguienteNumeroComprobante(tx, tenantId, "DES");
      // Un crédito con fecha atrasada no reabre un turno cerrado: el desembolso sale hoy.
      const fechaCaja = await fechaDeCajaTx(tx, tenantId, vendedorId, cuentaDesembolso, fechaInicio);
      await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: fechaCaja,
          tipo: "desembolso",
          monto: -Math.abs(c.monto_original),
          cuenta: cuentaDesembolso, // el desembolso sale de la cuenta elegida (coincide con el control de fondos)
          credito_id: c.id,
          vendedor_id: vendedorId, // sale de la caja personal del vendedor que otorga (null = caja principal)
          origen: etiquetaCaja(!!vendedorId, cuentaDesembolso),
          destino: nombreCompleto(cliente),
          serie: "DES",
          numero: numComp,
          descripcion: `Desembolso ${formatCreditoNumero(c.numero)} · ${nombreCompleto(cliente)}`,
        },
      });
    }

    /**
     * Comisión de otorgamiento cobrada AL INICIO: entra a la caja como ingreso.
     *
     * 🔴 Esto faltaba por completo. El cargo se calculaba, se mostraba en el plan y se sumaba
     * al total que el plan le promete al cliente, pero no generaba ningún movimiento: la
     * financiera la cobraba en mano y en los libros no existía. El plan decía "paga $375.737"
     * y la caja solo registraba la salida del desembolso.
     *
     * Va como asiento APARTE del desembolso, no restándolo, porque son dos hechos distintos:
     * sale plata prestada y entra plata cobrada. Netearlos escondería los dos.
     *
     * Solo cuando NO está financiada: financiada se suma al capital y se cobra dentro de las
     * cuotas, que ya se registran al cobrar. Y solo en créditos de dinero — en uno de producto
     * no hay caja de por medio.
     */
    const comisionCobrada = !esProducto && plan.comision > 0 && !plan.comisionFinanciada
      ? round2(plan.comision) : 0;
    if (comisionCobrada > 0) {
      const numCom = await siguienteNumeroComprobante(tx, tenantId, "COM");
      await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: fechaInicio,
          tipo: "comision_otorgamiento",
          monto: Math.abs(comisionCobrada), // ingreso: lo paga el cliente al firmar
          cuenta: cuentaDesembolso,
          credito_id: c.id,
          vendedor_id: vendedorId,
          origen: nombreCompleto(cliente),
          destino: etiquetaCaja(!!vendedorId, cuentaDesembolso),
          serie: "COM",
          numero: numCom,
          descripcion: `Comisión de otorgamiento ${formatCreditoNumero(c.numero)} · ${nombreCompleto(cliente)}`,
        },
      });
    }

    return c;
  }, TX_PLATA);

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: credito.id,
    accion: "crear",
    descripcion: esProducto
      ? `Crédito ${formatCreditoNumero(credito.numero)} otorgado a ${nombreCompleto(cliente)} — ${producto!.nombre} ×${productoCantidad} (${formatPesos(credito.monto_original)})`
      : `Crédito ${formatCreditoNumero(credito.numero)} otorgado a ${nombreCompleto(cliente)} por ${formatPesos(credito.monto_original)}`,
    meta: {
      numero: credito.numero, monto: credito.monto_original, tasa: credito.tasa,
      plazo_meses: credito.plazo_meses, frecuencia: credito.frecuencia, tipo: credito.tipo_credito,
      // De qué plan salió el precio. El crédito guarda la tasa despejada (para que sea igual
      // a uno tipeado a mano), así que la trazabilidad del coeficiente vive acá.
      ...(planElegido ? { plan: nombrePlan(planElegido), plan_coeficiente: planElegido.coeficiente ?? null } : {}),
      ...(esProducto ? { producto_id: producto!.id, producto: producto!.nombre, cantidad: productoCantidad } : {}),
    },
  });

  return successResponse(credito, 201);
});
