import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { deudaVencidaDeCredito, resolverTasaAcuerdo } from "@/lib/acuerdos";
import { getCobranzaConfig } from "@/lib/config";
import { quitaMaxima } from "@/lib/domain";
import { puedeAcordar } from "@/lib/domain/recupero";
import { senalesRecupero } from "@/lib/recupero-server";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/acuerdo
 * Previsualización para armar un acuerdo: cuánto debe VENCIDO hoy (desglosado), cuánto
 * puede condonar quien está mirando, y los límites de la financiera.
 *
 * Es solo lectura: no crea nada. El alta va por `POST /api/cobranza/acuerdos`.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  // Anti-IDOR antes de calcular nada.
  const scope = scopeCreditosVendedor({ role, vendedorId });
  const existe = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id, ...scope },
    select: { id: true },
  });
  if (!existe) return errorResponse("El crédito no existe", "NOT_FOUND", 404);

  const { credito, deuda } = await deudaVencidaDeCredito(tenantId, id);
  const cobranza = await getCobranzaConfig(tenantId);
  const cfg = cobranza.acuerdos;

  const tasaAcuerdo = await resolverTasaAcuerdo(tenantId, credito.tasa, cfg);

  /**
   * 🔴 ¿SE PUEDE ARMAR? SE PREGUNTA ACÁ, NO AL GUARDAR.
   *
   * La escalera de recupero puede bloquear el acuerdo (mora mínima, gestión previa). Eso se
   * validaba solo en el POST — y desde que el acuerdo cobra una ENTREGA, llegar hasta ahí
   * significa que la plata YA entró: el cliente pagó y el acuerdo no se armó. Pasó de verdad,
   * con $32.000 de Estela Moreno.
   *
   * Contestándolo en el preview, la pantalla lo muestra antes de que haya un peso de por
   * medio, y el admin puede autorizar la excepción ANTES de cobrar en vez de descubrirla
   * después. El POST sigue validando igual: esto informa, no reemplaza la barrera.
   */
  const veredicto = puedeAcordar(await senalesRecupero(tenantId, id), cobranza.recupero);

  const acuerdoVigente = await prisma.acuerdos_pago.findFirst({
    where: { ...withTenant(tenantId), credito_id: id, estado: "vigente" },
    select: { id: true, monto_acordado: true, fecha: true },
  });

  return successResponse({
    /**
     * Si NO se puede, por qué y qué hacer. `puede_autorizar` es true solo para el admin: es
     * quien puede seguir igual asumiendo la decisión, y queda auditado.
     */
    escalera: {
      permitido: veredicto.permitido,
      motivo: veredicto.permitido ? null : veredicto.motivo ?? null,
      sugerencia: veredicto.permitido ? null : veredicto.sugerencia ?? null,
      puede_autorizar: role === "admin",
    },
    credito: {
      id: credito.id,
      numero: credito.numero,
      estado: credito.estado,
      cliente: credito.cliente ? `${credito.cliente.nombre} ${credito.cliente.apellido ?? ""}`.trim() : null,
    },
    deuda,
    limites: {
      max_cuotas: cfg.max_cuotas,
      dias_entre_cuotas: cfg.dias_entre_cuotas,
      cuotas_para_romper: cfg.cuotas_para_romper,
      congela_punitorios: cfg.congela_punitorios,
      /** Tope de condonación para QUIEN ESTÁ MIRANDO (según su rol). */
      quita_maxima: quitaMaxima(deuda, role === "admin", cfg),
      /**
       * La tasa con la que se va a armar el plan, ya resuelta, para que la pantalla calcule
       * EL MISMO plan que va a crear el alta. Sin esto el diálogo repartía la deuda en partes
       * iguales y prometía un total que no era el que se creaba.
       */
      tasa_mensual: tasaAcuerdo.tasa,
      /** "config" = la fijó la financiera · "credito" = se heredó la del crédito. */
      tasa_origen: tasaAcuerdo.origen,
    },
    acuerdo_vigente: acuerdoVigente,
  });
});
