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

/** Suscripción vigente del tenant (default Free si nunca se activó nada). */
export async function getSuscripcion(tenantId: string): Promise<SuscripcionActual> {
  const row = await prisma.suscripciones.findUnique({ where: { tenant_id: tenantId } });
  if (!row) {
    return { tenant_id: tenantId, plan: "free", estado: "activa", proveedor: "manual", monto: 0, periodo_desde: null, periodo_hasta: null, notas: null };
  }
  return { ...row, plan: (row.plan in PLANES ? row.plan : "free") as PlanClave };
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
  const data = {
    plan,
    estado,
    proveedor: opts.proveedor ?? "manual",
    monto: opts.monto ?? 0,
    periodo_desde: desde,
    periodo_hasta: hasta,
    notas: opts.notas ?? null,
  };

  await prisma.$transaction([
    prisma.suscripciones.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...data },
      update: data,
    }),
    prisma.tenants.update({ where: { id: tenantId }, data: { features } }),
  ]);

  return getSuscripcion(tenantId);
}
