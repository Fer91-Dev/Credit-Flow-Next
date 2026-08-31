import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { deudaVencidaDeCredito, resolverTasaAcuerdo } from "@/lib/acuerdos";
import { getCobranzaConfig } from "@/lib/config";
import { quitaMaxima, diasMoraActual } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";
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

  /**
   * 🔴 LOS OTROS CRÉDITOS EN MORA DEL MISMO CLIENTE.
   *
   * Un acuerdo se arma sobre UN crédito. Si la persona tiene otro vencido, nadie se lo decía:
   * se cerraba el arreglo por uno, el otro seguía corriendo, y el cliente se iba creyendo que
   * quedaba al día. Fernando lo probó con Estela Moreno — dos créditos, dos deudas, y la
   * pantalla mostrando una sola.
   *
   * No se arma nada automáticamente: se INFORMA, con el número, y el operador decide.
   */
  const otros = credito.cliente
    ? await prisma.creditos.findMany({
        where: {
          ...withTenant(tenantId),
          cliente_id: credito.cliente.id,
          id: { not: id },
          estado: { in: ["activo", "vencido"] },
        },
        select: {
          id: true, numero: true, estado: true, saldo_pendiente: true, proximo_pago: true,
          acuerdos: { where: { estado: "vigente" }, select: { id: true, cuotas: { orderBy: { numero: "asc" }, select: { numero: true, vencimiento: true, monto: true, pagado: true, estado: true } } } },
        },
      })
    : [];
  const hoyCom = hoyComercial();
  const otrosEnMora = otros
    .map((c) => ({
      id: c.id,
      numero: c.numero,
      saldo_pendiente: c.saldo_pendiente,
      dias_mora: c.proximo_pago ? diasMoraActual(c.proximo_pago, hoyCom) : 0,
      tiene_acuerdo: c.acuerdos.length > 0,
    }))
    // La consulta ya trajo solo créditos vivos; acá se filtra por mora real (en vivo).
    .filter((c) => c.dias_mora > 0);

  /**
   * Si el cliente YA tiene un acuerdo vigente en otro crédito, la primera cuota de este se
   * propone en LA MISMA FECHA. Sin esto quedaban dos calendarios: el acuerdo pone el primer
   * vencimiento a `dias_entre_cuotas` de HOY, así que dos arreglos armados en días distintos
   * le dan al cliente dos fechas de pago para la misma plata.
   */
  const conAcuerdo = otros.find((c) => c.acuerdos.length > 0);
  const proximaDelOtro = conAcuerdo?.acuerdos[0]?.cuotas.find((q) => q.estado !== "pagada") ?? null;

  return successResponse({
    /**
     * Otros créditos del mismo cliente que también están vencidos, y la fecha con la que
     * sincronizar si ya tiene un acuerdo andando. Los dos son AVISOS: no cambian nada solos.
     */
    otros_creditos_en_mora: otrosEnMora,
    sincronizar_con: proximaDelOtro
      ? { credito_numero: conAcuerdo!.numero, vencimiento: proximaDelOtro.vencimiento, monto: proximaDelOtro.monto }
      : null,
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
       * El % del tope, para poder DECIRLO. "Hasta $147.000" no explica de dónde sale ese
       * número; "hasta el 75% de los punitorios y el interés" sí, y es lo que el vendedor le
       * repite al cliente cuando negocia. El admin no tiene tope (llega al 100%).
       */
      quita_max_pct: role === "admin" ? 100 : cfg.quita_max_vendedor_pct,
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
