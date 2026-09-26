import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { registrarAuditoria } from "@/lib/audit";
import { hoyComercial, formatFecha } from "@/lib/utils";

/**
 * Cierra las campañas cuya OFERTA ya venció (regla de Fernando, 26/09/2026).
 *
 * Una campaña con fecha de corte es esa oferta: pasado el último día, el descuento ya no se
 * aplica (`promoVigenteAl`) y la campaña queda como HISTORIAL de contacto. No se finaliza a
 * mano ni se reactiva: para volver a ofrecer, se arma otra.
 *
 * Se corre al LEER (lista, detalle, cambio de estado, envío), no por cron: así la pantalla
 * nunca muestra "Activa" una campaña que ya no puede cobrar con descuento, sin depender de
 * a qué hora pasó el job. Es una sola consulta cuando no hay nada que cerrar.
 * Las campañas SIN fecha de corte no vencen: esas se finalizan a mano.
 */
export async function cerrarCampanasVencidas(tenantId: string): Promise<void> {
  const vencidas = await prisma.campanas_cobranza.findMany({
    where: {
      ...withTenant(tenantId),
      estado: { in: ["borrador", "activa"] },
      // `promo_vence` es un día (@db.Date): vence al terminar ese día, así que "vencida" es
      // estrictamente anterior a hoy — el último día todavía vale.
      promo_vence: { lt: hoyComercial() },
    },
    select: { id: true, nombre: true, estado: true, promo_vence: true },
  });
  if (vencidas.length === 0) return;

  await prisma.campanas_cobranza.updateMany({
    where: { ...withTenant(tenantId), id: { in: vencidas.map((c) => c.id) }, estado: { in: ["borrador", "activa"] } },
    data: { estado: "finalizada" },
  });
  for (const c of vencidas) {
    await registrarAuditoria({
      tenantId,
      entidad: "campana",
      entidadId: c.id,
      accion: "actualizar",
      descripcion: `Campaña "${c.nombre}" → finalizada: la oferta venció el ${formatFecha(c.promo_vence)}`,
      meta: { estado_anterior: c.estado, estado_nuevo: "finalizada", motivo: "oferta_vencida" },
    });
  }
}

/** La oferta de la campaña ya venció (mismo criterio que el cierre). */
export function ofertaVencida(promoVence: Date | null): boolean {
  return promoVence != null && promoVence.getTime() < hoyComercial().getTime();
}
