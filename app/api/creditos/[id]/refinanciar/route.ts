import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  calcularDeudaConsolidada,
  aplicarQuita,
  construirPlanAmortizacion,
  planACuotas,
  normalizarFrecuencia,
  resolverFrecuencia,
  round2,
  estadoCoherente,
  type CuotaParaImputar,
  type TipoQuita,
} from "@/lib/domain";
import { getConfiguracion } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Carga el crédito (scopeado anti-IDOR) con sus cuotas y valida que sea refinanciable.
 * Devuelve { error } (Response) o { credito, config, deuda } listo para operar.
 */
async function cargarRefinanciable(req: NextRequest, id: string) {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id },
    include: { cliente: true, cuotas: { orderBy: { nro: "asc" } } },
  });

  if (!credito) {
    return { error: errorResponse("Crédito no encontrado", "NOT_FOUND", 404), tenantId, role, vendedorId } as const;
  }

  // Estado reconciliado: defensa ante datos legacy.
  const estado = estadoCoherente(credito.estado, credito.saldo_pendiente, credito.cuotas);
  if (estado !== "activo") {
    const motivo =
      estado === "pagado" || estado === "cancelado"
        ? "ya está saldado"
        : estado === "anulado"
        ? "está anulado"
        : estado === "refinanciado"
        ? "ya fue refinanciado"
        : `no está activo (${estado})`;
    return { error: errorResponse(`No se puede refinanciar: el crédito ${motivo}.`, "NOT_REFINANCEABLE", 409), tenantId, role, vendedorId } as const;
  }
  if (credito.cuotas.length === 0) {
    return { error: errorResponse("El crédito no tiene cronograma de cuotas.", "INVALID_STATE", 400), tenantId, role, vendedorId } as const;
  }
  // Solo se refinancia deuda MOROSA: un crédito activo y al día no se reestructura.
  if (credito.dias_mora <= 0) {
    return { error: errorResponse("No se puede refinanciar un crédito al día: la refinanciación es para deuda en mora.", "NOT_IN_ARREARS", 409), tenantId, role, vendedorId } as const;
  }

  const config = await getConfiguracion(tenantId);
  const graciaCred = (credito.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;

  const cuotasDom: CuotaParaImputar[] = credito.cuotas.map((c) => ({
    id: c.id,
    nro: c.nro,
    fechaVencimiento: c.fecha_vencimiento,
    capital: c.capital,
    interes: c.interes,
    cargos: round2(c.iva + c.seguro + c.gastos),
    cuotaTotal: c.cuota_total,
    pagadoCapital: c.pagado_capital,
    pagadoInteres: c.pagado_interes,
    pagadoMora: c.pagado_mora,
    pagadoCargos: c.pagado_cargos,
  }));

  const deuda = calcularDeudaConsolidada(cuotasDom, {
    moraActiva: config.moraActiva,
    tasaMoraDiaria: config.tasaMoraDiaria,
    diasGracia: graciaCred,
  });

  return { credito, config, deuda, tenantId, role, vendedorId } as const;
}

/**
 * GET /api/creditos/[id]/refinanciar
 * Previsualización: deuda viva a consolidar (capital + interés + cargos + mora) y
 * valores sugeridos para el crédito nuevo (tasa/plazo/frecuencia del original).
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { id } = await params;
  const r = await cargarRefinanciable(req, id);
  if ("error" in r && r.error) return r.error;
  const { credito, deuda } = r as Extract<typeof r, { credito: object }>;

  return successResponse({
    credito: {
      id: credito.id,
      numero: credito.numero,
      cliente: nombreCompleto(credito.cliente),
      tasa: credito.tasa,
      plazo_meses: credito.plazo_meses,
      frecuencia: credito.frecuencia,
      dias_mora: credito.dias_mora,
    },
    deuda,
    sugerido: { tasa: credito.tasa, plazo_meses: credito.plazo_meses, frecuencia: credito.frecuencia },
  });
});

/**
 * POST /api/creditos/[id]/refinanciar
 * Cierra el crédito moroso (estado "refinanciado") y crea un crédito NUEVO cuyo
 * capital es la deuda consolidada menos una quita opcional. NO mueve caja (no hay
 * plata nueva: es una reestructuración de deuda). Ambos créditos quedan vinculados.
 *
 * Body: {
 *   tasa, plazo_meses, frecuencia?,           // condiciones renegociadas del nuevo crédito
 *   quita_tipo?: "ninguna"|"porcentaje"|"monto", quita_valor?: number,
 *   fecha_inicio?, motivo?
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { id } = await params;
  const r = await cargarRefinanciable(req, id);
  if ("error" in r && r.error) return r.error;
  const { credito, config, deuda, tenantId } = r as Extract<typeof r, { credito: object }>;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const tasa = Number(body.tasa);
  const plazoMeses = Math.trunc(Number(body.plazo_meses));
  if (!isFinite(tasa) || tasa < 0) return errorResponse("Tasa inválida", "INVALID_INPUT", 400);
  if (!isFinite(plazoMeses) || plazoMeses < 1) return errorResponse("Plazo inválido (mínimo 1 cuota)", "INVALID_INPUT", 400);

  // Quita opcional sobre la base consolidada (condonación parcial como incentivo).
  const quitaTipo = (["ninguna", "porcentaje", "monto"].includes(body.quita_tipo) ? body.quita_tipo : "ninguna") as TipoQuita;
  const quita = aplicarQuita(deuda.total, quitaTipo, Number(body.quita_valor) || 0);
  const nuevoCapital = quita.nuevoCapital;
  if (nuevoCapital <= 0) {
    return errorResponse("El capital a refinanciar quedó en cero tras la quita.", "INVALID_INPUT", 400);
  }

  // Snapshots vigentes para el crédito NUEVO (mismo criterio que POST /creditos).
  const frecuencia = normalizarFrecuencia(body.frecuencia ?? credito.frecuencia);
  const cargosSnapshot = config.simulador.cargos;
  const frecuenciaDef = resolverFrecuencia(frecuencia, config.simulador.frecuencias);
  const cronogramaSnapshot = {
    diaCorte: config.simulador.diaCorte,
    diaVencimiento: config.simulador.diaVencimientoFijo,
    diasGracia: config.simulador.diasGracia,
    incluirSabado: config.simulador.incluirSabadoNoHabil,
    feriados: config.simulador.feriados,
  };
  const fechaInicio = body.fecha_inicio ? new Date(body.fecha_inicio) : hoyComercial();

  const plan = construirPlanAmortizacion(
    nuevoCapital,
    tasa,
    plazoMeses,
    fechaInicio,
    config.convencionTasa,
    frecuencia,
    { cargos: cargosSnapshot, redondeo: config.simulador.redondeoCuota, cronograma: cronogramaSnapshot },
    config.simulador.frecuencias
  );
  const filasCuota = planACuotas(plan);
  const proximoPago = plan.cuotas[0]?.fecha ?? fechaInicio;
  const motivo = body.motivo?.trim() || null;
  const numeroViejo = formatCreditoNumero(credito.numero);

  // Transacción: nace el crédito nuevo, se cierra el viejo. Sin movimiento de caja
  // (no hay desembolso: la deuda simplemente se traslada a un crédito nuevo).
  const { nuevo } = await prisma.$transaction(async (tx) => {
    const maxNum = await tx.creditos.aggregate({ where: { ...withTenant(tenantId) }, _max: { numero: true } });
    const numero = (maxNum._max.numero ?? 0) + 1;

    const nuevo = await tx.creditos.create({
      data: {
        numero,
        cliente_id: credito.cliente_id,
        tipo_credito: credito.tipo_credito,
        monto_original: nuevoCapital,
        saldo_pendiente: nuevoCapital,
        tasa,
        plazo_meses: plazoMeses,
        frecuencia,
        frecuencia_def: frecuenciaDef as object,
        cargos: cargosSnapshot as object,
        cronograma: cronogramaSnapshot as object,
        fecha_inicio: fechaInicio,
        proximo_pago: proximoPago,
        vendedor_id: credito.vendedor_id,
        es_refinanciacion: true,
        refinancia_a: credito.id,
        ...withTenant(tenantId),
      },
      include: { cliente: true },
    });

    await tx.cuotas.createMany({
      data: filasCuota.map((f) => ({
        ...withTenant(tenantId),
        credito_id: nuevo.id,
        nro: f.nro,
        fecha_vencimiento: f.fecha_vencimiento,
        saldo_inicial: f.saldo_inicial,
        capital: f.capital,
        interes: f.interes,
        iva: f.iva,
        seguro: f.seguro,
        gastos: f.gastos,
        cuota_total: f.cuota_total,
      })),
    });

    // Cierra el crédito original: deuda saldada por refinanciación (no por cobro).
    await tx.creditos.update({
      where: { id: credito.id },
      data: {
        estado: "refinanciado",
        saldo_pendiente: 0,
        proximo_pago: null,
        dias_mora: 0,
        refinanciado_en: nuevo.id,
        motivo_anulacion: motivo, // se reutiliza el campo de motivo para la nota de reestructuración
      },
    });

    return { nuevo };
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: credito.id,
    accion: "refinanciar",
    descripcion: `Crédito ${numeroViejo} refinanciado en ${formatCreditoNumero(nuevo.numero)} — deuda consolidada $${deuda.total.toLocaleString("es-AR")}${quita.condonado > 0 ? `, quita $${quita.condonado.toLocaleString("es-AR")}` : ""}${motivo ? ` — ${motivo}` : ""}`,
    meta: {
      credito_origen: credito.numero,
      credito_nuevo: nuevo.numero,
      deuda_consolidada: deuda,
      quita: { tipo: quitaTipo, condonado: quita.condonado },
      nuevo_capital: nuevoCapital,
      tasa,
      plazo_meses: plazoMeses,
      frecuencia,
    },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: nuevo.id,
    accion: "crear",
    descripcion: `Crédito ${formatCreditoNumero(nuevo.numero)} creado por refinanciación de ${numeroViejo} — $${nuevoCapital.toLocaleString("es-AR")}`,
    meta: { refinancia_a: credito.numero, monto: nuevoCapital, tasa, plazo_meses: plazoMeses, frecuencia, es_refinanciacion: true },
  });

  return successResponse(
    {
      nuevo,
      origen: { id: credito.id, numero: credito.numero },
      deuda,
      quita: { tipo: quitaTipo, condonado: quita.condonado },
      nuevo_capital: nuevoCapital,
    },
    201
  );
});
