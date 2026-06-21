import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  cuotaMensualFrancesa,
  tasaPeriodicaSegunConvencion,
  interesMora,
  normalizarFrecuencia,
  calculateRecoveryOffer,
  type FrecuenciaDef,
  type ConfiguracionFinanciera,
} from "@/lib/domain";
import { getConfiguracion } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

const CANALES = ["whatsapp", "email", "sms"];
const PROMOS = ["ninguna", "quita_interes"];

type CreditoMora = {
  id: string;
  saldo_pendiente: number;
  dias_mora: number;
  estado: string;
  monto_original: number;
  plazo_meses: number;
  tasa: number;
  frecuencia: string;
  frecuencia_def: unknown;
  cronograma: unknown;
};

/** Interés de mora de un crédito, con el mismo criterio que GET /api/creditos. */
function interesMoraDe(c: CreditoMora, config: ConfiguracionFinanciera): number {
  if (
    !config.moraActiva ||
    c.dias_mora <= 0 ||
    c.estado !== "activo" ||
    c.monto_original <= 0 ||
    c.plazo_meses < 1
  ) {
    return 0;
  }
  const frec = normalizarFrecuencia(c.frecuencia);
  const catFrec = c.frecuencia_def ? [c.frecuencia_def as FrecuenciaDef] : config.simulador.frecuencias;
  const tasaPeriodica = tasaPeriodicaSegunConvencion(c.tasa, config.convencionTasa, frec, catFrec);
  const cuota = cuotaMensualFrancesa(c.monto_original, tasaPeriodica, c.plazo_meses);
  const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
  return interesMora(cuota, c.dias_mora, { tasaDiaria: config.tasaMoraDiaria, diasGracia: gracia });
}

/** Métricas agregadas de una campaña a partir de sus objetivos. */
function metricasDe(objetivos: { promesa_generada: boolean; monto_recuperado: number }[]) {
  return {
    alcance: objetivos.length,
    promesas: objetivos.filter((o) => o.promesa_generada).length,
    recuperado: objetivos.reduce((s, o) => s + o.monto_recuperado, 0),
  };
}

/**
 * GET /api/cobranza/campanas
 * Lista de campañas del tenant con métricas agregadas (alcance/promesas/recuperado).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Campañas de cobranza: admin y cobrador.
  const { tenantId } = await requireRole(["admin", "cobrador"], req);

  const campanas = await prisma.campanas_cobranza.findMany({
    where: { ...withTenant(tenantId) },
    include: { objetivos: { select: { promesa_generada: true, monto_recuperado: true } } },
    orderBy: { created_at: "desc" },
  });

  const data = campanas.map((c) => {
    const { objetivos, ...rest } = c;
    return { ...rest, metricas: metricasDe(objetivos) };
  });

  return successResponse({ campanas: data, total: data.length });
});

/**
 * POST /api/cobranza/campanas
 * Crea una campaña de recuperación y vincula créditos en mora del tenant.
 * Body: {
 *   nombre, descripcion?, canal, promo_tipo, promo_valor?, promo_vence?,
 *   mensaje_template?, credito_ids: string[]
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  // Crear campaña de cobranza: admin y cobrador.
  const { tenantId } = await requireRole(["admin", "cobrador"], req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.nombre || typeof body.nombre !== "string" || !body.nombre.trim()) {
    return errorResponse("Campo requerido: nombre", "INVALID_INPUT", 400);
  }
  const canal = body.canal || "whatsapp";
  if (!CANALES.includes(canal)) {
    return errorResponse(`canal debe ser uno de: ${CANALES.join(", ")}`, "INVALID_INPUT", 400);
  }
  const promoTipo = body.promo_tipo || "ninguna";
  if (!PROMOS.includes(promoTipo)) {
    return errorResponse(`promo_tipo debe ser uno de: ${PROMOS.join(", ")}`, "INVALID_INPUT", 400);
  }
  if (!Array.isArray(body.credito_ids) || body.credito_ids.length === 0) {
    return errorResponse("Campo requerido: credito_ids (no vacío)", "INVALID_INPUT", 400);
  }

  const promoValor = promoTipo === "quita_interes"
    ? Math.min(100, Math.max(0, Number(body.promo_valor) || 0))
    : 0;

  // Créditos del tenant entre los solicitados (multi-tenant: nunca por id suelto).
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), id: { in: body.credito_ids } },
    select: {
      id: true, saldo_pendiente: true, dias_mora: true, estado: true,
      monto_original: true, plazo_meses: true, tasa: true,
      frecuencia: true, frecuencia_def: true, cronograma: true,
    },
  });
  if (creditos.length === 0) {
    return errorResponse("Ningún crédito válido del tenant en credito_ids", "INVALID_REFERENCE", 400);
  }

  const config = await getConfiguracion(tenantId);

  // Snapshot de mora + oferta de recuperación por crédito.
  const objetivosData = creditos.map((c) => {
    const interes = interesMoraDe(c, config);
    const oferta = calculateRecoveryOffer({
      saldo: c.saldo_pendiente,
      interesMora: interes,
      diasMora: c.dias_mora,
      descuentoPct: promoValor,
    });
    return {
      credito_id: c.id,
      saldo: c.saldo_pendiente,
      dias_mora: c.dias_mora,
      interes_mora: interes,
      oferta_monto: oferta.montoConDescuento,
      oferta_descuento: oferta.descuento,
    };
  });

  const campana = await prisma.$transaction(async (tx) => {
    const camp = await tx.campanas_cobranza.create({
      data: {
        ...withTenant(tenantId),
        nombre: body.nombre.trim(),
        descripcion: body.descripcion?.trim() || null,
        canal,
        estado: "borrador",
        promo_tipo: promoTipo,
        promo_valor: promoValor,
        promo_vence: body.promo_vence ? new Date(body.promo_vence) : null,
        mensaje_template: body.mensaje_template?.trim() || null,
      },
    });

    await tx.campana_objetivo.createMany({
      data: objetivosData.map((o) => ({ ...withTenant(tenantId), campana_id: camp.id, ...o })),
    });

    return camp;
  });

  await registrarAuditoria({
    tenantId,
    entidad: "campana",
    entidadId: campana.id,
    accion: "crear",
    descripcion: `Campaña de cobranza "${campana.nombre}" (${canal}) con ${objetivosData.length} crédito(s)`,
    meta: { canal, promo_tipo: promoTipo, promo_valor: promoValor, objetivos: objetivosData.length },
  });

  return successResponse({ ...campana, metricas: metricasDe([]) }, 201);
});
