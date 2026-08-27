import { requireAuth, requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { registrarAuditoria } from "@/lib/audit";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import { normalizarCuit, validarDuplicadoCliente } from "@/lib/clientes-validacion";
import { calcularScore, diasMoraActual, cuotaMensualFrancesa, tasaPeriodicaSegunConvencion, normalizarFrecuencia, interesMora, diasAtraso, round2, estadoCoherente, esCreditoVivo, moraDelCredito, moraDesdeCronograma, moraPendienteTotal, ESTADOS_CLIENTE, ESTADO_CLIENTE_LABEL, esEstadoClienteValido, normalizarEstadoCliente, type EstadoCliente } from "@/lib/domain";
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
  const { tenantId, role, vendedorId } = await requireAuth(req);
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
          { tasaDiaria: mc.tasaMoraDiaria, diasGracia: graciaCred, hoy: hoyComercial(), topePct: mc.topeMoraPct },
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

  /**
   * 🔴 UN VENDEDOR NO LEE LA CARTERA DE SUS COMPAÑEROS.
   *
   * `scopeCreditosVendedor` mantiene los créditos ajenos fuera de su lista, de la agenda, de
   * las campañas, del cobro y de la gestión — pero la ficha del cliente los mostraba enteros:
   * saldo, plan de cuotas y cada pago. El scoping era un filtro de bandeja de trabajo con una
   * puerta de atrás, no una barrera. Acá se cierra: **el DETALLE se acota a los suyos.**
   *
   * 🔴 Y los AGREGADOS no: `estado_cuenta` y `score` siguen saliendo de TODOS los créditos.
   * Acotarlos sería cambiar una fuga por algo peor —un vendedor prestándole a ciegas a
   * alguien que ya debe—: le mostraría deuda $0 y score limpio a un cliente en mora con otro
   * agente, y después el motor de riesgo le rechazaría el crédito sin que nada en pantalla lo
   * explique. El motor ya evalúa sobre todos los créditos del cliente (`lib/riesgo-server`),
   * así que ocultarle el número no protege la decisión: solo lo deja sin entenderla.
   *
   * Entre los dos va `otros_agentes`: cuánta exposición hay fuera de su cartera, sin decir de
   * qué crédito ni con quién. Es lo que hace que el total y la lista puedan no coincidir sin
   * que parezca un error.
   */
  const acotarAlVendedor = role === "vendedor";
  const propios = acotarAlVendedor
    ? creditosConFinanzas.filter((c) => c.vendedor_id === vendedorId)
    : creditosConFinanzas;
  const ajenos = acotarAlVendedor
    ? creditosConFinanzas.filter((c) => c.vendedor_id !== vendedorId)
    : [];
  const ajenosVivos = ajenos.filter((c) => esCreditoVivo(c.estado));
  const otros_agentes = ajenos.length > 0
    ? {
        creditos: ajenos.length,
        activos: ajenosVivos.length,
        deuda: round2(ajenosVivos.reduce((s, c) => s + c.saldo_pendiente, 0)),
        en_mora: ajenosVivos.filter((c) => c.dias_mora > 0).length,
        dias_mora_max: ajenosVivos.reduce((m, c) => Math.max(m, c.dias_mora), 0),
      }
    : null;

  /**
   * Si esta ficha se puede EDITAR o dar de baja (misma regla que `vendedorPuedeEditar` del
   * PATCH, resuelta con los créditos que ya están en memoria — sin otra consulta). Es para
   * que la UI no ofrezca un botón que el servidor va a rechazar; la barrera es el PATCH.
   */
  const puede_editar =
    role !== "vendedor" || creditosConFinanzas.length === 0 || propios.length > 0;

  // REF-XXXXXX: los créditos de la ficha se nombran por el que reemplazan si son refis.
  const creditosConOrigen = await conNumeroDeOrigen(tenantId, propios);

  return successResponse({ ...cliente, creditos: creditosConOrigen, estado_cuenta, otros_agentes, sueldo_control, score, puede_anular_pago: esAdmin, puede_editar });
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
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
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

  if (role === "vendedor" && !(await vendedorPuedeEditar(tenantId, id, vendedorId))) {
    return errorResponse(SIN_PERMISO_CLIENTE, "FORBIDDEN", 403);
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
    // 🔴 `estado` NO va acá. Estaba en la lista libre de strings, así que un vendedor podía
    // mandar cualquier valor —incluido "fallecido"— con un PATCH común y frenar la cobranza
    // de una cartera entera sin dejar motivo. Se maneja aparte, abajo, y solo lo mueve un admin.
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

  /**
   * ── ESTADO DEL CLIENTE (activo / fallecido) ──
   *
   * Solo un ADMIN. Marcar a alguien como fallecido frena los punitorios de toda su deuda y
   * bloquea el contacto: es una decisión de la financiera sobre plata, del mismo orden que
   * conciliar una caja, y por eso no la toma quien gestiona todos los días.
   *
   * El acta de defunción se pide y se archiva EN PAPEL (decisión del usuario), así que acá
   * el respaldo es el MOTIVO escrito más la traza de auditoría: quién lo marcó y cuándo.
   * Sin motivo no se marca — si no, quedarían clientes frenados sin explicación.
   *
   * Es REVERSIBLE (volver a "activo" limpia motivo y fecha) porque el error existe: alguien
   * homónimo, un dato mal informado. Volver atrás también queda auditado.
   */
  let estadoLog: { anterior: string; nuevo: string; motivo: string | null } | null = null;
  if ("estado" in body) {
    const nuevo = normalizarEstadoCliente(body.estado);
    if (!esEstadoClienteValido(body.estado)) {
      return errorResponse(`Estado inválido. Valores posibles: ${ESTADOS_CLIENTE.join(", ")}`, "INVALID_INPUT", 400);
    }
    const anterior = normalizarEstadoCliente(existing.estado);
    if (nuevo === "inactivo") {
      // Dar de baja tiene su propio camino (DELETE), que rechaza si el cliente todavía tiene
      // créditos vivos. Permitirlo por acá saltearía ese control.
      return errorResponse("Para dar de baja un cliente usá Eliminar, que valida que no tenga créditos activos.", "USAR_ELIMINAR", 400);
    }
    if (nuevo !== anterior) {
      if (role !== "admin") {
        return errorResponse(
          "Solo un administrador puede cambiar el estado de un cliente.",
          "SOLO_ADMIN",
          403,
        );
      }
      const motivo = typeof body.estado_motivo === "string" ? body.estado_motivo.trim() : "";
      if (nuevo === "fallecido") {
        if (!motivo) {
          return errorResponse(
            "Indicá el motivo. El acta de defunción se archiva en papel; el sistema necesita dejar asentado quién informó el fallecimiento y cómo.",
            "MOTIVO_REQUERIDO",
            400,
          );
        }
        // La fecha del deceso es la que frena los punitorios. Sin dato, se usa hoy: es lo
        // más conservador para el cliente que se pueda justificar (no inventa un pasado que
        // condonaría mora que sí corrió).
        const f = body.estado_fecha ? new Date(body.estado_fecha) : hoyComercial();
        if (Number.isNaN(f.getTime())) {
          return errorResponse("La fecha del fallecimiento no es válida", "INVALID_INPUT", 400);
        }
        if (f.getTime() > hoyComercial().getTime()) {
          return errorResponse("La fecha del fallecimiento no puede ser futura", "INVALID_INPUT", 400);
        }
        updateData.estado = "fallecido";
        updateData.estado_motivo = motivo;
        updateData.estado_fecha = f;
      } else {
        // Volver a activo: se limpia todo, para que no quede una fecha vieja congelando mora.
        updateData.estado = nuevo;
        updateData.estado_motivo = motivo || null;
        updateData.estado_fecha = null;
      }
      estadoLog = { anterior, nuevo, motivo: motivo || null };
    }
  }

  /**
   * ── NO CONTACTAR ──
   *
   * 🔴 ASIMÉTRICO A PROPÓSITO: cualquiera puede PONERLO, solo un admin puede SACARLO.
   *
   * Quien atiende el teléfono es el que escucha "no me llamen más", y tiene que poder
   * registrarlo en el momento — si hay que esperar a un admin, el pedido se pierde y al
   * cliente lo vuelven a llamar. Poner el bloqueo no puede hacer daño: solo protege.
   *
   * Sacarlo sí puede: es habilitar de nuevo el reclamo sobre alguien que pidió lo contrario.
   * Un vendedor con la meta apretada tendría el incentivo exacto para destildarlo. Por eso
   * levantar la protección es decisión de un admin y queda auditado.
   */
  let contactoLog: { activado: boolean; motivo: string | null } | null = null;
  if ("no_contactar" in body) {
    const pedido = body.no_contactar === true;
    const actual = existing.no_contactar === true;
    if (pedido !== actual) {
      const motivo = typeof body.no_contactar_motivo === "string" ? body.no_contactar_motivo.trim() : "";
      if (pedido) {
        if (!motivo) {
          return errorResponse(
            "Indicá qué pidió el cliente (por escrito, por teléfono, solo al celular…). Sin eso no queda constancia de por qué dejamos de contactarlo.",
            "MOTIVO_REQUERIDO",
            400,
          );
        }
        updateData.no_contactar = true;
        updateData.no_contactar_motivo = motivo;
        updateData.no_contactar_desde = new Date();
      } else {
        if (role !== "admin") {
          return errorResponse(
            "Solo un administrador puede volver a habilitar el contacto de un cliente que pidió no ser contactado.",
            "SOLO_ADMIN",
            403,
          );
        }
        updateData.no_contactar = false;
        updateData.no_contactar_motivo = motivo || null;
        updateData.no_contactar_desde = null;
      }
      contactoLog = { activado: pedido, motivo: motivo || null };
    }
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

  // Cambio de estado: es lo que frena punitorios y bloquea el contacto, así que tiene su
  // propia traza con quién lo hizo, desde qué estado y con qué explicación.
  if (estadoLog) {
    await registrarAuditoria({
      tenantId,
      entidad: "clientes",
      entidadId: id,
      accion: "actualizar",
      descripcion:
        `${nombreCompleto(updated)}: ${ESTADO_CLIENTE_LABEL[estadoLog.anterior as EstadoCliente] ?? estadoLog.anterior}`
        + ` → ${ESTADO_CLIENTE_LABEL[estadoLog.nuevo as EstadoCliente] ?? estadoLog.nuevo}`
        + (estadoLog.motivo ? ` — ${estadoLog.motivo}` : ""),
      meta: {
        estado_anterior: estadoLog.anterior,
        estado_nuevo: estadoLog.nuevo,
        motivo: estadoLog.motivo,
        fecha_fallecimiento: updated.estado_fecha,
        rol: role,
      },
    });
  }

  // Activar o levantar el "no contactar" queda registrado: es un pedido del titular y la
  // financiera tiene que poder mostrar cuándo lo recibió y quién lo habilitó de nuevo.
  if (contactoLog) {
    await registrarAuditoria({
      tenantId,
      entidad: "clientes",
      entidadId: id,
      accion: "actualizar",
      descripcion: contactoLog.activado
        ? `${nombreCompleto(updated)}: pidió NO ser contactado${contactoLog.motivo ? ` — ${contactoLog.motivo}` : ""}`
        : `${nombreCompleto(updated)}: se rehabilitó el contacto${contactoLog.motivo ? ` — ${contactoLog.motivo}` : ""}`,
      meta: { no_contactar: contactoLog.activado, motivo: contactoLog.motivo, rol: role },
    });
  }

  return successResponse(updated);
});

/**
 * ¿Este vendedor puede TOCAR la ficha de este cliente?
 *
 * 🔴 La regla: tiene que tener al menos un crédito con él. Un cliente no es de nadie —
 * `clientes` no tiene `vendedor_id`, y cualquier vendedor lo busca y le presta, que es su
 * trabajo—, pero MODIFICARLO es otra cosa: sin este corte, un vendedor podía cambiarle el
 * teléfono a un cliente que gestiona un compañero, que es justo por donde se lo reclama.
 *
 * 🔴 La excepción que hace que la regla sirva: un cliente SIN NINGÚN crédito es de cualquiera.
 * Si no, el alta se rompería sola — un vendedor da de alta al cliente, ve un error de tipeo y
 * ya no puede corregirlo, porque el crédito recién existe un paso después. No es un agujero:
 * un cliente sin créditos no es la cartera de nadie.
 *
 * El admin no entra acá: ve y edita todo el tenant.
 */
async function vendedorPuedeEditar(
  tenantId: string,
  clienteId: string,
  vendedorId: string | null | undefined,
): Promise<boolean> {
  const conCreditos = await prisma.creditos.groupBy({
    by: ["vendedor_id"],
    where: { ...withTenant(tenantId), cliente_id: clienteId },
  });
  if (conCreditos.length === 0) return true; // de nadie todavía
  return !!vendedorId && conCreditos.some((c) => c.vendedor_id === vendedorId);
}

const SIN_PERMISO_CLIENTE =
  "Este cliente lo gestiona otro agente. Solo podés modificar clientes con los que tenés al menos un crédito.";

/**
 * DELETE /api/clientes/[id]
 * Elimina un cliente (soft delete: marcar como inactivo).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
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

  // Dar de baja es la edición más fuerte de todas: rige la misma regla que el PATCH. Dejarlo
  // afuera sería un agujero en la misma pared —el guard de abajo solo frena si tiene créditos
  // VIVOS, así que un cliente con la deuda ya saldada por otro agente quedaba a mano de
  // cualquiera—.
  if (role === "vendedor" && !(await vendedorPuedeEditar(tenantId, id, vendedorId))) {
    return errorResponse(SIN_PERMISO_CLIENTE, "FORBIDDEN", 403);
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
