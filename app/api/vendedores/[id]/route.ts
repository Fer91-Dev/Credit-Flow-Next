import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { registrarAuditoria } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { esRolValido, resumirVendedor, normalizarComisionPct, normalizarMonto, normalizarComisionConfig } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/vendedores/[id]
 * Ficha del vendedor con su resumen de ventas/comisión y créditos otorgados.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const vendedor = await prisma.vendedores.findFirst({
    where: { ...withTenant(tenantId), id },
    // La cuenta vinculada, para poder mostrar en la ficha el rol REAL (`profiles.role`,
    // lo único que define permisos) en vez del decorativo `vendedores.rol`. Es un array
    // por la back-relation, pero un agente tiene como mucho una cuenta (lo garantizan
    // `POST/PATCH /api/usuarios` con 409).
    include: { profiles: { select: { role: true, activo: true, email: true } } },
  });
  if (!vendedor) {
    return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);
  }
  const { profiles, ...ficha } = vendedor;
  const cuenta = profiles[0] ?? null;

  // Excluye refinanciaciones: no son plata nueva otorgada (no suman a comisión/meta ni
  // al "otorgado" de la ficha). El crédito original ya quedó contado en su momento.
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), vendedor_id: id, estado: { not: "anulado" }, es_refinanciacion: false },
    select: {
      id: true, numero: true, monto_original: true, tipo_credito: true, estado: true, created_at: true,
      cliente: { select: { nombre: true, apellido: true } },
    },
    orderBy: { created_at: "desc" },
  });

  // El avance de meta del encabezado se mide DENTRO del período de la meta vigente.
  // Antes usaba el otorgado histórico: la ficha mostraba 33% arriba y 0% en la
  // pestaña Metas, el mismo dato contradiciéndose en la misma pantalla.
  const metaVigente = await prisma.metas_vendedor.findFirst({
    where: { ...withTenant(tenantId), vendedor_id: id, estado: "vigente" },
    orderBy: { fecha_desde: "desc" },
    select: { periodo: true, fecha_desde: true, fecha_hasta: true },
  });

  const resumen = resumirVendedor(
    creditos.map((c) => ({ monto_original: c.monto_original, tipo_credito: c.tipo_credito, created_at: c.created_at })),
    ficha.comision_pct,
    ficha.meta_venta,
    normalizarComisionConfig(ficha.comision_config, ficha.comision_pct),
    metaVigente ? { desde: metaVigente.fecha_desde, hasta: metaVigente.fecha_hasta } : null,
  );

  return successResponse({
    ...ficha,
    resumen,
    creditos,
    meta_periodo: metaVigente?.periodo ?? null,
    // `cuenta` es null si el agente no tiene login (agentes viejos). La ficha muestra
    // "Sin acceso" en ese caso, que es informacion util, no un rol inventado.
    cuenta: cuenta ? { role: cuenta.role, activo: cuenta.activo, email: cuenta.email } : null,
  });
});

/**
 * PATCH /api/vendedores/[id]
 * Actualiza datos del vendedor (lo LABORAL: comisión, meta, zona, límite, estado).
 * Los datos PERSONALES (nombre, teléfono, dirección) solo se aceptan si el agente no
 * tiene cuenta: con cuenta, la fuente de verdad es `profiles` / Mi perfil.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const existing = await prisma.vendedores.findFirst({
    where: { ...withTenant(tenantId), id },
    include: { profiles: { select: { id: true } } },
  });
  if (!existing) {
    return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const data: Record<string, unknown> = {};
  // El nombre solo se acepta acá si el agente NO tiene cuenta. Con cuenta, la fuente de
  // verdad es `profiles` (decisión 2026-08-01) y esta sería la puerta de atrás por donde
  // los dos nombres volverían a divergir. Los agentes viejos sin cuenta no tienen profile
  // que editar, así que para ellos la ficha sigue siendo el único lugar donde cambiarlo.
  const tieneCuenta = existing.profiles.length > 0;
  if (!tieneCuenta && typeof body.nombre === "string" && body.nombre.trim()) {
    data.nombre = body.nombre.trim();
  }
  if ("email" in body) data.email = (body.email as string)?.trim() || null;
  // `telefono` y `direccion` son datos PERSONALES: desde 2026-07-30 la fuente de verdad es
  // `profiles` y los edita cada uno en Mi perfil. La UI ya no los manda, pero la API los
  // seguía aceptando: una puerta abierta por la que los dos valores volvían a divergir sin
  // que nadie lo notara. Se cierran para quien TIENE cuenta; los agentes sin cuenta no
  // tienen profile que editar, así que para ellos la ficha sigue siendo el único lugar.
  if (!tieneCuenta && "telefono" in body) data.telefono = (body.telefono as string)?.trim() || null;
  if (esRolValido(body.rol)) data.rol = body.rol;
  if ("comision_pct" in body) data.comision_pct = normalizarComisionPct(body.comision_pct);
  if ("meta_venta" in body) data.meta_venta = normalizarMonto(body.meta_venta);
  if (typeof body.activo === "boolean") data.activo = body.activo;
  // Datos laborales (Fase 1)
  if ("documento" in body) data.documento = (body.documento as string)?.trim() || null;
  if ("fecha_ingreso" in body) data.fecha_ingreso = body.fecha_ingreso ? new Date(body.fecha_ingreso as string) : null;
  if (!tieneCuenta && "direccion" in body) data.direccion = (body.direccion as string)?.trim() || null;
  if ("zona" in body) data.zona = (body.zona as string)?.trim() || null;
  if ("notas" in body) data.notas = (body.notas as string)?.trim() || null;
  if ("limite_aprobacion" in body) data.limite_aprobacion = body.limite_aprobacion != null ? normalizarMonto(body.limite_aprobacion) : null;
  // Comisión avanzada (Fase 2): el % base usa el comision_pct entrante o el existente.
  if ("comision_config" in body) {
    const basePct = "comision_pct" in body ? normalizarComisionPct(body.comision_pct) : existing.comision_pct;
    data.comision_config = normalizarComisionConfig(body.comision_config, basePct) ?? Prisma.DbNull;
  }

  if (Object.keys(data).length === 0) {
    return errorResponse("Sin cambios para aplicar", "INVALID_INPUT", 400);
  }

  const vendedor = await prisma.vendedores.update({
    where: { id },
    data,
  });

  await registrarAuditoria({
    tenantId,
    entidad: "vendedores",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Personal actualizado: ${vendedor.nombre}`,
    meta: { campos: Object.keys(data) },
  });

  return successResponse(vendedor);
});

/**
 * DELETE /api/vendedores/[id]
 * Elimina un vendedor. Los créditos vinculados quedan con vendedor_id NULL (onDelete: SetNull).
 * Los profiles (cuentas de login) vinculados se desvinculan explícitamente en la misma
 * transacción: la FK profiles.vendedor_id no tiene SET NULL, así que sin esto quedaría
 * apuntando a un vendedor inexistente (referencia rota, vendedor_nombre null sin explicación).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId, userId } = await requireRole(["admin"], req);
  const { id } = await params;
  // ?eliminar_cuenta=true → además del agente, borra el login (auth.users + profile).
  const eliminarCuenta = new URL(req.url).searchParams.get("eliminar_cuenta") === "true";

  const existing = await prisma.vendedores.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!existing) {
    return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);
  }

  // Guard de tesorería: no eliminar un agente que aún tiene plata en su caja. La FK
  // movimientos_caja→vendedor es SetNull, así que borrarlo MOVERÍA su saldo a la caja
  // principal SIN rendición (movimiento silencioso que rompe la trazabilidad). Primero
  // hay que rendir/transferir ese saldo a la caja principal.
  const saldoAgg = await prisma.movimientos_caja.aggregate({
    where: { ...withTenant(tenantId), vendedor_id: id },
    _sum: { monto: true },
  });
  const saldoCaja = Math.round((saldoAgg._sum.monto ?? 0) * 100) / 100;
  if (Math.abs(saldoCaja) > 0.01) {
    return errorResponse(
      `Este agente tiene un saldo de $${saldoCaja.toLocaleString("es-AR")} en su caja. Antes de eliminarlo, ese saldo debe rendirse a la caja principal (si no, se movería a la principal sin registro).`,
      "CAJA_CON_SALDO",
      409,
    );
  }

  // Cuentas de login vinculadas a este agente.
  const cuentas = await prisma.profiles.findMany({
    where: { ...withTenant(tenantId), vendedor_id: id },
    select: { id: true, email: true, role: true, es_titular: true, es_owner: true },
  });

  if (eliminarCuenta && cuentas.length > 0) {
    // El titular de la financiera (y el dueño del SaaS) no se pueden borrar por esta
    // puerta. `DELETE /api/usuarios/[id]` ya los protege, pero esta ruta también borra
    // profiles: sin el mismo guard, bastaba con eliminar la ficha de agente del dueño
    // marcando "eliminar también la cuenta" para saltear la protección.
    const protegida = cuentas.find((c) => c.es_titular || c.es_owner);
    if (protegida) {
      return errorResponse(
        protegida.es_owner
          ? "Ese agente está vinculado a la cuenta del dueño de la plataforma: no se puede eliminar."
          : "Ese agente está vinculado a la cuenta del titular de la financiera: no se puede eliminar.",
        "TITULAR_PROTEGIDO",
        403,
      );
    }
    // Guardas anti-lockout: no borrar tu propia cuenta ni la del último administrador.
    if (cuentas.some((c) => c.id === userId)) {
      return errorResponse("No podés eliminar tu propia cuenta de acceso desde acá.", "SELF_DELETE", 400);
    }
    const adminsAEliminar = cuentas.filter((c) => c.role === "admin").length;
    if (adminsAEliminar > 0) {
      const totalAdmins = await prisma.profiles.count({ where: { ...withTenant(tenantId), role: "admin", activo: true } });
      if (totalAdmins - adminsAEliminar < 1) {
        return errorResponse("No podés eliminar la cuenta del último administrador.", "LAST_ADMIN", 400);
      }
    }
    // Borrado definitivo de cada cuenta: profile (corta el acceso) + auth.users (libera el email).
    const admin = createAdminClient();
    for (const c of cuentas) {
      await prisma.profiles.delete({ where: { id: c.id } });
      await admin.auth.admin.deleteUser(c.id).catch(() => {});
    }
  } else {
    // Comportamiento por defecto: desvincular el/los profile(s) y conservar el login.
    await prisma.profiles.updateMany({
      where: { ...withTenant(tenantId), vendedor_id: id },
      data: { vendedor_id: null },
    });
  }

  await prisma.vendedores.delete({ where: { id } });

  await registrarAuditoria({
    tenantId,
    entidad: "vendedores",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Personal eliminado: ${existing.nombre}${eliminarCuenta && cuentas.length > 0 ? " (incluida su cuenta de acceso)" : ""}`,
  });

  return successResponse({ id, deleted: true, cuentas_eliminadas: eliminarCuenta ? cuentas.length : 0 });
});
