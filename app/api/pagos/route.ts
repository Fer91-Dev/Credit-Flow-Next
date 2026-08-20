import { requireRole, scopeCreditosVendedor, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { sincronizarAcuerdos } from "@/lib/acuerdos";
import { nombreCompleto, formatCreditoNumero, hoyComercial } from "@/lib/utils";
import { imputarPagoEnCuotas, diasAtraso, round2, etiquetaCaja, cuentaDeMetodo, esCuentaValida, type CuotaParaImputar, moraDelCredito, moraDesdeCronograma, esCreditoVivo } from "@/lib/domain";
import { lockCreditoTx, assertCuotasSinCambios, TX_PLATA } from "@/lib/locks";
import { lockCuentaTx } from "@/lib/caja-fondos";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { getConfiguracion } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * GET /api/pagos
 * Lista de pagos del usuario.
 * Query params:
 * - ?credito_id=uuid — filtrar por crédito
 * - ?limit=100
 * - ?offset=0
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Terminal de cobros: admin, cobrador y vendedor (este último, solo SUS créditos).
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

  const url = new URL(req.url);
  const creditoId = url.searchParams.get("credito_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Record<string, any> = { ...withTenant(tenantId) };
  if (creditoId) where.credito_id = creditoId;
  // Anti-IDOR: el vendedor solo ve los pagos de los créditos que él otorgó.
  const scope = scopeCreditosVendedor({ role, vendedorId });
  if (scope.vendedor_id) where.credito = { vendedor_id: scope.vendedor_id };

  const [pagos, total] = await Promise.all([
    prisma.pagos.findMany({
      where,
      include: {
        credito: {
          select: {
            id: true,
            numero: true,
            cliente_id: true,
            monto_original: true,
            saldo_pendiente: true,
            cliente: { select: { nombre: true, apellido: true } },
          },
        },
        // Si el cobro salió de una cuota de ACUERDO, el historial y el recibo tienen que
        // poder decirlo. Sin esto se ve un importe suelto que no coincide con ninguna cuota
        // del crédito, y el cliente cree que le cobraron mal.
        acuerdo_cuota: {
          select: { numero: true, acuerdo: { select: { _count: { select: { cuotas: true } } } } },
        },
      },
      orderBy: { fecha: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.pagos.count({ where }),
  ]);

  return successResponse({
    pagos,
    total,
    limit,
    offset,
  });
});

/**
 * POST /api/pagos
 * Registra un pago aplicando el motor de imputación Mora → Interés → Capital.
 * Body requerido:
 * {
 *   "credito_id": "uuid",
 *   "monto": 100000,
 *   "metodo": "efectivo|transferencia|cheque|otro",
 *   "fecha": "2024-06-12",   // opcional, default hoy
 *   "notas": "string"        // opcional
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  // Registrar un cobro: admin, cobrador y vendedor (este último, solo SUS créditos).
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

  // Defensa en profundidad: un vendedor SIN ficha de agente vinculada no puede cobrar, porque
  // el movimiento caería en la caja principal (vendedor_id null) en vez de en su caja. Con el
  // vínculo obligatorio esto no debería pasar, pero cubre cuentas legacy mal vinculadas.
  if (role === "vendedor" && !vendedorId) {
    return errorResponse(
      "Tu usuario no está vinculado a una ficha de agente; no podés registrar cobros hasta que un administrador lo vincule.",
      "NO_VENDEDOR",
      400,
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.credito_id || !body.monto || !body.metodo) {
    return errorResponse(
      "Campos requeridos: credito_id, monto, metodo",
      "INVALID_INPUT",
      400
    );
  }

  // Coerción explícita ANTES de comparar: `"abc" <= 0` es false, así que un monto no numérico
  // atravesaba esta guarda y reventaba recién en Prisma → salía como 500 "error interno" en vez
  // de un 400 que le dijera al operador qué escribió mal.
  const montoPago = round2(Number(body.monto));
  if (!Number.isFinite(montoPago) || montoPago <= 0) {
    return errorResponse("Monto debe ser un número mayor a 0", "INVALID_INPUT", 400);
  }

  // Anti-IDOR: un vendedor solo puede cobrar sobre créditos que él otorgó.
  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id: body.credito_id },
    include: { cliente: true, cuotas: { orderBy: { nro: "asc" } } },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "INVALID_REFERENCE", 400);
  }

  /**
   * Solo se cobra sobre un crédito VIVO (activo o vencido).
   *
   * 🔴 Antes esto era una lista negra de tres estados y **`refinanciado` no estaba**. Al
   * refinanciar, el crédito viejo queda con `saldo_pendiente: 0` pero sus cuotas siguen
   * impagas en la base, así que un cobro sobre él encontraba deuda, imputaba, y el update
   * final lo devolvía a "vencido" con su saldo original completo: el cliente pasaba a deber
   * las DOS deudas, la vieja resucitada y la consolidada. `refinanciado` está declarado como
   * estado void justamente para esto — la lista blanca lo cubre sin poder olvidarse ninguno.
   */
  if (!esCreditoVivo(credito.estado)) {
    const motivo =
      credito.estado === "anulado"
        ? "está anulado"
        : credito.estado === "refinanciado"
          ? "fue refinanciado: la deuda se trasladó al crédito nuevo y ahí se cobra"
          : "ya está saldado";
    return errorResponse(`El crédito ${motivo}; no admite cobros`, "INVALID_STATE", 400);
  }

  if (credito.cuotas.length === 0) {
    return errorResponse(
      "El crédito no tiene cronograma de cuotas; regeneralo antes de cobrar",
      "INVALID_STATE",
      400
    );
  }

  // ── Motor financiero cuota-dirigido (Fase 6B) ──────────────────────────────
  // El pago se imputa cuota por cuota (la más vieja primero). El interés es el
  // CONGELADO del plan; el atraso se castiga con mora por cuota vencida.

  const config = await getConfiguracion(tenantId);
  const fechaPago = body.fecha ? new Date(body.fecha) : hoyComercial();
  // P2 — Un cobro no puede fecharse en el futuro (distorsiona mora, caja y reportes).
  if (Number.isNaN(fechaPago.getTime())) {
    return errorResponse("Fecha de pago inválida", "FECHA_INVALIDA", 400);
  }
  if (fechaPago.getTime() > hoyComercial().getTime()) {
    return errorResponse("La fecha del pago no puede ser futura.", "FECHA_INVALIDA", 400);
  }
  // Cuenta de caja donde impacta el cobro: explícita si viene en el body, si no derivada
  // del método (efectivo→efectivo, transferencia/cheque→banco). Antes SIEMPRE caía en efectivo.
  const cuentaCobro = esCuentaValida(body.cuenta) ? body.cuenta : cuentaDeMetodo(body.metodo);

  // ── Campañas de recuperación activas (Fase 7B) ─────────────────────────────
  // Si el crédito es objetivo de una campaña ACTIVA con quita de intereses vigente
  // (sin fecha de corte o aún dentro del plazo), se aplica el % al cobrar.
  const objetivosActivos = await prisma.campana_objetivo.findMany({
    where: {
      ...withTenant(tenantId),
      credito_id: body.credito_id,
      campana: { estado: "activa" },
    },
    include: { campana: { select: { promo_tipo: true, promo_valor: true, promo_vence: true } } },
  });
  const descuentoMoraPct = objetivosActivos.reduce((max, o) => {
    const c = o.campana;
    const vigente = c.promo_tipo === "quita_interes" && (!c.promo_vence || c.promo_vence >= fechaPago);
    return vigente ? Math.max(max, c.promo_valor) : max;
  }, 0);

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

  const graciaCred = (credito.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;

  // ── Acuerdo de pago con punitorios congelados ───────────────────────────────
  // Si el crédito tiene un acuerdo VIGENTE y la financiera ofreció frenar los punitorios,
  // la mora deja de correr desde la fecha en que se acordó. Es la contraprestación de que
  // el deudor se haya comprometido, y estaba prometida en pantalla desde el primer día.
  // `estado: "vigente"` es la clave: un acuerdo roto o anulado NO congela nada.
  const acuerdoVigente = await prisma.acuerdos_pago.findFirst({
    where: { ...withTenant(tenantId), credito_id: body.credito_id, estado: "vigente", congela_punitorios: true },
    select: { fecha: true },
  });

  /**
   * Cuota del acuerdo que se está cobrando, si el cobro salió de la terminal del acuerdo.
   *
   * Se GUARDA en el pago para que el recibo y el historial puedan decir "cuota 2 de 3 del
   * acuerdo". Las cuotas del acuerdo se marcan pagadas repartiendo el total cobrado desde
   * que se armó, así que ese vínculo no existía en ningún lado; derivarlo al imprimir sería
   * peor, porque anular un pago viejo remapearía recibos ya entregados.
   *
   * 🔴 Se valida contra el acuerdo de ESTE crédito: un id de otro crédito (o de otra
   * financiera) no se guarda, se ignora. Nunca confiar en un id que llega del navegador.
   */
  let acuerdoCuotaId: string | null = null;
  if (typeof body.acuerdo_cuota_id === "string" && body.acuerdo_cuota_id) {
    const cuotaAcuerdo = await prisma.acuerdo_cuota.findFirst({
      where: {
        ...withTenant(tenantId),
        id: body.acuerdo_cuota_id,
        acuerdo: { ...withTenant(tenantId), credito_id: body.credito_id, estado: "vigente" },
      },
      select: { id: true },
    });
    acuerdoCuotaId = cuotaAcuerdo?.id ?? null;
  }

  // Condiciones de mora CONGELADAS al otorgar este crédito (la config actual solo es
  // fallback para créditos viejos). Ver `moraDelCredito` en lib/domain/mora.ts.
  const moraCred = moraDelCredito(moraDesdeCronograma(credito.cronograma), config);

  const resultado = imputarPagoEnCuotas(montoPago, cuotasDom, {
    modoCargos: config.imputarCargos,
    moraActiva: moraCred.moraActiva,
    tasaMoraDiaria: moraCred.tasaMoraDiaria,
    hoy: fechaPago,
    descuentoMoraPct,
    diasGracia: graciaCred,
    moraCongeladaAl: acuerdoVigente?.fecha ?? null,
  });

  // P1 — Sobrepago: el cobro no puede exceder la deuda total del crédito. Si la imputación
  // deja excedente, se rechaza (decisión de tesorería: no inflar la caja ni cerrar el crédito
  // con plata sin imputar; el vuelto físico queda fuera del sistema). El monto ya considera la
  // quita de mora de campaña, así que el máximo cobrable = monto − excedente.
  if (resultado.excedente > 0) {
    const cobrable = round2(montoPago - resultado.excedente);
    return errorResponse(
      `El monto ($${montoPago.toLocaleString("es-AR")}) supera la deuda total del crédito. Cobrá hasta $${cobrable.toLocaleString("es-AR")}.`,
      "SOBREPAGO",
      400,
    );
  }

  const aplicacionPorCuota = new Map(resultado.aplicaciones.map((a) => [a.id, a]));
  const saldoAnterior = credito.saldo_pendiente;

  // Estado proyectado de cada cuota tras aplicar este pago (para crédito + persistencia).
  const cuotasActualizadas = credito.cuotas.map((c) => {
    const a = aplicacionPorCuota.get(c.id);
    const pagadoCapital = round2(c.pagado_capital + (a?.aplicadoCapital ?? 0));
    const pagadoInteres = round2(c.pagado_interes + (a?.aplicadoInteres ?? 0));
    const pagadoMora = round2(c.pagado_mora + (a?.aplicadoMora ?? 0));
    const pagadoCargos = round2(c.pagado_cargos + (a?.aplicadoCargos ?? 0));
    const capitalSaldado = pagadoCapital >= round2(c.capital);
    const dias = diasAtraso(c.fecha_vencimiento, fechaPago);
    let estado: string;
    if (capitalSaldado) estado = "pagada";
    else if (pagadoCapital > 0 || pagadoInteres > 0 || pagadoMora > 0 || pagadoCargos > 0) estado = "parcial";
    else if (dias > 0) estado = "vencida";
    else estado = "pendiente";
    return {
      c, a, pagadoCapital, pagadoInteres, pagadoMora, pagadoCargos, capitalSaldado, dias, estado,
    };
  });

  // Agregados del crédito derivados del libro mayor de cuotas.
  const saldoCapital = round2(
    cuotasActualizadas.reduce((s, x) => s + noNeg(x.c.capital - x.pagadoCapital), 0)
  );
  const todasSaldadas = cuotasActualizadas.every((x) => x.capitalSaldado);
  const pendientes = cuotasActualizadas.filter((x) => !x.capitalSaldado);
  const diasMoraMax = pendientes.reduce((m, x) => Math.max(m, x.dias), 0);
  const proximaCuota = pendientes[0] ?? null;

  // ── Persistencia (transacción) ─────────────────────────────────────────────
  const pago = await prisma.$transaction(async (tx) => {
    /**
     * 🔴 Serializar los cobros de ESTE crédito antes de tocar nada.
     *
     * La imputación de arriba se calculó fuera de la transacción, y las escrituras de abajo
     * son valores ABSOLUTOS (`pagado_capital: 4500`), no incrementos. Sin esto, dos cobros
     * simultáneos —un doble clic en "Cobrar" alcanza— leían las cuotas en el mismo estado,
     * calculaban la misma imputación y la segunda pisaba a la primera: quedaban dos filas en
     * `pagos` y dos movimientos de caja, con las cuotas reflejando un solo cobro.
     *
     * El lock hace esperar al segundo; la comparación de abajo detecta que el estado cambió
     * mientras esperaba y lo aborta con 409 en vez de escribir sobre un cálculo viejo.
     */
    await lockCreditoTx(tx, tenantId, body.credito_id);
    const cuotasAhora = await tx.cuotas.findMany({
      where: { ...withTenant(tenantId), credito_id: body.credito_id },
      select: { id: true, pagado_capital: true, pagado_interes: true, pagado_mora: true, pagado_cargos: true },
    });
    assertCuotasSinCambios(credito.cuotas, cuotasAhora);

    // El estado también pudo cambiar mientras esperábamos (una anulación, una refinanciación).
    const estadoAhora = await tx.creditos.findFirst({
      where: { ...withTenant(tenantId), id: body.credito_id },
      select: { estado: true },
    });
    if (!estadoAhora || !esCreditoVivo(estadoAhora.estado)) {
      throw new ApiError(
        "El crédito dejó de admitir cobros mientras se procesaba este pago (se anuló o se refinanció).",
        "INVALID_STATE",
        409,
      );
    }

    const p = await tx.pagos.create({
      data: {
        credito_id: body.credito_id,
        monto: montoPago,
        metodo: body.metodo,
        fecha: fechaPago,
        notas: body.notas?.trim() || null,
        aplicado_mora: resultado.totales.mora,
        aplicado_interes: resultado.totales.interes,
        aplicado_cargos: resultado.totales.cargos,
        aplicado_capital: resultado.totales.capital,
        excedente: resultado.excedente,
        // Qué cuota del ACUERDO se estaba cobrando (null = cobro normal del crédito). Se
        // valida contra el acuerdo vigente de ESTE crédito, así que un id ajeno no entra.
        acuerdo_cuota_id: acuerdoCuotaId,
        ...withTenant(tenantId),
      },
      include: {
        credito: {
          select: {
            id: true,
            monto_original: true,
            saldo_pendiente: true,
            cliente: { select: { nombre: true, apellido: true } },
          },
        },
      },
    });

    if (resultado.aplicaciones.length > 0) {
      await tx.pago_cuota.createMany({
        data: resultado.aplicaciones.map((a) => ({
          ...withTenant(tenantId),
          pago_id: p.id,
          cuota_id: a.id,
          aplicado_capital: a.aplicadoCapital,
          aplicado_interes: a.aplicadoInteres,
          aplicado_mora: a.aplicadoMora,
          aplicado_cargos: a.aplicadoCargos,
        })),
      });
    }

    // Actualizar solo las cuotas tocadas por este pago.
    for (const x of cuotasActualizadas) {
      if (!x.a) continue;
      await tx.cuotas.update({
        where: { id: x.c.id },
        data: {
          pagado_capital: x.pagadoCapital,
          pagado_interes: x.pagadoInteres,
          pagado_mora: x.pagadoMora,
          pagado_cargos: x.pagadoCargos,
          pagado: round2(x.pagadoCapital + x.pagadoInteres + x.pagadoMora + x.pagadoCargos),
          estado: x.estado,
        },
      });
    }

    await tx.creditos.update({
      where: { id: body.credito_id },
      data: {
        saldo_pendiente: saldoCapital,
        // P3 — Estado coherente con el ledger tras cobrar: saldado → "pagado"; si quedan
        // cuotas vencidas → "vencido"; si el pago dejó el crédito al día → "activo" (antes
        // arrastraba "vencido" hasta que lo reconciliaba una lectura o el cron).
        estado: todasSaldadas ? "pagado" : diasMoraMax > 0 ? "vencido" : "activo",
        dias_mora: todasSaldadas ? 0 : diasMoraMax,
        proximo_pago: todasSaldadas ? null : (proximaCuota?.c.fecha_vencimiento ?? null),
      },
    });

    // Movimiento de caja: cobro (ingreso).
    //
    // El lock de la cuenta lo tomaban solo los EGRESOS (vía `assertFondosSuficientesTx`), así
    // que un arqueo podía leer el saldo, emitir su ajuste y quedar descuadrado por un cobro que
    // entró en el medio: el acta decía "cuadrada" y la cuenta terminaba arriba. Los ingresos
    // también lo piden ahora, que es lo que el arqueo promete cuando lo toma.
    const cajaDelCobro = role === "vendedor" ? vendedorId : null;
    await lockCuentaTx(tx, tenantId, cajaDelCobro, cuentaCobro);
    const numComp = await siguienteNumeroComprobante(tx, tenantId, "REC");
    await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha: fechaPago,
        tipo: "cobro",
        monto: Math.abs(montoPago),
        metodo: body.metodo,
        cuenta: cuentaCobro, // el cobro impacta en efectivo o banco según el método
        credito_id: body.credito_id,
        pago_id: p.id,
        // La cobranza entra a la caja de QUIEN cobra: un vendedor cobra a SU caja;
        // un admin/cobrador cobra para la empresa → caja principal (vendedor_id null).
        vendedor_id: cajaDelCobro,
        origen: nombreCompleto(credito.cliente),
        destino: etiquetaCaja(role === "vendedor", cuentaCobro),
        serie: "REC",
        numero: numComp,
        descripcion: `Cobro ${formatCreditoNumero(credito.numero)} · ${nombreCompleto(credito.cliente)}`,
      },
    });

    // Campañas activas (Fase 7B): acumular lo recuperado en cada objetivo del crédito.
    if (objetivosActivos.length > 0) {
      await tx.campana_objetivo.updateMany({
        where: { id: { in: objetivosActivos.map((o) => o.id) } },
        data: { monto_recuperado: { increment: Math.abs(montoPago) } },
      });
    }

    return p;
  }, TX_PLATA);

  await registrarAuditoria({
    tenantId,
    entidad: "pagos",
    entidadId: pago.id,
    accion: "registrar_pago",
    descripcion: `Pago de $${montoPago.toLocaleString("es-AR")} registrado para ${nombreCompleto(credito.cliente)}`,
    meta: {
      monto: montoPago,
      metodo: body.metodo,
      aplicado_mora: resultado.totales.mora,
      aplicado_interes: resultado.totales.interes,
      aplicado_cargos: resultado.totales.cargos,
      aplicado_capital: resultado.totales.capital,
      excedente: resultado.excedente,
      saldo_anterior: saldoAnterior,
      nuevo_saldo: saldoCapital,
      cuotas_afectadas: resultado.aplicaciones.map((a) => a.nro),
      descuento_mora_pct: descuentoMoraPct,
      ahorro_mora: resultado.ahorroMora,
    },
  });

  // Auto-conciliación de promesas de pago pendientes (no bloquea la respuesta)
  conciliarPromesas(body.credito_id, tenantId, montoPago).catch(() => {});

  // Y del ACUERDO de pago, si el crédito tiene uno vigente: el cliente que termina de
  // pagar lo acordado tiene que verlo cumplido al instante, no cuando corra el cron.
  // Fire-and-forget con el mismo criterio: nunca frenar el cobro por un efecto de estado.
  sincronizarAcuerdos({ tenantId, creditoId: body.credito_id }).catch(() => {});

  return successResponse(
    {
      pago,
      imputacion: {
        aplicadoMora: resultado.totales.mora,
        aplicadoInteres: resultado.totales.interes,
        aplicadoCargos: resultado.totales.cargos,
        aplicadoCapital: resultado.totales.capital,
        excedente: resultado.excedente,
        descuentoMoraPct,
        ahorroMora: resultado.ahorroMora,
        saldoAnterior,
        nuevoSaldo: saldoCapital,
        cuotasAfectadas: resultado.aplicaciones.map((a) => ({
          nro: a.nro,
          mora: a.aplicadoMora,
          interes: a.aplicadoInteres,
          cargos: a.aplicadoCargos,
          capital: a.aplicadoCapital,
          dias_atraso: a.diasAtraso,
        })),
      },
    },
    201
  );
});

/** Máximo con 0 (evita negativos por redondeo). */
function noNeg(x: number): number {
  return x > 0 ? x : 0;
}

/**
 * Concilia automáticamente las promesas de pago pendientes de un crédito.
 * Si el monto cobrado cubre la promesa, la marca como "cumplida".
 * Se llama como fire-and-forget para no bloquear la respuesta del cobro.
 */
async function conciliarPromesas(creditoId: string, tenantId: string, montoPagado: number) {
  const promesasPendientes = await prisma.acciones_cobranza.findMany({
    where: {
      tenant_id: tenantId,
      credito_id: creditoId,
      resultado: "promesa_pago",
      promesa_estado: "pendiente",
    },
  });

  for (const promesa of promesasPendientes) {
    const montoCumple = !promesa.promesa_monto || montoPagado >= promesa.promesa_monto;
    if (montoCumple) {
      await prisma.acciones_cobranza.update({
        where: { id: promesa.id },
        data: { promesa_estado: "cumplida" },
      });
    }
  }
}
