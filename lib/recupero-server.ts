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
  etapaRecupero, puedeAcordar, puedeRefinanciar, puedeUsarTasa, diasMoraActual,
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
): Promise<void> {
  lanzarSiBloquea(puedeRefinanciar(await senalesRecupero(tenantId, creditoId), cfg), "ESCALERA_REFINANCIACION", actor);
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

function lanzarSiBloquea(v: VeredictoEscalera, code: string, actor?: ActorEscalera): void {
  if (v.permitido) return;
  if (autorizaAdmin(actor)) return; // el admin asume la decisión (se audita en el caller)
  // El mensaje lleva la sugerencia pegada: una negativa sin alternativa deja al operador
  // frente al cliente sin saber qué ofrecerle. Y si quien pregunta es admin, se le dice que
  // puede seguir igual — si no, el 409 parece un bug del sistema.
  const puedeForzar = actor?.role === "admin"
    ? " Como administrador podés autorizarlo igual, y queda registrado."
    : "";
  throw new ApiError([v.motivo, v.sugerencia].filter(Boolean).join(" ") + puedeForzar, code, 409);
}
