import { prisma } from "@/lib/prisma";

/**
 * PURGA DE LA TRAZA DE AUDITORÍA.
 *
 * 🔴 POR QUÉ HACE FALTA. `auditoria` crece con cada mutación de negocio —un cobro, una
 * edición de cliente, un cambio de configuración— y hasta hoy **no se borraba nunca**: el
 * propio comentario del modelo lo decía. A un ritmo de cien operaciones por día son ~36.500
 * filas al año por financiera, y la tabla solo se lee para mirar los últimos movimientos.
 *
 * 🔴 POR QUÉ ESTÁ APAGADA POR DEFECTO.
 *
 * Borrar una traza de auditoría no se deshace. Cuánto tiempo hay que conservarla no lo decide
 * un default mío: depende de qué le pueda pedir a la financiera un cliente o un inspector.
 * Así que no borra nada salvo que alguien fije `AUDITORIA_RETENCION_DIAS` a propósito, y hay
 * un piso de 90 días para que un valor tipeado de más (un 7 donde iba 700) no se lleve puesta
 * la historia del mes.
 *
 * Lo que SÍ está resuelto es el mecanismo: corre en el cron diario, borra de a lotes para no
 * tomar la tabla entera en una sola transacción, y deja asentado en la propia auditoría
 * cuántas filas sacó — que es el único registro que no se puede purgar a sí mismo sin dejar
 * rastro.
 */

/** Piso de seguridad: por debajo de esto no se purga, aunque la variable diga otra cosa. */
export const RETENCION_MINIMA_DIAS = 90;
/** Cuántas filas por vuelta. Suficientes para avanzar, pocas para no bloquear la tabla. */
const LOTE = 5_000;
/** Tope de vueltas por corrida: si hay más para borrar, sigue mañana. */
const MAX_LOTES = 20;

export interface ResultadoPurga {
  /** null = apagada (no se fijó la variable). */
  retencion_dias: number | null;
  borradas: number;
  /** Quedaron filas viejas para la próxima corrida. */
  quedan: boolean;
  motivo?: string;
}

export async function purgarAuditoria(hoy = new Date()): Promise<ResultadoPurga> {
  const crudo = process.env.AUDITORIA_RETENCION_DIAS;
  if (!crudo) return { retencion_dias: null, borradas: 0, quedan: false, motivo: "sin configurar" };

  const dias = Number(crudo);
  if (!Number.isFinite(dias) || dias < RETENCION_MINIMA_DIAS) {
    return {
      retencion_dias: null,
      borradas: 0,
      quedan: false,
      motivo: `valor invalido (${crudo}): el minimo es ${RETENCION_MINIMA_DIAS} dias`,
    };
  }

  const corte = new Date(hoy.getTime() - dias * 86_400_000);
  let borradas = 0;
  let quedan = false;

  for (let vuelta = 0; vuelta < MAX_LOTES; vuelta++) {
    /**
     * Se eligen los ids primero y se borra por id: un `deleteMany` con la condición de fecha
     * sobre una tabla grande toma un lock largo, y acá no hay ninguna urgencia — lo que no
     * entre hoy se borra mañana.
     */
    const viejas = await prisma.auditoria.findMany({
      where: { created_at: { lt: corte } },
      select: { id: true },
      take: LOTE,
    });
    if (viejas.length === 0) break;
    const r = await prisma.auditoria.deleteMany({ where: { id: { in: viejas.map((a) => a.id) } } });
    borradas += r.count;
    if (viejas.length === LOTE && vuelta === MAX_LOTES - 1) quedan = true;
  }

  return { retencion_dias: dias, borradas, quedan };
}
