import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { esTenantPlataforma } from "@/lib/saas-owner";
import { resumirVendedor, normalizarComisionConfig } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/equipo — vista UNIFICADA del equipo de la financiera.
 *
 * Junta las dos caras de una misma persona, que hasta ahora se veían en pantallas
 * separadas y confundían:
 *   · **cuenta de acceso** (`profiles`): puede entrar, con qué rol, activa o no.
 *   · **legajo comercial** (`vendedores`): a quién se le atribuyen créditos, comisión,
 *     meta y caja propia.
 *
 * NO cambia el modelo: son las mismas dos tablas, leídas juntas. Un legajo NO se puede
 * fusionar con una cuenta porque lo referencian 5 tablas (creditos, movimientos_caja,
 * metas_vendedor, campanas_cobranza, profiles): si se borra el acceso de alguien, su
 * historia contable tiene que seguir en pie.
 *
 * Devuelve una fila por PERSONA, con los tres casos posibles:
 *   · cuenta + legajo  → el caso normal de un vendedor
 *   · cuenta sin legajo → un admin que no vende (ej. el dueño de la financiera)
 *   · legajo sin cuenta → agentes viejos, previos a exigir cuenta en el alta
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const [profiles, vendedores, creditos] = await Promise.all([
    prisma.profiles.findMany({
      // `es_owner: false` — el dueño del SaaS vive en el tenant de plataforma y no
      // pertenece a la financiera; el filtro por tenant ya lo aísla, esto es defensa
      // en profundidad (mismo criterio que GET /api/usuarios).
      where: { ...withTenant(tenantId), es_owner: false },
      select: {
        id: true, email: true, username: true, full_name: true, nombre: true, apellido: true,
        role: true, activo: true, vendedor_id: true, created_at: true,
      },
      orderBy: { created_at: "asc" },
    }),
    prisma.vendedores.findMany({
      where: withTenant(tenantId),
      orderBy: { created_at: "asc" },
    }),
    // Para el resumen de ventas de cada legajo. Se excluyen anulados y refinanciaciones
    // con el MISMO criterio que la ficha del agente, para que los números coincidan.
    prisma.creditos.findMany({
      where: { ...withTenant(tenantId), estado: { not: "anulado" }, es_refinanciacion: false },
      select: { vendedor_id: true, monto_original: true, tipo_credito: true },
    }),
  ]);

  if (esTenantPlataforma(tenantId)) return successResponse([]);

  const creditosPorVendedor = new Map<string, { monto_original: number; tipo_credito: string }[]>();
  for (const c of creditos) {
    if (!c.vendedor_id) continue;
    const arr = creditosPorVendedor.get(c.vendedor_id) ?? [];
    arr.push({ monto_original: c.monto_original, tipo_credito: c.tipo_credito });
    creditosPorVendedor.set(c.vendedor_id, arr);
  }

  const perfilPorVendedor = new Map(
    profiles.filter((p) => p.vendedor_id).map((p) => [p.vendedor_id as string, p])
  );

  const filas = [];

  // 1) Una fila por legajo (con su cuenta vinculada, si tiene).
  for (const v of vendedores) {
    const p = perfilPorVendedor.get(v.id) ?? null;
    filas.push({
      key: `v:${v.id}`,
      // El nombre a mostrar sale de la CUENTA si existe (es el que la persona edita en
      // Mi perfil); si no, del legajo. Ver nota de duplicación en PENDIENTES.
      nombre: p?.full_name?.trim() || v.nombre,
      email: p?.email ?? v.email,
      username: p?.username ?? null,
      // Acceso
      profile_id: p?.id ?? null,
      role: p?.role ?? null,
      acceso_activo: p?.activo ?? false,
      tiene_cuenta: !!p,
      // Legajo
      vendedor_id: v.id,
      legajo_activo: v.activo,
      zona: v.zona,
      comision_pct: v.comision_pct,
      meta_venta: v.meta_venta,
      limite_aprobacion: v.limite_aprobacion,
      resumen: resumirVendedor(
        creditosPorVendedor.get(v.id) ?? [],
        v.comision_pct,
        v.meta_venta,
        normalizarComisionConfig(v.comision_config, v.comision_pct),
      ),
      created_at: v.created_at,
    });
  }

  // 2) Cuentas sin legajo (admins que no venden). Van al final.
  for (const p of profiles) {
    if (p.vendedor_id) continue;
    filas.push({
      key: `p:${p.id}`,
      nombre: p.full_name?.trim() || p.email || "—",
      email: p.email,
      username: p.username,
      profile_id: p.id,
      role: p.role,
      acceso_activo: p.activo,
      tiene_cuenta: true,
      vendedor_id: null,
      legajo_activo: null,
      zona: null,
      comision_pct: null,
      meta_venta: null,
      limite_aprobacion: null,
      resumen: null,
      created_at: p.created_at,
    });
  }

  return successResponse(filas);
});
