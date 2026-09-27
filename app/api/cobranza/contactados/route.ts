import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import { hoyComercial, nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/contactados
 *
 * Los contactos del DÍA (hora de Argentina) y cuántos hizo cada agente hoy y en el mes.
 *
 * Fernando (27/09/2026): «contacté a Elena Godoy, bajó de 8 a 7, pero ¿cómo veo a los que ya
 * contacté?» — la agenda mostraba lo que falta y lo hecho desaparecía. Y «que se vea en el
 * tablero, para que el administrador vea qué agente lleva mayor número de contactos».
 *
 *  · Solo gestiones HUMANAS (`automatico = false`): un recordatorio del cron no es trabajo
 *    de nadie.
 *  · El vendedor ve SUS contactos (los que hizo él); el admin, los de todos.
 *  · El autor sale de `gestionado_por`, congelado al gestionar. Las gestiones viejas que no
 *    lo tienen se cuentan como "Sin registrar" en vez de desaparecer.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, userId } = await requireAuth(req);

  // El día y el mes COMERCIALES de Argentina (UTC−3, sin horario de verano): la medianoche
  // argentina es 03:00 UTC. Sin esto, un contacto de las 22:00 caía en el día siguiente.
  const hoy = hoyComercial();
  const inicioDia = new Date(hoy.getTime() + 3 * 3600_000);
  const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1) + 3 * 3600_000);

  const base = {
    ...withTenant(tenantId),
    automatico: false,
    ...(role === "vendedor" ? { gestionado_por: userId } : {}),
  };

  const [delDia, delMes] = await Promise.all([
    prisma.acciones_cobranza.findMany({
      where: { ...base, created_at: { gte: inicioDia } },
      orderBy: { created_at: "desc" },
      take: 500,
      select: {
        id: true, created_at: true, tipo: true, resultado: true, promesa_monto: true,
        gestionado_por: true, gestionado_por_nombre: true,
        credito: {
          select: {
            id: true, numero: true, es_refinanciacion: true, refinancia_a: true,
            cliente: { select: { id: true, nombre: true, apellido: true, telefono: true } },
          },
        },
      },
    }),
    prisma.acciones_cobranza.groupBy({
      by: ["gestionado_por", "gestionado_por_nombre"],
      where: { ...base, created_at: { gte: inicioMes } },
      _count: { _all: true },
    }),
  ]);

  const origen = await numerosRefinanciados(tenantId, delDia.map((a) => a.credito));

  const items = delDia.map((a) => ({
    id: a.id,
    fecha: a.created_at,
    tipo: a.tipo,
    resultado: a.resultado,
    promesa_monto: a.promesa_monto,
    agente: a.gestionado_por_nombre ?? "Sin registrar",
    credito_id: a.credito.id,
    credito_numero: a.credito.numero,
    credito_refinancia_a_numero: a.credito.refinancia_a ? origen.get(a.credito.refinancia_a) ?? null : null,
    cliente_id: a.credito.cliente.id,
    cliente: nombreCompleto(a.credito.cliente),
    telefono: a.credito.cliente.telefono,
  }));

  // Por agente: el mes sale del groupBy; el día, de la lista (ya está cargada).
  const porAgente = new Map<string, { agente: string; hoy: number; mes: number; clientes_hoy: Set<string> }>();
  const clave = (id: string | null, nombre: string | null) => id ?? `sin:${nombre ?? ""}`;
  for (const g of delMes) {
    const k = clave(g.gestionado_por, g.gestionado_por_nombre);
    const fila = porAgente.get(k) ?? { agente: g.gestionado_por_nombre ?? "Sin registrar", hoy: 0, mes: 0, clientes_hoy: new Set<string>() };
    fila.mes += g._count._all;
    porAgente.set(k, fila);
  }
  for (const a of delDia) {
    const k = clave(a.gestionado_por, a.gestionado_por_nombre);
    const fila = porAgente.get(k) ?? { agente: a.gestionado_por_nombre ?? "Sin registrar", hoy: 0, mes: 0, clientes_hoy: new Set<string>() };
    fila.hoy += 1;
    fila.clientes_hoy.add(a.credito.cliente.id);
    porAgente.set(k, fila);
  }
  const agentes = [...porAgente.values()]
    .map((f) => ({ agente: f.agente, hoy: f.hoy, clientes_hoy: f.clientes_hoy.size, mes: f.mes }))
    .sort((a, b) => b.hoy - a.hoy || b.mes - a.mes);

  return successResponse({
    items,
    /** Clientes DISTINTOS contactados hoy: un cliente llamado dos veces cuenta una. */
    clientes_hoy: new Set(items.map((i) => i.cliente_id)).size,
    gestiones_hoy: items.length,
    agentes,
  });
});
