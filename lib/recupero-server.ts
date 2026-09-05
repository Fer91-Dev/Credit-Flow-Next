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
    select: { estado: true, proximo_pago: true },
  });
  if (!credito) throw new ApiError("El crédito no existe", "NOT_FOUND", 404);

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
  opts?: { entregaDe?: "acuerdo" | "refinanciacion" },
): Promise<boolean> {
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
  tenantId: string, creditoId: string, cfg: RecuperoConfig,
): Promise<VeredictoEscalera> {
  if (!cfg.bloquear_cobro_sin_refinanciar) return { permitido: true };
  return puedeCobrar(await senalesRecupero(tenantId, creditoId), cfg);
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
