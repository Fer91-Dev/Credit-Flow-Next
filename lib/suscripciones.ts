/**
 * Suscripciones del SaaS (server). Lee/activa el plan de un tenant y **sincroniza
 * `tenants.features`** con las features del plan (fuente de verdad de los entitlements).
 * Modo manual: el dueño activa con `scripts/activar-plan.mjs`. Los proveedores automáticos
 * (MercadoPago/Paddle) llamarán a `activarPlan` desde su webhook, sin cambiar esta capa.
 */
import { prisma } from "@/lib/prisma";
import { PLANES, featuresDePlan, type PlanClave } from "@/lib/planes";

export interface SuscripcionActual {
  tenant_id: string;
  plan: PlanClave;
  estado: string;
  proveedor: string;
  monto: number;
  periodo_desde: Date | null;
  periodo_hasta: Date | null;
  notas: string | null;
}

/** ¿Es un Pro cuyo período ya venció? */
export function estaVencida(row: { plan: string; estado: string; periodo_hasta: Date | null } | null): boolean {
  return !!row && row.plan === "pro" && row.estado !== "cancelada" && row.periodo_hasta != null && row.periodo_hasta.getTime() < Date.now();
}

/** Suscripción vigente del tenant (default Free si nunca se activó nada). Reporta "vencida"
 *  en vivo si el Pro caducó, aunque el cron todavía no lo haya persistido. */
export async function getSuscripcion(tenantId: string): Promise<SuscripcionActual> {
  const row = await prisma.suscripciones.findUnique({ where: { tenant_id: tenantId } });
  if (!row) {
    return { tenant_id: tenantId, plan: "free", estado: "activa", proveedor: "manual", monto: 0, periodo_desde: null, periodo_hasta: null, notas: null };
  }
  const estado = estaVencida(row) ? "vencida" : row.estado;
  return { ...row, estado, plan: (row.plan in PLANES ? row.plan : "free") as PlanClave };
}

/**
 * Activa/actualiza el plan de un tenant y deja `tenants.features` en sincronía (transacción).
 * `meses` fija el vencimiento del período (null = sin vencimiento). Al pasar a "free" o
 * cancelar, las features premium se quitan.
 */
export async function activarPlan(
  tenantId: string,
  plan: PlanClave,
  opts: { meses?: number; monto?: number; proveedor?: string; notas?: string; estado?: string } = {},
): Promise<SuscripcionActual> {
  const desde = new Date();
  let hasta: Date | null = null;
  if (opts.meses && opts.meses > 0) {
    hasta = new Date(desde);
    hasta.setMonth(hasta.getMonth() + opts.meses);
  }
  const estado = opts.estado ?? "activa";
  // Si el plan no está activo, no habilita features (aunque el plan sea "pro").
  const features = estado === "activa" ? featuresDePlan(plan) : [];

  // Campos propios del PLAN (los toca esta función).
  const base = {
    plan,
    estado,
    proveedor: opts.proveedor ?? "manual",
    periodo_desde: desde,
    periodo_hasta: hasta,
  };
  // `monto` y `notas` son metadatos del OWNER (editables en el panel de plataforma):
  // NO se pisan al cambiar de plan — solo se escriben si vienen explícitos en `opts`.
  const update: Record<string, unknown> = { ...base };
  if (opts.monto !== undefined) update.monto = opts.monto;
  if (opts.notas !== undefined) update.notas = opts.notas;

  await prisma.$transaction([
    prisma.suscripciones.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...base, monto: opts.monto ?? 0, notas: opts.notas ?? null },
      update,
    }),
    prisma.tenants.update({ where: { id: tenantId }, data: { features } }),
  ]);

  return getSuscripcion(tenantId);
}
