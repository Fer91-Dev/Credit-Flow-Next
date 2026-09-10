/**
 * Pipeline de recupero — capa server: junta de la base las señales reales de un crédito
 * (gestiones humanas, promesas, acuerdos) y las pasa al dominio puro `lib/domain/recupero.ts`.
 *
 * Se lee todo de una: las cuatro consultas van en paralelo porque ninguna depende de otra,
 * y esto corre en el camino de un acuerdo o una refinanciación, que ya son operaciones
 * pesadas.
 */
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { hoyComercial } from "@/lib/utils";
import {
  etapaRecupero, puedeAcordar, puedeRefinanciar, puedeUsarTasa, puedeCobrar, diasMoraActual,
  type SenalesRecupero, type EtapaRecupero, type RecuperoConfig, type VeredictoEscalera,
} from "@/lib/domain";
import { ApiError } from "@/lib/auth";

/**
 * Señales del crédito para ubicarlo en la escalera.
 *
 * `diasMora` se calcula EN VIVO desde `proximo_pago` y no se toma del cache `dias_mora`,
 * que solo se escribe al cobrar: un crédito al que nunca le pagaron lo tiene en 0 para
 * siempre y quedaría eternamente "al día" para el pipeline.
 */
export async function senalesRecupero(tenantId: string, creditoId: string): Promise<SenalesRecupero> {
  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id: creditoId },
    select: { estado: true, proximo_pago: true, es_refinanciacion: true, refinancia_a: true },
  });
  if (!credito) throw new ApiError("El crédito no existe", "NOT_FOUND", 404);

  /**
   * CUÁNTAS REFINANCIACIONES HAY DETRÁS, caminando la cadena `refinancia_a` hacia atrás.
   *
   * Se cuenta y no se guarda, por la misma razón que la etapa y la mora: un contador que hay
   * que acordarse de incrementar se desincroniza el primer día, y este decide si una deuda se
   * puede volver a refinanciar.
   *
   * El corte a 20 saltos no es un límite de negocio —el tope real lo pone la configuración—
   * sino una red contra un ciclo en los datos: sin él, un `refinancia_a` que apunte en círculo
   * cuelga la request para siempre. Con el tope en 1 la cadena casi nunca pasa de un salto.
   */
  let encadenadas = 0;
  let anterior = credito.es_refinanciacion ? credito.refinancia_a : null;
  while (anterior && encadenadas < 20) {
    encadenadas++;
    const previo = await prisma.creditos.findFirst({
      where: { ...withTenant(tenantId), id: anterior },
      select: { es_refinanciacion: true, refinancia_a: true },
    });
    anterior = previo?.es_refinanciacion ? previo.refinancia_a : null;
  }

  const [gestiones, promesaPendiente, promesasIncumplidas, acuerdoVigente, acuerdosRotos] = await Promise.all([
    // Solo gestiones HUMANAS: los envíos de campaña y las alertas del cron llevan
    // `automatico: true` y no son un contacto con el deudor.
    prisma.acciones_cobranza.count({
      where: { ...withTenant(tenantId), credito_id: creditoId, automatico: false },
    }),
    prisma.acciones_cobranza.count({
      where: { ...withTenant(tenantId), credito_id: creditoId, promesa_estado: "pendiente" },
    }),
    prisma.acciones_cobranza.count({
      where: { ...withTenant(tenantId), credito_id: creditoId, promesa_estado: "incumplida" },
    }),
    prisma.acuerdos_pago.count({
      where: { ...withTenant(tenantId), credito_id: creditoId, estado: "vigente" },
    }),
    prisma.acuerdos_pago.count({
      where: { ...withTenant(tenantId), credito_id: creditoId, estado: "roto" },
    }),
  ]);

  return {
    diasMora: diasMoraActual(credito.proximo_pago, hoyComercial()),
    gestiones,
    promesaPendiente: promesaPendiente > 0,
    promesasIncumplidas,
    acuerdoVigente: acuerdoVigente > 0,
    acuerdosRotos,
    refinanciado: credito.estado === "refinanciado",
    refinanciacionesEncadenadas: encadenadas,
  };
}

/** Etapa del pipeline en la que está el crédito (derivada, no persistida). */
export async function etapaDeCredito(tenantId: string, creditoId: string): Promise<EtapaRecupero> {
  return etapaRecupero(await senalesRecupero(tenantId, creditoId));
}

/**
 * Quién pide la operación y si viene con la autorización explícita del admin.
 *
 * 🔴 Toda regla de escalera necesita una válvula de escape, o alguien termina editando la
 * base un domingo. El criterio es el mismo que ya usa el motor de riesgo con
 * `autorizacion_riesgo`: el vendedor no puede saltarse la regla, el admin sí, asumiendo la
 * decisión — y queda auditada.
 */
export interface ActorEscalera {
  role: string;
  /** El admin marcó explícitamente que quiere seguir igual. */
  autorizacionAdmin?: boolean;
}

/** `true` si este actor puede pasar por encima de la regla. */
function autorizaAdmin(actor?: ActorEscalera): boolean {
  return actor?.role === "admin" && actor.autorizacionAdmin === true;
}

/**
 * ¿HAY UNA OFERTA DE RECUPERO EN LA CALLE PARA ESTE CRÉDITO?
 *
 * Regla de Fernando: al castigado se le cobra, salvo que esté dentro de una campaña de
 * Incobrables. El motivo es el mismo por el que un acuerdo vigente apaga el cobro del plan
 * viejo: la campaña ya le mandó al cliente un número —"pagá $800.000,00 y cancelás todo"—
 * y la terminal cobraría OTRO, el pleno, imputado mora → interés → cargos → capital. Dos
 * importes sobre la misma deuda, con el cliente enfrente, y el que vale es el que se le
 * prometió por escrito.
 *
 * El camino correcto cuando aparece a pagar la oferta es **cerrar el caso** desde
 * Incobrables: cobra lo acordado, condona el resto y deja el crédito en `cancelado` con la
 * pérdida registrada. Un cobro suelto por la terminal no condona nada, así que el cliente
 * pagaría la oferta y seguiría debiendo.
 *
 * 🔴 NO ES UN PORTAZO. Si el cliente aparece con MENOS de la oferta, rechazarle la plata a un
 * deudor castigado es lo peor que puede pasar en toda la pantalla. Por eso bloquea como el
 * resto de la escalera: con la excepción explícita del admin (`autorizacion_admin`), que ve
 * el motivo y decide. El vendedor no puede pisarla.
 *
 * Solo mira campañas `activa`: una finalizada o en borrador no le prometió nada a nadie.
 */
export async function veredictoCobroEnCampanaRecupero(
  tenantId: string,
  creditoId: string,
  estadoCredito: string,
): Promise<VeredictoEscalera> {
  // Solo aplica al castigado. Un crédito del circuito normal en una campaña de MORA se sigue
  // cobrando igual: ahí la campaña descuenta punitorios, no perdona capital.
  if (estadoCredito !== "incobrable") return { permitido: true };
  const objetivo = await prisma.campana_objetivo.findFirst({
    where: {
      ...withTenant(tenantId),
      credito_id: creditoId,
      campana: { estado: "activa", tipo: "recupero" },
    },
    select: { campana: { select: { nombre: true } } },
  });
  if (!objetivo) return { permitido: true };
  return {
    permitido: false,
    motivo: `Este crédito está dentro de la campaña de recupero "${objetivo.campana.nombre}", que ya le ofreció al cliente un importe para cancelar toda la deuda. Cobrarle acá le imputaría otro número y seguiría debiendo.`,
    sugerencia: "Cerrá el caso desde Incobrables: cobra lo acordado, condona el resto y deja el crédito cancelado.",
  };
}

/**
 * Hace cumplir la escalera antes de un ACUERDO. Lanza 409 con el motivo y la sugerencia.
 * Con la config en sus defaults nunca lanza — la escalera arranca apagada.
 */
export async function assertPuedeAcordar(
  tenantId: string, creditoId: string, cfg: RecuperoConfig, actor?: ActorEscalera,
): Promise<void> {
  lanzarSiBloquea(puedeAcordar(await senalesRecupero(tenantId, creditoId), cfg), "ESCALERA_ACUERDO", actor);
}

/** Ídem para la REFINANCIACIÓN, que es el escalón irreversible. */
export async function assertPuedeRefinanciar(
  tenantId: string, creditoId: string, cfg: RecuperoConfig, actor?: ActorEscalera,
  opts?: {
    /**
     * La ENTREGA de esta misma refinanciación ya se cobró (el cliente puso plata para que la
     * deuda a consolidar sea menor). Ver abajo por qué cambia la lectura de los días.
     */
    entregaCobrada?: boolean;
  },
): Promise<void> {
  const s = await senalesRecupero(tenantId, creditoId);
  /**
   * 🔴 LA ENTREGA NO PUEDE VOLVER IMPOSIBLE LA REFINANCIACIÓN QUE LA MOTIVÓ.
   *
   * Un cobro mueve `proximo_pago` a la cuota más vieja que quede impaga, así que una entrega
   * grande baja los días de atraso — incluso a 0 si tapó todo lo vencido. Sin esta corrección,
   * el operador cobraba la entrega y acto seguido el server le contestaba "todavía no llegó al
   * mínimo de días para refinanciar": la plata adentro y el arreglo imposible de cerrar.
   *
   * Ese descenso no significa que el cliente se haya puesto al día: es el anticipo del plan
   * nuevo. Se levanta SOLO el piso de días; el resto de la escalera (exigir un acuerdo roto
   * antes de refinanciar) se sigue evaluando igual, porque eso no lo cambia haber cobrado.
   */
  const senales = opts?.entregaCobrada
    ? { ...s, diasMora: Math.max(s.diasMora, cfg.dias_min_mora_refinanciar) }
    : s;
  lanzarSiBloquea(puedeRefinanciar(senales, cfg), "ESCALERA_REFINANCIACION", actor);
}

/**
 * Hace cumplir el CIERRE de la escalera antes de un COBRO: pasado el umbral de
 * refinanciación, el plan viejo ya no se cobra.
 *
 * 🔴 ESTE ES EL CAMINO POR DONDE ENTRA TODA LA PLATA DEL SISTEMA. La carga masiva de
 * planillas y el cobro de mostrador pasan los dos por `POST /api/pagos`, así que la guarda va
 * ahí y no en la pantalla: un bloqueo que solo existe en el front no bloquea nada.
 *
 * Devuelve `true` cuando la regla SÍ bloqueaba y un admin la autorizó igual — el caller lo
 * necesita para dejarlo asentado en la auditoría. `false` = no había nada que autorizar.
 */
export async function assertPuedeCobrar(
  tenantId: string,
  creditoId: string,
  cfg: RecuperoConfig,
  actor?: ActorEscalera,
  opts?: { entregaDe?: "acuerdo" | "refinanciacion"; estadoCredito?: string },
): Promise<boolean> {
  /**
   * La campaña de recupero se evalúa ANTES del atajo de abajo: no depende de
   * `bloquear_cobro_sin_refinanciar` —esa regla es la escalera del crédito vivo— y un
   * castigado ya salió de esa escalera. Cuesta una consulta y solo para los incobrables,
   * que son pocos por definición; el resto de los cobros no la paga.
   */
  const campana = await veredictoCobroEnCampanaRecupero(tenantId, creditoId, opts?.estadoCredito ?? "");
  if (!campana.permitido) {
    if (lanzarSiBloquea(campana, "COBRO_EN_CAMPANA_RECUPERO", actor)) return true;
  }
  // Atajo: con la regla apagada no se consulta la base. Es el caso de casi todos los cobros,
  // y son seis consultas que no tiene sentido pagar en el camino caliente del dinero.
  if (!cfg.bloquear_cobro_sin_refinanciar) return false;
  const v = puedeCobrar(await senalesRecupero(tenantId, creditoId), cfg, opts);
  return lanzarSiBloquea(v, "COBRO_REQUIERE_REFINANCIAR", actor);
}

/**
 * El mismo veredicto, para MOSTRARLO antes de que haya un peso de por medio.
 *
 * Es la lección de la entrega de Estela Moreno, aplicada acá: si el operador se entera del
 * bloqueo recién al apretar "Cobrar", ya escribió el monto delante del cliente. La pantalla
 * de cobro lo pregunta al elegir el crédito.
 */
export async function veredictoCobro(
  tenantId: string, creditoId: string, cfg: RecuperoConfig, estadoCredito?: string,
): Promise<VeredictoEscalera> {
  // Mismo orden que `assertPuedeCobrar`, o la pantalla diría que se puede y el server no.
  const campana = await veredictoCobroEnCampanaRecupero(tenantId, creditoId, estadoCredito ?? "");
  if (!campana.permitido) return campana;
  if (!cfg.bloquear_cobro_sin_refinanciar) return { permitido: true };
  return puedeCobrar(await senalesRecupero(tenantId, creditoId), cfg);
}

/**
 * ¿CUÁLES DE ESTOS CRÉDITOS YA NO SE COBRAN? — el mismo veredicto, pero para una LISTA.
 *
 * 🔴 POR QUÉ NO LO PUEDE DECIDIR LA PANTALLA. Parece que alcanzaría con mirar los días de
 * atraso, pero no: el bloqueo también depende de si el crédito tiene un acuerdo vigente y de
 * si la refinanciación está efectivamente abierta —y eso último sale de cuántos acuerdos
 * ROTOS arrastra, un dato que la lista de créditos no trae. Con la regla "exigir un acuerdo
 * roto antes de refinanciar" prendida, un crédito de 118 días sin ningún acuerdo roto SÍ se
 * cobra; el navegador lo marcaría como incobrable y la campaña dejaría afuera a alguien que
 * podía pagar hoy.
 *
 * Los acuerdos rotos se cuentan de TODOS los créditos en UNA consulta agrupada, no de a uno:
 * `senalesRecupero` hace cinco consultas por crédito, y sobre una lista de mil sería absurdo.
 * Es exacto igualmente porque `puedeCobrar` —sin la excepción de la entrega— solo mira días de
 * mora, acuerdo vigente y acuerdos rotos.
 */
export async function cobroBloqueadoPorCredito(
  tenantId: string,
  creditos: { id: string; diasMora: number; acuerdoVigente: boolean }[],
  cfg: RecuperoConfig,
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  // Con la regla apagada no se bloquea ninguno: ni vale la consulta.
  if (!cfg.bloquear_cobro_sin_refinanciar || creditos.length === 0) {
    for (const c of creditos) out.set(c.id, false);
    return out;
  }

  const rotos = await prisma.acuerdos_pago.groupBy({
    by: ["credito_id"],
    where: { ...withTenant(tenantId), estado: "roto", credito_id: { in: creditos.map((c) => c.id) } },
    _count: { _all: true },
  });
  const rotosPorCredito = new Map(rotos.map((r) => [r.credito_id, r._count._all]));

  /**
   * 🔴 LA PROFUNDIDAD DE LA CADENA TAMBIÉN ENTRA ACÁ, O SE ARMA EL CALLEJÓN.
   *
   * `puedeCobrar` cierra el cobro pasado el umbral, pero tiene una guarda: si tampoco se
   * puede refinanciar, vuelve a abrirlo — nunca las dos puertas cerradas. Esa guarda llama a
   * `puedeRefinanciar`, así que necesita saber cuántas refinanciaciones lleva la deuda.
   *
   * Sin este dato, esta función pasaba 0 y una refinanciación de 60 días quedaba con el cobro
   * bloqueado Y el tope de cadena alcanzado: ni cobrar ni refinanciar. Y encima la lista le
   * ofrecía "Refinanciar" al operador, que es la acción que el server iba a rechazar.
   *
   * Se resuelve con UNA consulta: todas las refinanciaciones del tenant con su origen. La
   * cadena se camina en memoria — son pocas filas y ya están todas acá.
   */
  const profundidad = new Map<string, number>();
  if (cfg.max_refinanciaciones_encadenadas > 0) {
    const refis = await prisma.creditos.findMany({
      where: { ...withTenant(tenantId), es_refinanciacion: true },
      select: { id: true, refinancia_a: true },
    });
    const origenDe = new Map(refis.map((r) => [r.id, r.refinancia_a]));
    for (const c of creditos) {
      let n = 0;
      let cursor: string | null | undefined = origenDe.has(c.id) ? c.id : null;
      // El corte a 20 es una red contra un ciclo en los datos, no un límite de negocio.
      while (cursor && n < 20) { n++; cursor = origenDe.get(cursor) ?? null; }
      profundidad.set(c.id, n);
    }
  }

  for (const c of creditos) {
    const v = puedeCobrar(
      {
        diasMora: c.diasMora,
        acuerdoVigente: c.acuerdoVigente,
        acuerdosRotos: rotosPorCredito.get(c.id) ?? 0,
        refinanciacionesEncadenadas: profundidad.get(c.id) ?? 0,
        // No los mira `puedeCobrar` sin la excepción de la entrega; van en cero para no
        // pagar cinco consultas por crédito.
        gestiones: 0,
        promesaPendiente: false,
        promesasIncumplidas: 0,
      },
      cfg,
    );
    out.set(c.id, !v.permitido);
  }
  return out;
}

/**
 * La tasa pactada no puede quedar por debajo de la del crédito original: bajarla es una
 * quita que no pasa por el tope de las quitas ni queda registrada como tal.
 */
export function assertPuedeUsarTasa(
  tasaNueva: number, tasaOriginal: number, cfg: RecuperoConfig, actor?: ActorEscalera,
): void {
  lanzarSiBloquea(puedeUsarTasa(tasaNueva, tasaOriginal, cfg), "TASA_MENOR_A_ORIGINAL", actor);
}

/** `true` si la regla bloqueaba y el admin la autorizó igual (para asentarlo en la auditoría). */
function lanzarSiBloquea(v: VeredictoEscalera, code: string, actor?: ActorEscalera): boolean {
  if (v.permitido) return false;
  if (autorizaAdmin(actor)) return true; // el admin asume la decisión (se audita en el caller)
  // El mensaje lleva la sugerencia pegada: una negativa sin alternativa deja al operador
  // frente al cliente sin saber qué ofrecerle. Y si quien pregunta es admin, se le dice que
  // puede seguir igual — si no, el 409 parece un bug del sistema.
  const puedeForzar = actor?.role === "admin"
    ? " Como administrador podés autorizarlo igual, y queda registrado."
    : "";
  throw new ApiError([v.motivo, v.sugerencia].filter(Boolean).join(" ") + puedeForzar, code, 409);
}

/** Lo que salió de la caja y lo que volvió, en toda la cadena de un crédito. */
export interface PlataDeCadena {
  /** `monto_original` del crédito RAÍZ: la única plata que de verdad se entregó. */
  prestado: number;
  /** Todo lo cobrado en cualquier eslabón de la cadena. */
  recuperado: number;
  /** Lo prestado que todavía no volvió. El piso de cualquier negociación. */
  enRiesgo: number;
  raizId: string;
  eslabones: number;
}

/**
 * CUÁNTA PLATA SALIÓ DE LA CAJA Y CUÁNTA VOLVIÓ, mirando toda la cadena de refinanciaciones.
 *
 * 🔴 No se puede usar el `monto_original` del crédito que se está mirando. En un refinanciado
 * ese campo NO es plata prestada: es la deuda vieja consolidada —capital, más el interés que
 * se capitalizó, más los punitorios—. Sobre el caso de Ricardo Paz dice $3.150.000,00 cuando
 * lo que salió de la ventanilla fueron $1.200.000,00. Tomarlo como "lo prestado" comete el
 * mismo error de anatocismo que la deuda nominal, y encima al revés de lo que conviene: haría
 * creer que se perdió casi el triple de lo que se perdió.
 *
 * Lo prestado de verdad es el `monto_original` del crédito RAÍZ, y lo recuperado es todo lo
 * que se cobró en CUALQUIER eslabón: las cuotas que pagó del original antes de refinanciar
 * valen igual que las que pagó después.
 *
 * 🔴 ES LA ÚNICA DEFINICIÓN. La pestaña Incobrables hacía esta misma caminata en el navegador
 * y la vista previa de la campaña la habría hecho por tercera vez. Tres copias de la cuenta
 * que decide cuánta plata se resigna es exactamente cómo dos pantallas terminan diciendo
 * números distintos sobre el mismo caso.
 *
 * Va POR LOTE porque el caso normal es una lista: la pestaña trae todos los castigados de una.
 * Se resuelve nivel por nivel (una consulta por salto, no una por crédito) y corta a los 20
 * saltos como red contra un ciclo de datos.
 */
export async function plataDeLaCadenaLote(
  tenantId: string,
  creditoIds: string[],
): Promise<Map<string, PlataDeCadena>> {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const salida = new Map<string, PlataDeCadena>();
  if (creditoIds.length === 0) return salida;

  /** Estado de la caminata de cada cadena: en qué eslabón va y qué acumuló. */
  const enCurso = new Map(
    creditoIds.map((id) => [id, { actual: id, recuperado: 0, prestado: 0, raizId: id, eslabones: 0 }]),
  );

  for (let salto = 0; salto < 20 && enCurso.size > 0; salto++) {
    const pendientes = [...new Set([...enCurso.values()].map((e) => e.actual))];
    const filas = await prisma.creditos.findMany({
      where: { ...withTenant(tenantId), id: { in: pendientes } },
      select: {
        id: true,
        monto_original: true,
        refinancia_a: true,
        // Lo cobrado sale de las CUOTAS y no de `pagos`: un pago anulado se revierte en las
        // cuotas, así que sumarlo desde ahí contaría plata que se devolvió.
        cuotas: { select: { pagado_capital: true, pagado_interes: true, pagado_mora: true, pagado_cargos: true } },
      },
    });
    const porId = new Map(filas.map((f) => [f.id, f]));

    for (const [origenId, e] of [...enCurso]) {
      const fila = porId.get(e.actual);
      if (!fila) {
        // Se cortó la cadena (el eslabón previo no existe o quedó fuera del tenant): se cierra
        // con lo acumulado hasta acá en vez de perder el caso entero.
        enCurso.delete(origenId);
        salida.set(origenId, {
          prestado: r2(e.prestado), recuperado: r2(e.recuperado),
          enRiesgo: r2(Math.max(0, e.prestado - e.recuperado)), raizId: e.raizId, eslabones: e.eslabones,
        });
        continue;
      }
      e.recuperado += fila.cuotas.reduce(
        (a, q) => a + q.pagado_capital + q.pagado_interes + q.pagado_mora + q.pagado_cargos,
        0,
      );
      // Solo el eslabón RAÍZ aporta capital prestado: los demás son deuda consolidada. Como se
      // sobrescribe en cada salto, al llegar al final queda el de la raíz.
      e.prestado = fila.monto_original;
      e.raizId = fila.id;
      e.eslabones++;

      if (!fila.refinancia_a) {
        enCurso.delete(origenId);
        salida.set(origenId, {
          prestado: r2(e.prestado), recuperado: r2(e.recuperado),
          enRiesgo: r2(Math.max(0, e.prestado - e.recuperado)), raizId: e.raizId, eslabones: e.eslabones,
        });
      } else {
        e.actual = fila.refinancia_a;
      }
    }
  }

  // Cadenas que tocaron el corte de 20 saltos: se devuelven con lo acumulado.
  for (const [origenId, e] of enCurso) {
    salida.set(origenId, {
      prestado: r2(e.prestado), recuperado: r2(e.recuperado),
      enRiesgo: r2(Math.max(0, e.prestado - e.recuperado)), raizId: e.raizId, eslabones: e.eslabones,
    });
  }

  return salida;
}

/** La cadena de UN crédito. Atajo sobre `plataDeLaCadenaLote`. */
export async function plataDeLaCadena(tenantId: string, creditoId: string): Promise<PlataDeCadena> {
  const lote = await plataDeLaCadenaLote(tenantId, [creditoId]);
  return lote.get(creditoId) ?? { prestado: 0, recuperado: 0, enRiesgo: 0, raizId: creditoId, eslabones: 0 };
}
