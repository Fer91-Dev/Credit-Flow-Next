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
  etapaRecupero, puedeAcordar, puedeRefinanciar, diasMoraActual,
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
 * Hace cumplir la escalera antes de un ACUERDO. Lanza 409 con el motivo y la sugerencia.
 * Con la config en sus defaults nunca lanza — la escalera arranca apagada.
 */
export async function assertPuedeAcordar(tenantId: string, creditoId: string, cfg: RecuperoConfig): Promise<void> {
  lanzarSiBloquea(puedeAcordar(await senalesRecupero(tenantId, creditoId), cfg), "ESCALERA_ACUERDO");
}

/** Ídem para la REFINANCIACIÓN, que es el escalón irreversible. */
export async function assertPuedeRefinanciar(tenantId: string, creditoId: string, cfg: RecuperoConfig): Promise<void> {
  lanzarSiBloquea(puedeRefinanciar(await senalesRecupero(tenantId, creditoId), cfg), "ESCALERA_REFINANCIACION");
}

function lanzarSiBloquea(v: VeredictoEscalera, code: string): void {
  if (v.permitido) return;
  // El mensaje lleva la sugerencia pegada: una negativa sin alternativa deja al operador
  // frente al cliente sin saber qué ofrecerle.
  throw new ApiError([v.motivo, v.sugerencia].filter(Boolean).join(" "), code, 409);
}
