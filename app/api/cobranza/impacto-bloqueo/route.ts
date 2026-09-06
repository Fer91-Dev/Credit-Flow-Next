import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { diasMoraActual, round2, ESTADOS_VIVOS } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";
import { getCobranzaConfig } from "@/lib/config";
import { cobroBloqueadoPorCredito } from "@/lib/recupero-server";
import { creditosConAcuerdoVigente } from "@/lib/acuerdos";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/impacto-bloqueo?dias=60
 *
 * CUÁNTOS CRÉDITOS DEJARÍAN DE COBRARSE si se prendiera —o si ya está prendida, si se moviera
 * a `dias`— la regla "pasado ese atraso hay que refinanciar".
 *
 * 🔴 POR QUÉ EXISTE. Es la decisión más fuerte del pipeline: un interruptor que corta la
 * cobranza de una parte de la cartera. Sin este número se prende a ciegas y el efecto se
 * descubre cuando un vendedor choca con la pantalla, con el cliente enfrente. Que la
 * financiera pueda ver el alcance ANTES es la diferencia entre una decisión y una sorpresa.
 *
 * Simula: fuerza la regla en `true` y usa los días que llegan por query, así el operador ve el
 * impacto del valor que está escribiendo y no del que quedó guardado. NO escribe nada.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Solo admin: es la cartera entera de la financiera, no un recorte del vendedor.
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const pedido = Number(url.searchParams.get("dias"));
  const { recupero } = await getCobranzaConfig(tenantId);
  // Sin parámetro válido, el que ya tiene configurado.
  const dias = Number.isFinite(pedido) && pedido > 0
    ? Math.min(365, Math.round(pedido))
    : recupero.dias_min_mora_refinanciar;

  if (dias <= 0) {
    return successResponse({ dias: 0, creditos: 0, clientes: 0, capital_pendiente: 0 });
  }

  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), estado: { in: [...ESTADOS_VIVOS] }, proximo_pago: { not: null } },
    select: { id: true, cliente_id: true, proximo_pago: true, dias_mora: true, saldo_pendiente: true },
  });

  const hoy = hoyComercial();
  const acuerdosVigentes = await creditosConAcuerdoVigente(tenantId);

  const bloqueados = await cobroBloqueadoPorCredito(
    tenantId,
    creditos.map((c) => ({
      id: c.id,
      diasMora: c.proximo_pago ? diasMoraActual(c.proximo_pago, hoy) : c.dias_mora,
      acuerdoVigente: acuerdosVigentes.has(c.id),
    })),
    // La simulación: la regla prendida y con los días que se están evaluando. El resto de la
    // escalera queda como está — el tope de acuerdos y "exigir un acuerdo roto" siguen pesando,
    // y son parte de por qué un crédito entra o no en la cuenta.
    { ...recupero, bloquear_cobro_sin_refinanciar: true, dias_min_mora_refinanciar: dias },
  );

  const afectados = creditos.filter((c) => bloqueados.get(c.id));

  return successResponse({
    dias,
    creditos: afectados.length,
    clientes: new Set(afectados.map((c) => c.cliente_id)).size,
    /** Capital pendiente de esos créditos: da la magnitud sin tener que traer todas las cuotas. */
    capital_pendiente: round2(afectados.reduce((s, c) => s + c.saldo_pendiente, 0)),
  });
});
