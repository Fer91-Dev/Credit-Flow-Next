import { requireAuth, requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  cuotaMensualFrancesa,
  tasaPeriodicaSegunConvencion,
  interesMora,
  normalizarFrecuencia,
  resolverFrecuencia,
  sumarPeriodos,
  construirPlanAmortizacion,
  planACuotas,
  estadoCoherente,
  etiquetaCaja,
  esCuentaValida,
  CUENTA_LABEL,
  type Cuenta,
  type FrecuenciaDef,
} from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { getConfiguracion } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/creditos
 * Lista de créditos del usuario, con filtros opcionales.
 * Query params:
 * - ?estado=activo — filtrar por estado
 * - ?cliente_id=uuid — filtrar por cliente específico
 * - ?limit=100
 * - ?offset=0
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");
  const clienteId = url.searchParams.get("cliente_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  // Anti-IDOR: el vendedor solo ve SUS créditos; admin/cobrador ven todo el tenant.
  const where: Record<string, any> = { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }) };
  if (estado) where.estado = estado;
  if (clienteId) where.cliente_id = clienteId;

  const [creditos, total] = await Promise.all([
    prisma.creditos.findMany({
      where,
      include: {
        cliente: { select: { id: true, nombre: true, apellido: true, documento: true } },
        vendedor: { select: { id: true, nombre: true } },
        pagos: { orderBy: { fecha: "desc" }, take: 5 },
      },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.creditos.count({ where }),
  ]);

  // Enriquecemos con el interés moratorio calculado por el motor de dominio
  // (mismo criterio que el endpoint de pagos: cuota francesa × tasa diaria × días).
  // Solo se calcula para créditos activos en mora; el resto queda en 0.
  const config = await getConfiguracion(tenantId);
  const creditosConMora = creditos.map((c) => {
    let interes_mora = 0;
    if (
      config.moraActiva &&
      c.dias_mora > 0 &&
      c.estado === "activo" &&
      c.monto_original > 0 &&
      c.plazo_meses >= 1
    ) {
      const frec = normalizarFrecuencia(c.frecuencia);
      const catFrec = c.frecuencia_def ? [c.frecuencia_def as unknown as FrecuenciaDef] : config.simulador.frecuencias;
      const tasaPeriodica = tasaPeriodicaSegunConvencion(c.tasa, config.convencionTasa, frec, catFrec);
      const cuota = cuotaMensualFrancesa(c.monto_original, tasaPeriodica, c.plazo_meses);
      const graciaCred = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
      interes_mora = interesMora(cuota, c.dias_mora, { tasaDiaria: config.tasaMoraDiaria, diasGracia: graciaCred });
    }
    // Estado reconciliado: defensa de lectura ante datos legacy. La lista no carga
    // cuotas, así que se valida contra el saldo (autoritativo, derivado del ledger).
    const estado = estadoCoherente(c.estado, c.saldo_pendiente);
    return { ...c, estado, interes_mora, tiene_pagos: c.pagos.length > 0 };
  });

  return successResponse({
    creditos: creditosConMora,
    total,
    limit,
    offset,
  });
});

/**
 * POST /api/creditos
 * Crea un nuevo crédito.
 * Body requerido:
 * {
 *   "cliente_id": "uuid",
 *   "tipo_credito": "personal|empresarial|otro",
 *   "monto_original": 1000000,
 *   "tasa": 2.5,
 *   "plazo_meses": 12,
 *   "solicitud_id": "uuid (optional)"
 * }
 */
/**
 * Asegura que un usuario-vendedor tenga su ficha comercial (`vendedores`).
 * Si su perfil aún no está vinculado, crea la ficha desde sus datos y la vincula.
 * Devuelve el `vendedores.id` a usar para atribuir el crédito y la comisión.
 *
 * Garantiza que CUALQUIER usuario con rol vendedor pueda otorgar créditos sin
 * depender de un alta manual previa en Personal.
 */
async function asegurarFichaVendedor(
  tenantId: string,
  userId: string,
  nombre: string | null,
  email: string | null
): Promise<string> {
  const ficha = await prisma.vendedores.create({
    data: {
      ...withTenant(tenantId),
      nombre: nombre?.trim() || email?.split("@")[0] || "Vendedor",
      email: email ?? null,
      activo: true,
      comision_pct: 0,
      meta_venta: 0,
    },
    select: { id: true },
  });
  await prisma.profiles.update({ where: { id: userId }, data: { vendedor_id: ficha.id } });
  return ficha.id;
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  // Otorgar créditos: admin y vendedor. El cobrador NO puede otorgar.
  const { tenantId, role, vendedorId: miVendedorId, userId, nombre, email } = await requireRole(["admin", "vendedor"], req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar campos requeridos
  const required = ["cliente_id", "tipo_credito", "monto_original", "tasa", "plazo_meses"];
  for (const field of required) {
    if (!(field in body)) {
      return errorResponse(`Campo '${field}' requerido`, "INVALID_INPUT", 400);
    }
  }

  // Validar que el cliente existe y pertenece al usuario
  const cliente = await prisma.clientes.findFirst({
    where: { ...withTenant(tenantId), id: body.cliente_id },
  });

  if (!cliente) {
    return errorResponse("Cliente no encontrado o no tiene permisos", "INVALID_REFERENCE", 400);
  }

  // Validar montos
  if (body.monto_original <= 0 || body.tasa < 0 || body.plazo_meses < 1) {
    return errorResponse("Montos inválidos", "INVALID_INPUT", 400);
  }

  // Atribución del vendedor.
  //  - Si quien otorga ES vendedor: se fuerza su propio vendedor_id (anti-IDOR;
  //    no puede atribuir el crédito a otro). Su perfil debe estar vinculado.
  //  - Si es admin: puede elegir vendedor_id (opcional), validado contra el tenant.
  let vendedorId: string | null = null;
  if (role === "vendedor") {
    // Un vendedor SIEMPRE puede otorgar (es su función). Si su perfil aún no está
    // vinculado a una ficha comercial, se autoprovisiona y vincula al vuelo: nunca
    // queda bloqueado por un tema de setup.
    vendedorId = miVendedorId ?? (await asegurarFichaVendedor(tenantId, userId, nombre, email));
  } else if (body.vendedor_id) {
    const vendedor = await prisma.vendedores.findFirst({
      where: { ...withTenant(tenantId), id: body.vendedor_id },
      select: { id: true },
    });
    if (!vendedor) {
      return errorResponse("Vendedor no encontrado o sin permisos", "INVALID_REFERENCE", 400);
    }
    vendedorId = vendedor.id;
  }

  // Cuenta de desembolso elegida (efectivo | banco [transferencia] | dolares).
  const cuentaDesembolso: Cuenta = esCuentaValida(body.cuenta_desembolso) ? body.cuenta_desembolso : "efectivo";

  // Límite de otorgamiento (autoritativo): un vendedor no puede otorgar por encima
  // de su tope configurado sin autorización de un superior. El admin no tiene tope.
  if (role === "vendedor" && vendedorId) {
    const ficha = await prisma.vendedores.findFirst({
      where: { ...withTenant(tenantId), id: vendedorId },
      select: { limite_aprobacion: true },
    });
    const limite = ficha?.limite_aprobacion;
    if (limite != null && body.monto_original > limite) {
      return errorResponse(
        `El monto ($${Number(body.monto_original).toLocaleString("es-AR")}) supera tu límite de otorgamiento ($${limite.toLocaleString("es-AR")}). Requiere autorización de un administrador.`,
        "LIMIT_EXCEEDED",
        403,
      );
    }

    // Fondos disponibles (autoritativo): el desembolso sale de la cuenta elegida
    // (efectivo/banco/dólares) de la caja del vendedor; no puede prestar más de lo
    // que tiene en esa cuenta. Si no le alcanza, debe pedir una entrega al admin.
    const saldoCuenta = await prisma.movimientos_caja.aggregate({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId, cuenta: cuentaDesembolso },
      _sum: { monto: true },
    });
    const disponible = Math.round((saldoCuenta._sum.monto ?? 0) * 100) / 100;
    if (body.monto_original > disponible) {
      return errorResponse(
        `No tenés saldo suficiente en tu caja de ${CUENTA_LABEL[cuentaDesembolso]}. Disponible: $${disponible.toLocaleString("es-AR")} — necesitás $${Number(body.monto_original).toLocaleString("es-AR")}. Pedí una entrega al administrador para poder otorgar.`,
        "INSUFFICIENT_FUNDS",
        403,
      );
    }
  }

  // Frecuencia de pago (default mensual). El período de cada cuota lo da este campo.
  const frecuencia = normalizarFrecuencia(body.frecuencia);

  // Snapshot de cargos vigentes: congela las reglas de cargos del tenant en el
  // crédito, para que cambios futuros de configuración no lo alteren.
  const configActual = await getConfiguracion(tenantId);
  const cargosSnapshot = configActual.simulador.cargos;
  // Snapshot de la definición de frecuencia: congela días/períodos del crédito.
  const frecuenciaDef = resolverFrecuencia(frecuencia, configActual.simulador.frecuencias);
  // Snapshot del cronograma (corte/día de vencimiento/gracia/feriados): congela las
  // fechas de cobranza y la tolerancia de mora del crédito ante cambios de config.
  const cronogramaSnapshot = {
    diaCorte: configActual.simulador.diaCorte,
    diaVencimiento: configActual.simulador.diaVencimientoFijo,
    diasGracia: configActual.simulador.diasGracia,
    incluirSabado: configActual.simulador.incluirSabadoNoHabil,
    feriados: configActual.simulador.feriados,
  };

  // Fecha de desembolso y vencimiento de la 1ª cuota (un período después).
  const fechaInicio = body.fecha_inicio ? new Date(body.fecha_inicio) : new Date();
  const proximoPago = body.proximo_pago
    ? new Date(body.proximo_pago)
    : sumarPeriodos(fechaInicio, 1, frecuencia, configActual.simulador.frecuencias);

  // Si hay solicitud_id, verificar que existe
  if (body.solicitud_id) {
    const solicitud = await prisma.solicitudes.findFirst({
      where: { ...withTenant(tenantId), id: body.solicitud_id },
    });
    if (!solicitud) {
      return errorResponse("Solicitud no encontrada", "INVALID_REFERENCE", 400);
    }
  }

  // Plan de cuotas persistido (Fase 6A): se congela el cronograma al otorgar,
  // reusando el mismo motor y los mismos snapshots (frecuencia/cargos/redondeo).
  const plan = construirPlanAmortizacion(
    body.monto_original,
    body.tasa,
    body.plazo_meses,
    fechaInicio,
    configActual.convencionTasa,
    frecuencia,
    {
      cargos: cargosSnapshot,
      redondeo: configActual.simulador.redondeoCuota,
      cronograma: cronogramaSnapshot,
    },
    configActual.simulador.frecuencias
  );
  const filasCuota = planACuotas(plan);
  // El próximo pago = 1ª cuota del plan (respeta el cronograma de corte/vencimiento).
  const proximoPagoFinal = body.proximo_pago ? new Date(body.proximo_pago) : (plan.cuotas[0]?.fecha ?? proximoPago);

  // Crédito + cuotas en una transacción: un crédito nunca queda sin cronograma.
  const credito = await prisma.$transaction(async (tx) => {
    // Número identificador legible, secuencial por tenant (CRD-000123).
    const maxNum = await tx.creditos.aggregate({
      where: { ...withTenant(tenantId) },
      _max: { numero: true },
    });
    const numero = (maxNum._max.numero ?? 0) + 1;

    const c = await tx.creditos.create({
      data: {
        numero,
        cliente_id: body.cliente_id,
        tipo_credito: body.tipo_credito,
        monto_original: body.monto_original,
        saldo_pendiente: body.monto_original,
        tasa: body.tasa,
        plazo_meses: body.plazo_meses,
        frecuencia,
        frecuencia_def: frecuenciaDef as object,
        cargos: cargosSnapshot as object,
        cronograma: cronogramaSnapshot as object,
        fecha_inicio: fechaInicio,
        proximo_pago: proximoPagoFinal,
        solicitud_id: body.solicitud_id || null,
        vendedor_id: vendedorId,
        ...withTenant(tenantId),
      },
      include: { cliente: true },
    });

    await tx.cuotas.createMany({
      data: filasCuota.map((f) => ({
        ...withTenant(tenantId),
        credito_id: c.id,
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

    // Movimiento de caja: desembolso (egreso) al otorgar.
    const numComp = await siguienteNumeroComprobante(tx, tenantId, "DES");
    await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha: fechaInicio,
        tipo: "desembolso",
        monto: -Math.abs(c.monto_original),
        cuenta: cuentaDesembolso, // el desembolso sale de la cuenta elegida (coincide con el control de fondos)
        credito_id: c.id,
        vendedor_id: vendedorId, // sale de la caja personal del vendedor que otorga (null = caja principal)
        origen: etiquetaCaja(!!vendedorId, cuentaDesembolso),
        destino: nombreCompleto(cliente),
        serie: "DES",
        numero: numComp,
        descripcion: `Desembolso ${formatCreditoNumero(c.numero)} · ${nombreCompleto(cliente)}`,
      },
    });

    return c;
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: credito.id,
    accion: "crear",
    descripcion: `Crédito ${formatCreditoNumero(credito.numero)} otorgado a ${nombreCompleto(cliente)} por $${credito.monto_original.toLocaleString("es-AR")}`,
    meta: { numero: credito.numero, monto: credito.monto_original, tasa: credito.tasa, plazo_meses: credito.plazo_meses, frecuencia: credito.frecuencia, tipo: credito.tipo_credito },
  });

  return successResponse(credito, 201);
});
