import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { hoyComercial, inicioDiaAR, finDiaAR } from "@/lib/utils";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/auditoria
 * Traza de eventos del tenant, más recientes primero.
 * Query params:
 * - ?entidad=clientes|creditos|pagos|configuracion|caja|plataforma
 * - ?accion=crear|actualizar|registrar_pago|…
 * - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  (días ARGENTINOS)
 * - ?limit=200 (máx 1000) & ?offset=0
 *
 * 🔴 Los CONTADORES se calculan en la base, no sobre la página que se devuelve.
 *
 * La pantalla los sacaba de `eventos.length`, o sea del recorte que había pedido: con 285
 * eventos en la base y un `limit` de 200, el KPI "Eventos totales" mostraba 200 — un número
 * redondo que parece un total y es el tamaño de la página. Lo mismo "Hoy" y "Últimos 7 días":
 * en cuanto la traza pasa el límite, dejan de contar los eventos más viejos que quedaron
 * afuera. Una auditoría que subcuenta es peor que no tenerla.
 */
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const GET = withErrorHandler(async (req: NextRequest) => {
  // Traza de auditoría: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const entidad = url.searchParams.get("entidad");
  const accion = url.searchParams.get("accion");
  const desdeStr = url.searchParams.get("desde");
  const hastaStr = url.searchParams.get("hasta");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Prisma.auditoriaWhereInput = { ...withTenant(tenantId) };
  if (entidad) where.entidad = entidad;
  if (accion) where.accion = accion;
  // `created_at` es TIMESTAMP: bordes del día ARGENTINO. Con los bordes UTC, todo lo hecho
  // después de las 21:00 se registraría en el día siguiente (ver lib/domain/fechas).
  if (desdeStr || hastaStr) {
    const rango: Prisma.DateTimeFilter = {};
    if (desdeStr) rango.gte = inicioDiaAR(desdeStr);
    if (hastaStr) rango.lte = finDiaAR(hastaStr);
    where.created_at = rango;
  }

  // Ventanas de los KPIs, en días argentinos. "Últimos 7 días" son 7 días de calendario
  // terminando hoy (no una ventana móvil de 168 horas, que en la práctica corta el séptimo
  // día por la mitad y hace que el número cambie según la hora a la que se mire).
  const hoy = hoyComercial();
  const hace6 = new Date(hoy);
  hace6.setUTCDate(hace6.getUTCDate() - 6);

  const [eventos, total, totalTenant, hoyCount, semanaCount, pagosCount] = await Promise.all([
    prisma.auditoria.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditoria.count({ where }),
    prisma.auditoria.count({ where: { ...withTenant(tenantId) } }),
    prisma.auditoria.count({ where: { ...withTenant(tenantId), created_at: { gte: inicioDiaAR(ymd(hoy)), lte: finDiaAR(ymd(hoy)) } } }),
    prisma.auditoria.count({ where: { ...withTenant(tenantId), created_at: { gte: inicioDiaAR(ymd(hace6)), lte: finDiaAR(ymd(hoy)) } } }),
    prisma.auditoria.count({ where: { ...withTenant(tenantId), accion: "registrar_pago" } }),
  ]);

  return successResponse({
    eventos,
    total,
    limit,
    offset,
    // Contadores del TENANT (no del filtro ni de la página): son los KPIs de la pantalla.
    resumen: {
      total: totalTenant,
      hoy: hoyCount,
      semana: semanaCount,
      pagos: pagosCount,
      desde_hoy: ymd(hoy),
      desde_semana: ymd(hace6),
    },
  });
});
