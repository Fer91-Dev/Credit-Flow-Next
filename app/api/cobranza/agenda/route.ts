import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getCobranzaConfig } from "@/lib/config";
import { diasMoraActual } from "@/lib/domain";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/agenda
 * "Agenda del día" de cobranza: cola priorizada de a quién contactar hoy, SCOPEADA al vendedor
 * (admin ve todo). Junta 3 fuentes de la cartera en mora y las clasifica en buckets:
 *  - promesa:  promesa de pago pendiente vencida (o de hoy) sin cumplir.
 *  - agendado: gestión con "próximo contacto" para hoy o vencido.
 *  - enfriado: moroso sin gestión humana en `dias_sin_gestion` días (parametrizable en Config).
 * Prioridad: promesa → agendado → enfriado; dentro de cada uno, mayor mora primero.
 */
type Bucket = "promesa" | "agendado" | "enfriado";
const PRIORIDAD: Record<Bucket, number> = { promesa: 0, agendado: 1, enfriado: 2 };

interface AgendaItem {
  credito_id: string;
  credito_numero: number | null;
  cliente: string;
  telefono: string | null;
  saldo_pendiente: number;
  dias_mora: number;
  promesa_monto: number | null;
  bucket: Bucket;
  motivo: string;
  fecha: Date | null;
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { dias_sin_gestion } = await getCobranzaConfig(tenantId);

  const hoy = hoyComercial();
  const hoyMs = hoy.getTime();
  const finHoy = hoyMs + 86_400_000 - 1; // fin del día de hoy (AR)
  const DIA = 86_400_000;

  // Créditos activos en mora, scopeados (vendedor solo los suyos; admin todo). En mora = con
  // `proximo_pago` vencido (filtro EN VIVO, independiente del cache `dias_mora` que no se avanza
  // día a día); así un moroso nunca cobrado aparece igual en la agenda.
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), estado: "activo", proximo_pago: { lt: hoy } },
    select: {
      id: true, numero: true, saldo_pendiente: true, proximo_pago: true,
      cliente: { select: { nombre: true, apellido: true, telefono: true } },
    },
  });

  if (creditos.length === 0) {
    return successResponse({ items: [], totales: { promesa: 0, agendado: 0, enfriado: 0, total: 0 }, dias_sin_gestion });
  }

  const ids = creditos.map((c) => c.id);
  const acciones = await prisma.acciones_cobranza.findMany({
    where: { ...withTenant(tenantId), credito_id: { in: ids } },
    select: { credito_id: true, created_at: true, proximo_contacto: true, promesa_estado: true, promesa_fecha: true, promesa_monto: true, automatico: true },
    orderBy: { created_at: "desc" },
  });

  // Acciones por crédito (ya vienen desc por created_at → find() devuelve la más reciente).
  const porCredito = new Map<string, typeof acciones>();
  for (const a of acciones) {
    const arr = porCredito.get(a.credito_id) ?? [];
    arr.push(a);
    porCredito.set(a.credito_id, arr);
  }

  const items: AgendaItem[] = [];
  for (const c of creditos) {
    const accs = porCredito.get(c.id) ?? [];
    const promesaPend = accs.find((a) => a.promesa_estado === "pendiente" && a.promesa_fecha);
    const conProx = accs.find((a) => a.proximo_contacto);
    const ultimaHumana = accs.find((a) => !a.automatico);

    let bucket: Bucket | null = null;
    let fecha: Date | null = null;
    let motivo = "";

    if (promesaPend?.promesa_fecha && promesaPend.promesa_fecha.getTime() <= finHoy) {
      bucket = "promesa"; fecha = promesaPend.promesa_fecha; motivo = "Promesa de pago vencida";
    } else if (conProx?.proximo_contacto && conProx.proximo_contacto.getTime() <= finHoy) {
      bucket = "agendado"; fecha = conProx.proximo_contacto; motivo = "Contacto agendado";
    } else {
      const dias = ultimaHumana ? Math.floor((hoyMs - ultimaHumana.created_at.getTime()) / DIA) : Infinity;
      if (dias >= dias_sin_gestion) {
        bucket = "enfriado";
        fecha = ultimaHumana?.created_at ?? null;
        motivo = ultimaHumana ? `Sin gestión hace ${dias} días` : "Nunca gestionado";
      }
    }

    if (!bucket) continue;
    items.push({
      credito_id: c.id,
      credito_numero: c.numero,
      cliente: nombreCompleto(c.cliente),
      telefono: c.cliente?.telefono ?? null,
      saldo_pendiente: c.saldo_pendiente,
      dias_mora: diasMoraActual(c.proximo_pago, hoy),
      promesa_monto: bucket === "promesa" ? (promesaPend?.promesa_monto ?? null) : null,
      bucket,
      motivo,
      fecha,
    });
  }

  items.sort((a, b) => PRIORIDAD[a.bucket] - PRIORIDAD[b.bucket] || b.dias_mora - a.dias_mora);

  const totales = {
    promesa: items.filter((i) => i.bucket === "promesa").length,
    agendado: items.filter((i) => i.bucket === "agendado").length,
    enfriado: items.filter((i) => i.bucket === "enfriado").length,
    total: items.length,
  };

  return successResponse({ items, totales, dias_sin_gestion });
});
