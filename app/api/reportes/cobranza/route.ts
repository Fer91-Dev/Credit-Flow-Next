import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  resumenEmbudoCobranza,
  recuperoCobranza,
  type GestionCobranza,
  type PagoRecupero,
} from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/reportes/cobranza?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Efectividad de la gestión de cobranza del período (Fase 2 "Reforzar Cobranzas"). Solo admin.
 * Mide sobre las gestiones HUMANAS (automatico = false; excluye envíos de campaña y alertas del cron):
 *  - Embudo: gestión → contacto → promesa → promesa cumplida, con sus tasas.
 *  - Recupero: mora e importe cobrados en el período.
 *  - Desglose por canal (tipo de gestión) y por vendedor (dueño del crédito gestionado).
 *
 * Alcance: admin ve TODO el tenant; el vendedor ve SOLO la efectividad sobre sus propios
 * créditos (scoping anti-IDOR) — para que cada uno mida su gestión y el admin al equipo.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
  // Scoping: el vendedor solo mide gestiones/cobros de créditos que él gestiona.
  const scope = scopeCreditosVendedor({ role, vendedorId });
  const creditoFilter = scope.vendedor_id ? { credito: { vendedor_id: scope.vendedor_id } } : {};

  const url = new URL(req.url);
  const hoy = new Date();
  const desdeStr = url.searchParams.get("desde")
    || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hastaStr = url.searchParams.get("hasta") || hoy.toISOString().slice(0, 10);

  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T23:59:59.999Z`);

  const [acciones, pagos, vendedores] = await Promise.all([
    prisma.acciones_cobranza.findMany({
      where: { ...withTenant(tenantId), automatico: false, created_at: { gte: desde, lte: hasta }, ...creditoFilter },
      select: {
        tipo: true, resultado: true, promesa_estado: true, promesa_monto: true,
        credito: { select: { vendedor_id: true } },
      },
    }),
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), fecha: { gte: desde, lte: hasta }, ...creditoFilter },
      select: { monto: true, aplicado_mora: true, credito: { select: { vendedor_id: true } } },
    }),
    prisma.vendedores.findMany({ where: { ...withTenant(tenantId) }, select: { id: true, nombre: true } }),
  ]);

  // Normalización a los tipos del dominio + retención de la clave de agrupación.
  type AccionRow = { tipo: string; vendedorId: string | null; gestion: GestionCobranza };
  const filas: AccionRow[] = acciones.map((a) => ({
    tipo: a.tipo,
    vendedorId: a.credito?.vendedor_id ?? null,
    gestion: { resultado: a.resultado, promesa_estado: a.promesa_estado, promesa_monto: a.promesa_monto },
  }));
  type PagoRow = PagoRecupero & { vendedorId: string | null };
  const pagosRows: PagoRow[] = pagos.map((p) => ({
    monto: p.monto,
    aplicado_mora: p.aplicado_mora,
    vendedorId: p.credito?.vendedor_id ?? null,
  }));

  // ── Global ──
  const embudo = resumenEmbudoCobranza(filas.map((f) => f.gestion));
  const recupero = recuperoCobranza(pagosRows);

  // ── Por canal (tipo de gestión) ──
  const CANALES = ["llamada", "whatsapp", "email", "visita", "otro"] as const;
  const por_canal = CANALES.map((canal) => {
    const e = resumenEmbudoCobranza(filas.filter((f) => f.tipo === canal).map((f) => f.gestion));
    return { canal, gestiones: e.gestiones, contactos: e.contactos, promesas: e.promesas, tasa_contacto: e.tasa_contacto };
  }).filter((c) => c.gestiones > 0);

  // ── Por vendedor (dueño del crédito gestionado; null = sin asignar) ──
  const nombreDe = new Map(vendedores.map((v) => [v.id, v.nombre]));
  const ids = new Set<string | null>();
  filas.forEach((f) => ids.add(f.vendedorId));
  pagosRows.forEach((p) => ids.add(p.vendedorId));

  const por_vendedor = [...ids].map((id) => {
    const e = resumenEmbudoCobranza(filas.filter((f) => f.vendedorId === id).map((f) => f.gestion));
    const r = recuperoCobranza(pagosRows.filter((p) => p.vendedorId === id));
    return {
      vendedor_id: id,
      nombre: id ? (nombreDe.get(id) ?? "—") : "Sin asignar",
      gestiones: e.gestiones,
      contactos: e.contactos,
      promesas: e.promesas,
      promesas_cumplidas: e.promesas_cumplidas,
      tasa_contacto: e.tasa_contacto,
      tasa_cumplimiento: e.tasa_cumplimiento,
      mora_cobrada: r.mora_cobrada,
    };
  })
    .filter((v) => v.gestiones > 0 || v.mora_cobrada > 0)
    .sort((a, b) => b.gestiones - a.gestiones || b.mora_cobrada - a.mora_cobrada);

  return successResponse({
    periodo: { desde: desdeStr, hasta: hastaStr },
    embudo,
    recupero,
    por_canal,
    por_vendedor,
  });
});
