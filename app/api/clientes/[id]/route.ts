import { requireAuth, requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import { normalizarCuit, validarDuplicadoCliente } from "@/lib/clientes-validacion";
import { calcularScore, diasMoraActual, cuotaMensualFrancesa, tasaPeriodicaSegunConvencion, normalizarFrecuencia, interesMora, diasAtraso, round2, estadoCoherente, esCreditoVivo, moraDelCredito, moraDesdeCronograma, moraPendienteTotal } from "@/lib/domain";
import { getConfiguracion, getRiesgoConfig } from "@/lib/config";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/clientes/[id]
 * Retorna un cliente específico.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role } = await requireAuth(req);
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({
    where: {
      ...withTenant(tenantId),
      id,
    },
    include: {
      creditos: {
        orderBy: { created_at: "desc" },
        include: {
          pagos: { orderBy: { fecha: "desc" } },
          cuotas: { orderBy: { nro: "asc" } },
        },
      },
      solicitudes: {
        orderBy: { created_at: "desc" },
      },
    },
  });

  if (!cliente) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  // ── Estado de cuenta consolidado (calculado por el motor de dominio) ──
  // Mismo criterio que /api/creditos y /api/reportes: cuota por frecuencia,
  // interés moratorio = cuota × tasa diaria × días, solo créditos activos en mora.
  const config = await getConfiguracion(tenantId);

  const creditosConFinanzas = cliente.creditos.map((c) => {
    // Estado reconciliado: nunca mostrar un terminal SALDADO (pagado/cancelado)
    // si el ledger todavía tiene deuda. Defensa ante datos legacy inconsistentes.
    const estadoReal = estadoCoherente(c.estado, c.saldo_pendiente, c.cuotas);
    /**
     * 🔴 MORA EN VIVO, NO EL CACHÉ.
     *
     * `creditos.dias_mora` solo se escribe al cobrar, anular, refinanciar o reconciliar:
     * **nada lo avanza día a día**. La ficha era el último lugar de la API que seguía
     * leyéndolo, y por eso mostraba al día a un cliente con 41 días de atraso — con
     * `interes_mora` en $0, porque el interés colgaba del mismo cero. La lista de créditos,
     * el dashboard y cobranzas ya calculaban en vivo: la ficha del cliente los contradecía.
     */
    const diasMora = diasMoraActual(c.proximo_pago, hoyComercial());
    // VIVO, no "activo": tras cobrarle a un moroso el crédito queda en `vencido`, y ahí
    // la ficha dejaba de mostrarle el interés de mora que igual se le está cobrando.
    const enMora = diasMora > 0 && esCreditoVivo(estadoReal);
    let cuota = 0;
    let interes_mora = 0;
    if (c.monto_original > 0 && c.plazo_meses >= 1) {
      const frec = normalizarFrecuencia(c.frecuencia);
      const tasaPeriodica = tasaPeriodicaSegunConvencion(c.tasa, config.convencionTasa, frec);
      cuota = cuotaMensualFrancesa(c.monto_original, tasaPeriodica, c.plazo_meses);
      // La mora del CRÉDITO, no la de la config de hoy (ver moraDelCredito).
      const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
      if (mc.moraActiva && enMora) {
        // Cuota por cuota, igual que al cobrar (ver moraPendienteTotal).
        //
        // 🔴 `hoy` y `diasGracia` NO son opcionales acá aunque la firma los deje pasar.
        // Faltaban los dos y la ficha mostraba más mora de la que cobra la caja:
        //   · sin `hoy` se usa el ahora en UTC, que después de las 21:00 de Argentina ya
        //     está en el día siguiente → un día de más POR CUOTA;
        //   · sin `diasGracia` la tolerancia del crédito no se descuenta → tantos días de
        //     más como días de gracia tenga configurados la financiera.
        // La lista de créditos siempre pasó los dos; por eso las dos pantallas discrepaban.
        const graciaCred = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
        interes_mora = moraPendienteTotal(
          c.cuotas.map((q) => ({ fechaVencimiento: q.fecha_vencimiento, cuotaTotal: q.cuota_total, pagadoMora: q.pagado_mora })),
          { tasaDiaria: mc.tasaMoraDiaria, diasGracia: graciaCred, hoy: hoyComercial() },
        );
      }
    }
    const total_cobrado = c.pagos.filter((p) => !p.anulado).reduce((s, p) => s + p.monto, 0);

    // Cronograma persistido: estado AUTORITATIVO (escrito por el motor cuota-dirigido,
    // Fase 6B); `vencida` se recalcula dinámicamente (depende de hoy).
    // Día comercial argentino: con el ahora en UTC, entre las 21:00 y la medianoche de
    // Argentina una cuota que vence hoy ya se mostraba como vencida.
    const hoy = hoyComercial();
    const estadosCuota = c.cuotas.map((q) => {
      const capitalSaldado = q.pagado_capital >= round2(q.capital);
      if (capitalSaldado) return "pagada";
      if (diasAtraso(q.fecha_vencimiento, hoy) > 0) return "vencida";
      if (q.pagado_capital > 0 || q.pagado_interes > 0 || q.pagado_mora > 0 || q.pagado_cargos > 0) return "parcial";
      return "pendiente";
    });
    const proximaIdx = estadosCuota.findIndex((e) => e !== "pagada");
    const cuotas_resumen = {
      total: c.cuotas.length,
      pagadas: estadosCuota.filter((e) => e === "pagada").length,
      pendientes: estadosCuota.filter((e) => e === "pendiente").length,
      parciales: estadosCuota.filter((e) => e === "parcial").length,
      vencidas: estadosCuota.filter((e) => e === "vencida").length,
      proxima_nro: proximaIdx >= 0 ? c.cuotas[proximaIdx].nro : null,
      proxima_vencimiento: proximaIdx >= 0 ? c.cuotas[proximaIdx].fecha_vencimiento : null,
    };

    // No exponemos las filas de cuotas completas en la ficha (las trae /cuotas),
    // solo el resumen; quitamos `cuotas` del payload del crédito.
    const { cuotas: _omit, ...rest } = c;
    void _omit;
    return { ...rest, estado: estadoReal, dias_mora: diasMora, cuota, interes_mora, total_cobrado, cuotas_resumen };
  });

  const activos = creditosConFinanzas.filter((c) => esCreditoVivo(c.estado));
  const enMora = activos.filter((c) => c.dias_mora > 0);

  const estado_cuenta = {
    creditos_total: creditosConFinanzas.length,
    creditos_activos: activos.length,
    deuda_total: round2(activos.reduce((s, c) => s + c.saldo_pendiente, 0)),
    total_cobrado: round2(creditosConFinanzas.reduce((s, c) => s + c.total_cobrado, 0)),
    en_mora: enMora.length > 0,
    creditos_en_mora: enMora.length,
    dias_mora_max: enMora.reduce((m, c) => Math.max(m, c.dias_mora), 0),
    interes_mora_total: round2(enMora.reduce((s, c) => s + c.interes_mora, 0)),
    proximo_pago: activos
      .map((c) => c.proximo_pago)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    cuota_total_activos: round2(activos.reduce((s, c) => s + c.cuota, 0)),
  };

  // Control de integridad del sueldo (rol-aware): la UI muestra el contador y bloquea el
  // campo a los vendedores que agotaron sus ediciones (el backend igual lo hace cumplir).
  const { politica } = await getRiesgoConfig(tenantId);
  const maxEd = politica.maxEdicionesSueldoVendedor;
  const esAdmin = role === "admin";
  const sueldo_control = {
    ediciones: cliente.ingreso_ediciones,
    max: maxEd,
    esAdmin,
    puedeEditar: esAdmin || maxEd === 0 || cliente.ingreso_ediciones < maxEd,
  };

  /**
   * CALIFICACIÓN CREDITICIA DEL CLIENTE.
   *
   * 🔴 El score existía y se veía SOLO en el listado: entrabas a la ficha y el dato
   * desaparecía justo en la pantalla donde se lo mira en serio. Y lo que nunca se vio en
   * ningún lado es el DETALLE — de dónde salió cada punto que perdió—, que `calcularScore`
   * viene devolviendo desde siempre.
   *
   * Se arma con los mismos insumos que `GET /api/clientes` (misma función del dominio, mismo
   * criterio de "cuota vencida"): días de mora máximos de sus créditos vivos, cuotas ya
   * vencidas y cuántas de ésas cumplió.
   */
  const hoyMs = hoyComercial().getTime();
  const cuotasDeSusCreditos = await prisma.cuotas.findMany({
    where: { ...withTenant(tenantId), credito_id: { in: creditosConFinanzas.map((c) => c.id) } },
    select: { fecha_vencimiento: true, estado: true },
  });
  let cuotasVencidas = 0;
  let cuotasCumplidas = 0;
  for (const q of cuotasDeSusCreditos) {
    if (q.fecha_vencimiento.getTime() < hoyMs) {
      cuotasVencidas += 1;
      if (q.estado === "pagada") cuotasCumplidas += 1;
    }
  }
  const score = calcularScore({
    // Solo los créditos VIVOS pesan en la mora actual: uno pagado hace un año no lo
    // deja moroso hoy. El historial de incumplimiento entra por cuotasVencidas.
    maxDiasMora: activos.reduce((m, c) => Math.max(m, c.dias_mora), 0),
    cuotasVencidas,
    cuotasCumplidas,
    tieneCreditos: creditosConFinanzas.length > 0,
  });

  return successResponse({ ...cliente, creditos: creditosConFinanzas, estado_cuenta, sueldo_control, score, puede_anular_pago: esAdmin });
});

/**
 * PATCH /api/clientes/[id]
 * Actualiza un cliente.
 * Body (todos opcionales):
 * {
 *   "nombre": "string",
 *   "documento": "string",
 *   "email": "string",
 *   "telefono": "string",
 *   "direccion": "string",
 *   "estado": "activo|inactivo",
 *   "tipo_credito": "personal|empresarial|otro"
 * }
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId, role } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  // Verificar que el cliente existe y pertenece al usuario
  const existing = await prisma.clientes.findFirst({
    where: {
      ...withTenant(tenantId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar email si se proporciona
  if (body.email && !isValidEmail(body.email)) {
    return errorResponse("Email inválido", "INVALID_INPUT", 400);
  }

  // Preparar datos para actualizar (no actualizar tenant_id)
  const updateData: Record<string, any> = {};
  const stringFields = [
    "nombre",
    "apellido",
    "documento",
    "email",
    "telefono",
    "direccion",
    "zona",
    "estado",
    "tipo_credito",
    "cuit_cuil",
    "estado_civil",
    "nacionalidad",
    "provincia",
    "localidad",
    "codigo_postal",
    "tipo_domicilio",
    "piso",
    "depto",
    "situacion_laboral",
    "ocupacion",
    "empleador",
    "telefono_laboral",
    "direccion_laboral",
  ];

  stringFields.forEach((field) => {
    if (field in body) {
      const value = body[field];
      updateData[field] = typeof value === "string" ? value.trim() || null : value;
    }
  });

  // Campos tipados (fecha y numéricos)
  if ("fecha_nacimiento" in body) {
    updateData.fecha_nacimiento = body.fecha_nacimiento ? new Date(body.fecha_nacimiento) : null;
  }
  if ("antiguedad_laboral_meses" in body) {
    updateData.antiguedad_laboral_meses = numOrNull(body.antiguedad_laboral_meses, true);
  }
  if ("ingreso_mensual" in body) {
    updateData.ingreso_mensual = numOrNull(body.ingreso_mensual);
  }
  if ("otros_ingresos" in body) {
    updateData.otros_ingresos = numOrNull(body.otros_ingresos);
  }
  if ("consentimiento_bureau" in body) {
    updateData.consentimiento_bureau = body.consentimiento_bureau === true;
  }
  // Historia clínica del cliente migrado: SOLO un admin puede editarla (referencia, no toca caja).
  if ("historial_migrado" in body && role === "admin") {
    const h = body.historial_migrado;
    updateData.historial_migrado = h && typeof h === "object" ? h : null;
  }

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No hay campos para actualizar", "INVALID_INPUT", 400);
  }

  // ── Control de integridad del sueldo (anti-fraude) ──
  // El sueldo es la variable central del motor financiero. Un vendedor puede editarlo un número
  // limitado de veces (política); superado el tope, se bloquea hasta que un admin resetee. Un
  // salto grande exige motivo. Todo cambio de sueldo queda auditado (viejo→nuevo, quién).
  let sueldoLog: { anterior: number | null; nuevo: number | null; motivo: string | null } | null = null;
  // Tope de ediciones del sueldo que hay que hacer cumplir de forma ATÓMICA en el update
  // (null = no aplica: es admin, o el PATCH no toca el sueldo).
  let topeSueldoVendedor: number | null = null;
  if ("ingreso_mensual" in updateData) {
    const nuevo = updateData.ingreso_mensual as number | null;
    const anterior = existing.ingreso_mensual;
    if (nuevo !== anterior) {
      const { politica } = await getRiesgoConfig(tenantId);
      const motivo = typeof body.motivo_sueldo === "string" ? body.motivo_sueldo.trim() : "";

      // Alerta por salto grande → exige un motivo (queda auditado).
      if (
        anterior != null && anterior > 0 && nuevo != null &&
        politica.alertaSaltoSueldoPct > 0 &&
        nuevo > anterior * (1 + politica.alertaSaltoSueldoPct / 100) &&
        !motivo
      ) {
        return errorResponse(
          `El nuevo sueldo supera en más de ${politica.alertaSaltoSueldoPct}% al anterior. Ingresá un motivo del cambio.`,
          "MOTIVO_SUELDO_REQUERIDO", 400,
        );
      }

      // Límite de ediciones para VENDEDORES (el admin no tiene tope).
      if (role === "vendedor" && politica.maxEdicionesSueldoVendedor > 0) {
        if (existing.ingreso_ediciones >= politica.maxEdicionesSueldoVendedor) {
          return errorResponse(
            `Alcanzaste el límite de ${politica.maxEdicionesSueldoVendedor} ediciones del sueldo de este cliente. Pedí a un administrador que resetee el contador.`,
            "SUELDO_BLOQUEADO", 403,
          );
        }
        // El chequeo de arriba usa un contador leído fuera de toda transacción y escribía un
        // valor absoluto (`+ 1`), así que cinco PATCH en paralelo leían el mismo número, los
        // cinco pasaban y los cinco escribían el mismo incremento: el tope se saltaba a
        // pedidos concurrentes. Ahora el límite viaja en el `where` del update y el contador
        // sube con `increment`, que sí es atómico; si otra request se adelantó, afecta 0
        // filas y se rechaza igual que si el tope ya estuviera agotado.
        topeSueldoVendedor = politica.maxEdicionesSueldoVendedor;
      }
      sueldoLog = { anterior, nuevo, motivo: motivo || null };
    }
  }

  // Normalizar y validar unicidad (DNI prioritario; CUIT diferencia DNI repetidos).
  if ("cuit_cuil" in updateData) updateData.cuit_cuil = normalizarCuit(updateData.cuit_cuil);
  const docFinal = ("documento" in updateData ? updateData.documento : existing.documento) as string | null;
  const cuitFinal = ("cuit_cuil" in updateData ? updateData.cuit_cuil : existing.cuit_cuil) as string | null;
  const dupError = await validarDuplicadoCliente(tenantId, docFinal, cuitFinal, id);
  if (dupError) return dupError;

  let updated;
  if (topeSueldoVendedor !== null) {
    const r = await prisma.clientes.updateMany({
      where: { ...withTenant(tenantId), id, ingreso_ediciones: { lt: topeSueldoVendedor } },
      data: { ...updateData, ingreso_ediciones: { increment: 1 } },
    });
    if (r.count === 0) {
      return errorResponse(
        `Alcanzaste el límite de ${topeSueldoVendedor} ediciones del sueldo de este cliente. Pedí a un administrador que resetee el contador.`,
        "SUELDO_BLOQUEADO", 403,
      );
    }
    updated = await prisma.clientes.findFirstOrThrow({ where: { ...withTenant(tenantId), id } });
  } else {
    updated = await prisma.clientes.update({ where: { id }, data: updateData });
  }

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Cliente actualizado: ${nombreCompleto(updated)}`,
  });

  // Traza específica y forense del cambio de sueldo (viejo → nuevo, motivo, contador).
  if (sueldoLog) {
    await registrarAuditoria({
      tenantId,
      entidad: "clientes",
      entidadId: id,
      accion: "actualizar",
      descripcion: `Sueldo de ${nombreCompleto(updated)}: $${(sueldoLog.anterior ?? 0).toLocaleString("es-AR")} → $${(sueldoLog.nuevo ?? 0).toLocaleString("es-AR")}${sueldoLog.motivo ? ` — ${sueldoLog.motivo}` : ""}`,
      meta: {
        ingreso_anterior: sueldoLog.anterior,
        ingreso_nuevo: sueldoLog.nuevo,
        motivo: sueldoLog.motivo,
        rol: role,
        ediciones: updated.ingreso_ediciones,
      },
    });
  }

  return successResponse(updated);
});

/**
 * DELETE /api/clientes/[id]
 * Elimina un cliente (soft delete: marcar como inactivo).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  // Verificar que pertenece al usuario
  const existing = await prisma.clientes.findFirst({
    where: {
      ...withTenant(tenantId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  // Guard: no inactivar un cliente que todavía tiene créditos vivos (activo/vencido).
  // Quedarían créditos operativos colgando de un cliente "inactivo" (incoherente y confuso
  // en reportes). Mismo patrón que el guard de productos con créditos.
  const creditosVivos = await prisma.creditos.count({
    where: { ...withTenant(tenantId), cliente_id: id, estado: { in: ["activo", "vencido"] } },
  });
  if (creditosVivos > 0) {
    return errorResponse(
      `El cliente tiene ${creditosVivos} crédito(s) activo(s). Resolvelos (saldar, anular o refinanciar) antes de inactivarlo.`,
      "CONFLICT",
      409,
    );
  }

  // Soft delete: marcar como inactivo en lugar de borrar
  await prisma.clientes.update({
    where: { id },
    data: { estado: "inactivo" },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Cliente dado de baja: ${nombreCompleto(existing)}`,
  });

  // 200 con cuerpo (no 204: un Response 204 con body lanza TypeError).
  return successResponse({ deleted: true });
});

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/** Normaliza un valor numérico opcional del body (string o number) a número o null. */
function numOrNull(value: unknown, integer = false): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(n)) return null;
  return integer ? Math.trunc(n) : n;
}
