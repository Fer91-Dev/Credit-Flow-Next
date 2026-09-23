import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getCobranzaConfig, getConfiguracion } from "@/lib/config";
import { creditosConAcuerdoVigente, cubiertoPorAcuerdo } from "@/lib/acuerdos";
import { ESTADOS_VIVOS, decidirAgenda, cuentaComoContacto, type GestionParaAgenda } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/alerta — el aviso del menú lateral.
 *
 * QUÉ CUENTA, Y POR QUÉ. Fernando (19/09/2026): «Cobranzas y Recupero es una sección para
 * trabajar el contacto con el cliente; la alerta sirve para organizar el trabajo del operador,
 * para saber que ya se apagó porque los contactó. Y contactarlo una vez no la apaga para
 * siempre: tiene que volver a saltar cada vez que vence una cuota nueva.»
 *
 * Así que el número rojo es **el trabajo pendiente de hoy** —exactamente la cola de la
 * pestaña Hoy, calculada con la MISMA función (`decidirAgenda`)— y no cuántos deben. La
 * deuda no desaparece por llamar a nadie: eso se ve en los KPI de la sección y en el Home.
 * El ámbar avisa de las cuotas que vencen en los próximos días, que es trabajo que todavía
 * no empezó.
 *
 * Es una consulta liviana a propósito (cuenta, no arma la cola con importes): la pide cada
 * sesión abierta cada cinco minutos.
 */
const HORIZONTE_DIAS = 7;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const hoy = hoyComercial();
  const hoyMs = hoy.getTime();
  const DIA = 86_400_000;
  const finHoy = hoyMs + DIA - 1;
  const limite = new Date(hoyMs + HORIZONTE_DIAS * DIA);

  const [{ dias_sin_gestion, acuerdos, fallecidos }, config] = await Promise.all([
    getCobranzaConfig(tenantId),
    getConfiguracion(tenantId),
  ]);

  const base = {
    ...withTenant(tenantId),
    ...scopeCreditosVendedor({ role, vendedorId }),
    estado: { in: [...ESTADOS_VIVOS] },
  };
  // Los mismos excluidos que la cola: quien pidió no ser contactado nunca entra; el fallecido,
  // según la política de la financiera.
  const contactables = {
    ...base,
    cliente: { no_contactar: false, ...(fallecidos.saca_de_agenda ? { estado: { not: "fallecido" } } : {}) },
  };

  /**
   * 🔴 EL QUE CUMPLE UN ACUERDO TAMBIÉN TIENE UN VENCIMIENTO POR DELANTE.
   *
   * `proximo_pago` le quedó apuntando a la cuota más vieja del plan original —una fecha ya
   * pasada—, así que el conteo de "por vencer" nunca lo alcanzaba y la pestaña Vencimientos
   * decía 1 cuando eran 2. Su vencimiento real es el de la cuota PACTADA, y es la misma
   * cuenta que hace la pestaña con `proximoVencimiento()`.
   *
   * Se cuentan solo los que NO entran ya en el conteo normal (su `proximo_pago` es pasado),
   * para no sumarlos dos veces.
   */
  const porVencerDeAcuerdo = prisma.acuerdo_cuota.findMany({
    where: {
      ...withTenant(tenantId),
      vencimiento: { gte: hoy, lte: limite },
      estado: { not: "pagada" },
      acuerdo: { estado: "vigente", credito: { ...base, proximo_pago: { lt: hoy } } },
    },
    select: { acuerdo: { select: { credito_id: true } } },
  });

  const [enMora, por_vencer_plan, vencidas, cuotasPorVencerAcuerdo] = await Promise.all([
    prisma.creditos.findMany({
      where: { ...contactables, proximo_pago: { lt: hoy } },
      select: {
        id: true, proximo_pago: true, cronograma: true,
        cuotas: { where: { fecha_vencimiento: { lt: hoy } }, select: { fecha_vencimiento: true, capital: true, pagado_capital: true } },
      },
    }),
    prisma.creditos.count({ where: { ...base, proximo_pago: { gte: hoy, lte: limite } } }),
    prisma.creditos.count({ where: { ...base, proximo_pago: { lt: hoy } } }),
    porVencerDeAcuerdo,
  ]);

  /* Un crédito cuenta UNA vez aunque tenga varias cuotas pactadas en el rango: lo que se
     cuenta son destinatarios de un aviso, no cuotas. */
  const por_vencer = por_vencer_plan + new Set(cuotasPorVencerAcuerdo.map((q) => q.acuerdo.credito_id)).size;

  if (enMora.length === 0) {
    return successResponse({ pendientes: 0, vencidas, por_vencer, horizonte_dias: HORIZONTE_DIAS, dias_sin_gestion });
  }

  const ids = enMora.map((c) => c.id);
  const [acuerdosVigentes, cuotasAcuerdo, rotos, acciones] = await Promise.all([
    creditosConAcuerdoVigente(tenantId),
    prisma.acuerdo_cuota.findMany({
      where: { ...withTenant(tenantId), acuerdo: { estado: "vigente", credito_id: { in: ids } }, vencimiento: { lt: hoy }, estado: { not: "pagada" } },
      select: { numero: true, vencimiento: true, acuerdo: { select: { credito_id: true } } },
      orderBy: { vencimiento: "asc" },
    }),
    prisma.acuerdos_pago.findMany({
      where: { ...withTenant(tenantId), estado: "roto", credito_id: { in: ids } },
      select: { credito_id: true, cerrado_at: true, motivo_estado: true },
      orderBy: { cerrado_at: "desc" },
    }),
    prisma.acciones_cobranza.findMany({
      where: { ...withTenant(tenantId), credito_id: { in: ids } },
      select: { credito_id: true, created_at: true, proximo_contacto: true, promesa_estado: true, promesa_fecha: true, automatico: true, nota: true },
      orderBy: { created_at: "desc" },
    }),
  ]);

  const acuerdoVencidoDe = new Map<string, { numero: number; vencimiento: Date }>();
  for (const q of cuotasAcuerdo) if (!acuerdoVencidoDe.has(q.acuerdo.credito_id)) acuerdoVencidoDe.set(q.acuerdo.credito_id, { numero: q.numero, vencimiento: q.vencimiento });
  const rotoDe = new Map<string, { cerrado_at: Date; motivo: string | null }>();
  for (const r of rotos) if (r.cerrado_at && !rotoDe.has(r.credito_id)) rotoDe.set(r.credito_id, { cerrado_at: r.cerrado_at, motivo: r.motivo_estado });
  const porCredito = new Map<string, GestionParaAgenda[]>();
  for (const a of acciones) {
    const arr = porCredito.get(a.credito_id) ?? [];
    arr.push({ created_at: a.created_at, proximo_contacto: a.proximo_contacto, promesa_estado: a.promesa_estado, promesa_fecha: a.promesa_fecha, cuentaComoContacto: cuentaComoContacto(a) });
    porCredito.set(a.credito_id, arr);
  }
  const conAcuerdo = acuerdos.saca_de_agenda ? acuerdosVigentes : new Map<string, Date>();

  let pendientes = 0;
  for (const c of enMora) {
    const acuerdoVencido = acuerdoVencidoDe.get(c.id) ?? null;
    if (!acuerdoVencido && cubiertoPorAcuerdo(conAcuerdo, c.id, c.proximo_pago)) continue;
    const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
    const vencidasImpagas = c.cuotas.filter((q) => q.pagado_capital < q.capital && q.fecha_vencimiento.getTime() + gracia * DIA < hoyMs);
    const ultimoVencimiento = vencidasImpagas.length > 0
      ? new Date(Math.max(...vencidasImpagas.map((q) => q.fecha_vencimiento.getTime() + gracia * DIA)))
      : null;
    const v = decidirAgenda(
      {
        acuerdoVencido,
        acuerdoRoto: acuerdosVigentes.has(c.id) ? null : rotoDe.get(c.id) ?? null,
        ultimoVencimiento,
        cuotasVencidas: vencidasImpagas.length,
        gestiones: porCredito.get(c.id) ?? [],
      },
      { hoy, finHoy, diasSinGestion: dias_sin_gestion },
    );
    if (v) pendientes++;
  }

  return successResponse({ pendientes, vencidas, por_vencer, horizonte_dias: HORIZONTE_DIAS, dias_sin_gestion });
});
