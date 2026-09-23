import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getCobranzaConfig, getComunicacionConfig, getConfiguracion } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { registrarAuditoria } from "@/lib/audit";
import {
  linkWhatsapp, diasMoraActual, esCreditoVivo, round2, renderPlantillaContacto, type DatosPlantillaContacto,
  calcularDeudaConsolidada, calcularDeudaVencida, diasAtraso, moraDelCredito, moraDesdeCronograma, type CuotaParaImputar,
  plantillaDe, cuentaComoGestion, MOTIVO_LABEL, tipoGestionDeCanal, resolverPlantillasContacto, type MotivoContacto,
  deudaEnRevision, contactoBloqueado, resolverPlantillasMeta, renderPlantillaMeta,
  avisoCreditosARefinanciar, PLANTILLA_SOLO_REFINANCIAR, PLANTILLA_ACUERDO_AL_DIA, acuerdoCubreElAtraso,
  cargosDeCuota, baseMoraDeCuota } from "@/lib/domain";
import { nombreCompleto, hoyComercial, formatCreditoNumero } from "@/lib/utils";
import { cobroBloqueadoPorCredito } from "@/lib/recupero-server";
import { creditosConAcuerdoVigente, congelamientoPorCredito, situacionAcuerdoPorCredito } from "@/lib/acuerdos";
import { enviarEmailTenant, motivoEmailNoDisponible, type EmailTenantConfig } from "@/lib/mailer-tenant";
import { enviarSmsTenant, motivoSmsNoDisponible, type SmsConfig } from "@/lib/sms";
import { enviarWhatsappApi, whatsappApiDisponible, type WhatsappApiConfig } from "@/lib/whatsapp";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MOTIVOS: MotivoContacto[] = ["mora", "promocion", "informacion"];

/**
 * GET /api/clientes/[id]/contactar
 * Qué se le puede mandar y con qué texto: canales disponibles, datos de contacto del
 * cliente y el mensaje ya armado con SUS números (mora real, deuda, próximo vencimiento).
 *
 * El texto se previsualiza acá y se manda en el POST tal cual: lo que el operador lee en
 * pantalla es exactamente lo que le llega al cliente.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const ctx = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;
  // `?credito_id=` cuando el reclamo es por UN crédito (la fila de Cobranzas); sin él, el
  // mensaje habla de la situación del cliente (el botón «Contactar» de la ficha).
  const r = await cargarContactable(ctx, id, new URL(req.url).searchParams.get("credito_id"));
  if ("error" in r && r.error) return r.error;

  const { cliente, datos, comm, refinanciar, acuerdo } = r as Extract<typeof r, { cliente: object }>;
  // Una config guardada ANTES de que existiera este bloque no trae `contacto`: se resuelve
  // sobre los defaults en vez de romper.
  const cobranzaCfg = await getCobranzaConfig(ctx.tenantId);
  const plantillas = resolverPlantillasContacto(cobranzaCfg.contacto);

  /**
   * Las plantillas que Meta aprobó, ya COMPLETADAS con los datos de este cliente. Se manda
   * el texto final y no el cuerpo crudo porque es lo que la pantalla tiene que mostrar
   * antes de enviar: si el operador ve la variable en crudo, no puede verificar el importe.
   * Solo las activas: una plantilla pausada por Meta no se puede ofrecer.
   */
  const plantillasMeta = resolverPlantillasMeta(cobranzaCfg.plantillas_meta)
    .filter((p) => p.activa)
    .map((p) => ({
      // El MOTIVO viaja: la pantalla solo puede ofrecer las de lo que se está mandando. Una
      // plantilla de mora elegida en un mensaje de promoción le reclamaría una deuda por
      // escrito a alguien a quien se le iba a hacer una oferta.
      id: p.id, motivo: p.motivo, nombre: p.nombre, idioma: p.idioma, categoria: p.categoria,
      texto: renderPlantillaMeta(p, datos),
    }));

  const mensajes = Object.fromEntries(
    MOTIVOS.map((m) => {
      const { texto, asunto } = plantillaDe(plantillas, m);
      return [m, { texto: textoMotivo(m, texto, datos, refinanciar, acuerdo), asunto: render(asunto, datos), label: MOTIVO_LABEL[m] }];
    }),
  );

  return successResponse({
    cliente: { id: cliente.id, nombre: datos.nombre, telefono: cliente.telefono, email: cliente.email },
    datos: {
      deuda: datos.deuda, vencido: datos.vencido, cuotas: datos.cuotas, nroCuota: datos.nroCuota,
      dias: datos.dias, cuota: datos.cuota, vencimiento: datos.vencimiento,
    },
    canales: {
      // WhatsApp siempre se puede: sin API de Meta configurada, sale por wa.me (manual).
      // `automatico` mira si la API PUEDE mandar de verdad, no solo si el switch está
      // prendido: con el switch en sí y sin token, la pantalla decía que salía solo y el
      // operador se quedaba esperando un mensaje que nadie mandaba.
      whatsapp: { disponible: !!cliente.telefono, automatico: whatsappApiDisponible(comm.whatsapp) },
      // "automatico" ahora mira si el canal PUEDE mandar de verdad, no solo si el
      // switch está prendido: la config podía estar activa y sin credenciales completas.
      email: { disponible: !!cliente.email, automatico: !motivoEmailNoDisponible(comm.email) },
      // SMS: sale por SMSChef, siempre automático; sin la config del canal no hay forma manual.
      sms: { disponible: !!cliente.telefono && !motivoSmsNoDisponible(comm.sms), automatico: true, impedimento: motivoSmsNoDisponible(comm.sms) },
    },
    mensajes,
    plantillas_meta: plantillasMeta,
  });
});

/**
 * POST /api/clientes/[id]/contactar
 * Body: { canal: "whatsapp"|"email", motivo: "mora"|"promocion"|"informacion", mensaje?, asunto? }
 *
 * Manda el mensaje y —esto es lo que lo separa de abrir WhatsApp a mano— DEJA RASTRO:
 * auditoría siempre, y una gestión de cobranza cuando el motivo es mora.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const ctx = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  // El body se lee ANTES de cargar: puede traer el crédito del que habla el mensaje.
  const body = await req.json().catch(() => null);
  if (!body) return errorResponse("Body JSON inválido", "INVALID_JSON", 400);

  const r = await cargarContactable(ctx, id, typeof body.credito_id === "string" ? body.credito_id : null);
  if ("error" in r && r.error) return r.error;
  const { cliente, datos, comm, creditoParaGestion, refinanciar, acuerdo } = r as Extract<typeof r, { cliente: object }>;

  const canal: "whatsapp" | "email" | "sms" = body.canal === "email" ? "email" : body.canal === "sms" ? "sms" : "whatsapp";
  const motivo: MotivoContacto = MOTIVOS.includes(body.motivo) ? body.motivo : "informacion";

  const cobranzaCfg = await getCobranzaConfig(ctx.tenantId);
  const plantillas = resolverPlantillasContacto(cobranzaCfg.contacto);
  const base = plantillaDe(plantillas, motivo);

  /**
   * 🔴 UN AVISO DE MORA QUE PIDE $0,00 NO SALE.
   *
   * La plantilla de mora reclama lo vencido; si no hay nada vencido y tampoco hay un plan
   * para reestructurar, el texto quedaría "la cuota —, vencida hace 0 días, abonar $0,00" y
   * eso es lo que le llega al cliente. La pantalla ya no ofrece el motivo en ese caso, pero
   * el corte va en el servidor porque el reclamo también se dispara desde la fila de
   * Cobranzas, que manda "mora" sin preguntar.
   */
  /* `acuerdo` es la excepción: no hay nada vencido PORQUE está cumpliendo un arreglo, y lo
     que se manda no es un reclamo sino el recordatorio de su cuota pactada. */
  if (motivo === "mora" && datos.vencido <= 0 && refinanciar.numeros.length === 0 && !acuerdo) {
    return errorResponse(
      "Este crédito no tiene nada vencido: no hay deuda que reclamar. Si querés escribirle igual, mandá un mensaje informativo.",
      "SIN_DEUDA_VENCIDA",
      409,
    );
  }

  /**
   * 🔴 UNA PLANTILLA DE META NO SE EDITA.
   *
   * Meta aprueba un texto exacto; cambiarle una palabra la invalida y el mensaje deja de
   * entregarse. Por eso, cuando se elige una, el cuerpo lo arma el SERVIDOR con la plantilla
   * guardada y se ignora lo que venga en `mensaje`: si se aceptara el texto del navegador,
   * bastaría con editar el textarea para mandar como "aprobado" algo que Meta nunca vio.
   */
  const plantillaMeta = typeof body.plantilla_meta_id === "string" && body.plantilla_meta_id
    ? resolverPlantillasMeta(cobranzaCfg.plantillas_meta).find((p) => p.id === body.plantilla_meta_id && p.activa) ?? null
    : null;
  if (body.plantilla_meta_id && !plantillaMeta)
    return errorResponse("La plantilla de Meta elegida ya no existe o está desactivada.", "INVALID_REFERENCE", 400);
  /**
   * La plantilla tiene que ser DEL MOTIVO que se está mandando. La pantalla ya filtra, pero
   * el corte real va acá: mandar `aviso_mora_ar` con motivo "promocion" le reclamaría una
   * deuda por escrito a alguien a quien se le estaba por hacer una oferta, y además quedaría
   * registrado como promoción —que no cuenta como gestión— un reclamo que sí lo es.
   */
  /**
   * Una plantilla de Meta es un texto FIJO y aprobado: no se le puede agregar la línea de la
   * refinanciación ni sacarle el importe. Si a este cliente no le queda nada cobrable, ese
   * texto le reclamaría $0,00 por escrito. Se corta acá.
   */
  if (plantillaMeta && plantillaMeta.motivo === "mora" && !refinanciar.hayCobrable) {
    return errorResponse(
      "Este cliente no tiene deuda cobrable: sus créditos ya no se cobran en cuotas y hay que refinanciarlos. Mandale el aviso de mora sin plantilla de Meta, que se adapta solo.",
      "COBRO_REQUIERE_REFINANCIAR",
      409,
    );
  }
  if (plantillaMeta && plantillaMeta.motivo !== motivo)
    return errorResponse(
      `La plantilla "${plantillaMeta.nombre}" es para ${MOTIVO_LABEL[plantillaMeta.motivo].toLowerCase()}, no para ${MOTIVO_LABEL[motivo].toLowerCase()}.`,
      "INVALID_INPUT",
      400,
    );

  // Sin plantilla de Meta, el operador puede editar el texto; si no lo toca, va la del tenant.
  const texto = plantillaMeta
    ? renderPlantillaMeta(plantillaMeta, datos)
    : typeof body.mensaje === "string" && body.mensaje.trim() ? body.mensaje.trim() : textoMotivo(motivo, base.texto, datos, refinanciar, acuerdo);
  const asunto = typeof body.asunto === "string" && body.asunto.trim() ? body.asunto.trim() : render(base.asunto, datos);
  if (!texto) return errorResponse("El mensaje está vacío.", "INVALID_INPUT", 400);

  let enviado: { metodo: "api" | "manual"; link?: string } ;

  if (canal === "whatsapp") {
    if (!cliente.telefono) return errorResponse("El cliente no tiene teléfono cargado.", "SIN_TELEFONO", 409);

    /**
     * 🔴 Con la API de Meta configurada, el mensaje lo manda el SISTEMA.
     *
     * Antes esta rama era siempre manual: el comentario decía "sin API de Meta configurada"
     * pero no había ninguna bifurcación, así que una financiera que pagara la API igual
     * tenía que abrir WhatsApp y apretar enviar cliente por cliente.
     *
     * Y va como plantilla aprobada si se eligió una, con sus parámetros: es la única forma
     * de que Meta lo entregue cuando el cliente no escribió en las últimas 24 h — que es el
     * caso normal de una cobranza.
     */
    const waCfg = comm.whatsapp as WhatsappApiConfig | null;
    if (whatsappApiDisponible(waCfg)) {
      const res = await enviarWhatsappApi(waCfg, {
        telefono: cliente.telefono,
        texto,
        plantilla: plantillaMeta,
        // Los valores de ESTE cliente, por el mismo renderizador que arma el texto que se
        // previsualizó en pantalla: el operador leyó lo que Meta va a componer.
        resolver: (clave) => render(`[${clave}]`, datos),
      });
      if (!res.ok) return errorResponse(res.error ?? "No se pudo enviar el WhatsApp", "ENVIO_FALLIDO", 502);
      enviado = { metodo: "api" };
    } else {
      // Sin API, el envío es MANUAL: se devuelve el link wa.me y lo abre el operador. Se
      // registra igual — el contacto ocurrió, lo haya mandado un bot o una persona, y la
      // ficha tiene que poder contarlo.
      enviado = { metodo: "manual", link: linkWhatsapp(cliente.telefono, texto) };
    }
  } else if (canal === "sms") {
    // Fernando (18/09/2026): al lado del WhatsApp de cada renglón de cobranza, un SMS. Mismo
    // texto, mismo registro; sale por el celular de la financiera (SMSChef), nunca a mano.
    if (!cliente.telefono) return errorResponse("El cliente no tiene teléfono cargado.", "SIN_TELEFONO", 409);
    const impedimento = motivoSmsNoDisponible(comm.sms);
    if (impedimento) return errorResponse(impedimento, "SMS_NO_CONFIGURADO", 409);
    const res = await enviarSmsTenant(comm.sms, { telefono: cliente.telefono, mensaje: texto });
    if (!res.ok) return errorResponse(res.error ?? "No se pudo enviar el SMS", "ENVIO_FALLIDO", 502);
    enviado = { metodo: "api" };
  } else {
    if (!cliente.email) return errorResponse("El cliente no tiene email cargado.", "SIN_EMAIL", 409);
    const impedimento = motivoEmailNoDisponible(comm.email);
    if (impedimento) return errorResponse(impedimento, "EMAIL_NO_CONFIGURADO", 409);
    const res = await enviarEmailTenant(comm.email, {
      to: cliente.email,
      subject: asunto,
      html: cuerpoHtml(texto, datos.financiera),
      marca: datos.financiera,
    });
    if (!res.ok) return errorResponse(res.error ?? "No se pudo enviar el email", "ENVIO_FALLIDO", 502);
    enviado = { metodo: "api" };
  }

  /**
   * 🔴 Gestión de cobranza SOLO si el motivo es mora (ver `cuentaComoGestion`).
   * Un mensaje promocional registrado como gestión engordaría el denominador del embudo de
   * efectividad y bajaría la tasa de conversión sin que nadie hubiera trabajado peor.
   * Y necesita un crédito: `acciones_cobranza.credito_id` es obligatorio.
   */
  let gestionId: string | null = null;
  if (cuentaComoGestion(motivo) && creditoParaGestion) {
    const g = await prisma.acciones_cobranza.create({
      data: {
        ...withTenant(ctx.tenantId),
        credito_id: creditoParaGestion,
        tipo: tipoGestionDeCanal(canal),
        resultado: "contactado",
        nota: `[CONTACTO INDIVIDUAL] ${texto}`.slice(0, 2000),
        // Lo disparó una persona desde la ficha: cuenta para la efectividad de cobranza,
        // a diferencia de los envíos de campaña y las alertas del cron.
        automatico: false,
      },
      select: { id: true },
    });
    gestionId = g.id;
  }

  // La auditoría se escribe SIEMPRE, sea cual sea el motivo: es el registro de que a esta
  // persona se la contactó, quién lo hizo y qué le dijo.
  await registrarAuditoria({
    tenantId: ctx.tenantId,
    entidad: "clientes",
    entidadId: cliente.id,
    accion: "contactar",
    descripcion: `${MOTIVO_LABEL[motivo]} por ${canal === "email" ? "email" : canal === "sms" ? "SMS" : "WhatsApp"} a ${datos.nombre}`,
    // Con qué plantilla se mandó queda registrado: si Meta después observa el número, hay
    // que poder decir qué salió aprobado y qué salió como texto libre.
    meta: {
      canal, motivo, metodo: enviado.metodo, mensaje: texto,
      asunto: canal === "email" ? asunto : null, gestion_id: gestionId,
      plantilla_meta: plantillaMeta ? `${plantillaMeta.nombre} (${plantillaMeta.idioma})` : null,
    },
  });

  return successResponse({ canal, motivo, ...enviado, gestion_id: gestionId, mensaje: texto }, 201);
});

// ─── Carga + permisos ─────────────────────────────────────────────────────────

type Ctx = Awaited<ReturnType<typeof requireRole>>;

/**
 * Trae el cliente con lo necesario para armar el mensaje, y valida que ESTE usuario pueda
 * contactarlo. Un vendedor solo llega a los clientes con crédito propio: sin este chequeo,
 * la ficha sería una vía para escribirle a toda la cartera de la financiera.
 */
async function cargarContactable(ctx: Ctx, id: string, creditoId?: string | null) {
  const cliente = await prisma.clientes.findFirst({
    where: { ...withTenant(ctx.tenantId), id },
    include: {
      creditos: {
        orderBy: { created_at: "desc" },
        select: {
          id: true, numero: true, estado: true, saldo_pendiente: true, proximo_pago: true, vendedor_id: true, fecha_inicio: true,
          cronograma: true, cuotas: { orderBy: { nro: "asc" } },
        },
      },
    },
  });
  if (!cliente) return { error: errorResponse("Cliente no encontrado", "NOT_FOUND", 404) } as const;

  if (ctx.role === "vendedor") {
    const esSuyo = cliente.creditos.some((c) => c.vendedor_id === ctx.vendedorId);
    if (!esSuyo) {
      return { error: errorResponse("Solo podés contactar a tus propios clientes.", "FORBIDDEN", 403) } as const;
    }
  }

  /**
   * 🔴 A un cliente FALLECIDO no se le escribe.
   *
   * El mensaje le llegaría a la familia, con el nombre del muerto y un reclamo de plata. Es
   * la razón por la que existe el estado, así que el corte va en el SERVIDOR y no solo
   * ocultando el botón: la pantalla se puede tener abierta de antes, o el pedido puede venir
   * de otro lado. Es parametrizable — hay financieras que gestionan con los herederos.
   */
  const { fallecidos } = await getCobranzaConfig(ctx.tenantId);
  const corte = contactoBloqueado(cliente, { bloqueaFallecidos: fallecidos.bloquea_contacto });
  if (corte.bloqueado) {
    const quien = `${cliente.nombre} ${cliente.apellido ?? ""}`.trim();
    return {
      error: errorResponse(
        `${quien}: ${corte.motivo}.${cliente.no_contactar && cliente.no_contactar_motivo ? ` (${cliente.no_contactar_motivo})` : ""}`,
        cliente.no_contactar ? "NO_CONTACTAR" : "CLIENTE_FALLECIDO",
        409,
      ),
    } as const;
  }

  const hoy = hoyComercial();
  /**
   * 🔴 EL MENSAJE ES SOBRE UN CRÉDITO, NO SOBRE "EL CLIENTE".
   *
   * Cuando el reclamo sale de una fila de Cobranzas, esa fila ES un crédito. Sin este corte,
   * el mensaje se armaba con TODOS los créditos vivos de la persona y terminaba hablando de
   * otro: a María Elena, reclamándole CRD-000086 (70 días de atraso), le salía "la cuota —
   * vencida hace 0 días, abonar $0,00" porque el elegido terminaba siendo su otro crédito,
   * que estaba al día (20/09/2026).
   */
  const soloEste = creditoId ? cliente.creditos.filter((c) => c.id === creditoId) : null;
  if (creditoId && soloEste!.length === 0) {
    return { error: errorResponse("Ese crédito no es de este cliente", "INVALID_INPUT", 400) } as const;
  }
  const vivos = (soloEste ?? cliente.creditos).filter((c) => esCreditoVivo(c.estado));
  // Mora EN VIVO, no el caché de `creditos.dias_mora`: nada lo avanza día a día, y un aviso
  // de mora que dice "0 días" es peor que no mandarlo.
  const conMora = vivos
    .map((c) => ({ ...c, dias: diasMoraActual(c.proximo_pago, hoy) }))
    .sort((a, b) => b.dias - a.dias);

  /**
   * 🔴 UN CLIENTE PUEDE TENER CRÉDITOS EN ESCALONES DISTINTOS.
   *
   * Uno de veinte días que se cobra normal y otro de ciento veinte cuyo plan ya venció. El
   * aviso de mora reclama SOLO lo cobrable: sumarlos le pediría por escrito una plata que la
   * terminal después le rechaza, que es el mismo error que ya apareció en las campañas y en
   * la planilla de calle, pero de a un cliente por vez.
   *
   * Los otros no se ocultan —el mensaje los nombra al final e invita a reestructurarlos—:
   * callarlos sería peor, el cliente pagaría lo que dice el mensaje y se iría creyendo que
   * quedó al día.
   */
  const acuerdosVigentes = await creditosConAcuerdoVigente(ctx.tenantId);
  const congelan = await congelamientoPorCredito(ctx.tenantId);
  const bloqueadosMap = await cobroBloqueadoPorCredito(
    ctx.tenantId,
    conMora.map((c) => ({ id: c.id, diasMora: c.dias, acuerdoVigente: acuerdosVigentes.has(c.id),
      // Al castigado la escalera ya no le bloquea el cobro (ver `puedeCobrar`).
      incobrable: c.estado === "incobrable" })),
    (await getCobranzaConfig(ctx.tenantId)).recupero,
  );
  /**
   * 🔴 AL QUE ESTÁ CUMPLIENDO SU ACUERDO NO SE LE RECLAMA EL PLAN VIEJO.
   *
   * Fernando (23/09/2026): "en Morosos, si pulso el WhatsApp y el SMS, el mensaje me lleva al
   * reclamo de la cuota del crédito original". Su crédito figura en mora porque el plan
   * original conserva las fechas —eso es un hecho contable, no deuda exigible—, así que el
   * aviso salía "tenés la cuota 1 vencida hace 76 días, abonás $649.656,24" sobre alguien que
   * arregló y cuya primera cuota pactada vence el 07/10.
   *
   * Sale de `cobrables` como sale un bloqueado: no hay nada que reclamarle. Lo que le
   * corresponde es el recordatorio de su cuota PACTADA, que se arma más abajo.
   *
   * Las dos condiciones de siempre: que el acuerdo CUBRA lo que debe y que la pactada esté al
   * día. Si dejó de pagarla, el arreglo se cayó y vuelve a ser un moroso como cualquier otro.
   */
  const situacion = await situacionAcuerdoPorCredito(ctx.tenantId, conMora.map((c) => c.id));
  const cumpliendoAcuerdo = (c: (typeof conMora)[number]) => {
    const a = situacion.get(c.id);
    return !!a && a.al_dia && !!a.proxima && acuerdoCubreElAtraso(a.fecha, c.proximo_pago);
  };
  const cobrables = conMora.filter((c) => !bloqueadosMap.get(c.id) && !cumpliendoAcuerdo(c));
  const aRefinanciar = conMora.filter((c) => bloqueadosMap.get(c.id) && !cumpliendoAcuerdo(c));
  /**
   * La cuota pactada más próxima entre los créditos que están cumpliendo. Es de lo único que
   * se le puede hablar a este cliente: no tiene nada exigible hoy.
   */
  const enAcuerdo = conMora
    .filter(cumpliendoAcuerdo)
    .map((c) => ({ credito: c, pactada: situacion.get(c.id)!.proxima! }))
    .sort((a, b) => a.pactada.vencimiento.getTime() - b.pactada.vencimiento.getTime());
  const avisoAcuerdo = enAcuerdo[0] ?? null;
  const numerosARefinanciar = aRefinanciar.map((c) => formatCreditoNumero(c.numero));

  /**
   * Candidato al crédito del que habla el mensaje. La elección FINAL se hace más abajo, con
   * `vencido` calculado: un crédito "cobrable" puede no tener nada vencido, y entonces el
   * aviso de mora pediría cero pesos.
   */
  const peor = cobrables[0] ?? conMora[0];

  const financiera = await getFinanciera(ctx.tenantId);
  const commRaw = await getComunicacionConfig(ctx.tenantId);
  const comm = {
    whatsapp: (commRaw.whatsappConfig ?? null) as WhatsappApiConfig | null,
    email: (commRaw.emailConfig ?? null) as EmailTenantConfig | null,
    sms: (commRaw.smsConfig ?? null) as SmsConfig | null,
  };

  /**
   * 🔴 LO QUE DEBE, NO EL CAPITAL.
   *
   * `saldo_pendiente` es capital: en CRD-000068 son $350.000,01 cuando el cliente adeuda
   * $392.252,19 (capital + interés pendiente + mora). Mandarle por WhatsApp el número chico
   * es el mismo error que ya se corrigió en el KPI de la ficha del crédito, pero por escrito
   * y en la mano del cliente. Se usa `calcularDeudaConsolidada`, la MISMA función con la que
   * la refinanciación arma la deuda a consolidar.
   */
  const config = await getConfiguracion(ctx.tenantId);

  /**
   * Se calculan LAS DOS cosas, con la misma fórmula de mora que usa el cobro:
   *
   *  - `deudaViva`: todo el crédito si lo cancela hoy (`calcularDeudaConsolidada`).
   *  - `vencido`:   solo lo que YA venció y no pagó (`calcularDeudaVencida`), que es lo que
   *                 un aviso de mora tiene que reclamar.
   *
   * 🔴 Antes solo existía la primera y la plantilla de mora la usaba. A Ana, con 15 días de
   * atraso sobre UNA cuota de $73.441,71, se le reclamaban $221.426,76: el préstamo entero,
   * cuotas futuras incluidas. Además de ser un reclamo improcedente, no coincidía con lo que
   * la ficha muestra ni con lo que la caja iba a cobrar.
   */
  let deudaTotal = 0;
  let venc = { total: 0, cuotas: 0 };
  let nroCuotaVencida: number | null = null;

  for (const c of cobrables) {
    const cuotasDom: CuotaParaImputar[] = c.cuotas.map((q) => ({
      id: q.id, nro: q.nro, fechaVencimiento: q.fecha_vencimiento,
      capital: q.capital, interes: q.interes, cargos: cargosDeCuota(q), capitalizado: q.capitalizado ?? 0,
      baseMora: baseMoraDeCuota(q),
      pagadoCapital: q.pagado_capital, pagadoInteres: q.pagado_interes,
      pagadoMora: q.pagado_mora, pagadoCargos: q.pagado_cargos,
      condonadoMora: q.condonado_mora,
    }));
    const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
    const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
    // Dia comercial argentino: con el ahora en UTC, entre las 21:00 y la medianoche de
    // Argentina se le cobra —y se le INFORMA— un dia de mora de mas.
    /* Con un acuerdo vigente que congela, la mora de lo que entró al trato se detuvo el día
       que se firmó. Sin esto el WhatsApp le pedía más de lo que la caja le iba a cobrar. */
    const opts = {
      moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct, diasGracia: gracia, hoy,
      moraCongeladaAl: congelan.get(c.id) ?? null,
    };

    /**
     * `deudaViva` es "lo que debe si cancela HOY", así que el interés va DEVENGADO: cobrarle
     * el de un período que todavía está corriendo sería cobrarle por tiempo que no usó. Le
     * pasamos la fecha de inicio para que la primera cuota también se pueda prorratear.
     */
    deudaTotal += calcularDeudaConsolidada(cuotasDom, { ...opts, fechaInicio: c.fecha_inicio }).total;

    const dv = calcularDeudaVencida(cuotasDom, opts);
    venc = { total: venc.total + dv.total, cuotas: venc.cuotas + dv.cuotas_vencidas };
    // La cuota que se nombra es la vencida MÁS VIEJA: es la que el cliente tiene que buscar
    // en su plan de pagos para reconocer el reclamo.
    const masVieja = cuotasDom.find((q) => diasAtraso(q.fechaVencimiento, hoy) > 0 && q.pagadoCapital < q.capital);
    if (masVieja && (nroCuotaVencida == null || masVieja.nro < nroCuotaVencida)) nroCuotaVencida = masVieja.nro;
  }

  const deudaViva = round2(deudaTotal);
  const vencido = round2(venc.total);

  /**
   * 🔴 EL CRÉDITO DEL QUE HABLA EL MENSAJE, DECIDIDO CON `vencido` EN LA MANO.
   *
   * "Cobrable" quiere decir que el sistema todavía lo cobra en cuotas, no que haya algo
   * vencido: un cliente con un crédito al día y otro pasado del umbral de refinanciación
   * tenía las dos condiciones a la vez, y el aviso de mora salía reclamando $0,00 sobre "la
   * cuota —, vencida hace 0 días". Si no hay nada vencido que reclamar, el mensaje pasa a
   * hablar del crédito que hay que reestructurar, que es la situación real del cliente.
   */
  const habla = vencido > 0
    ? (cobrables[0] ?? conMora[0])
    : (aRefinanciar[0] ?? avisoAcuerdo?.credito ?? cobrables[0] ?? conMora[0]);
  /** ¿El mensaje de mora se reemplaza por el recordatorio del acuerdo? */
  const soloAcuerdo = vencido <= 0 && aRefinanciar.length === 0 && !!avisoAcuerdo;

  /**
   * El vencimiento sale del MISMO crédito que la cuota. Salía del mínimo entre todos los
   * créditos vivos, así que el mensaje podía decir el importe de uno y la fecha de otro —
   * dos números de dos contratos distintos en la misma oración.
   */
  /**
   * 🔴 "PRÓXIMA CUOTA" ES LA QUE TODAVÍA NO VENCIÓ.
   *
   * Salía de `proximo_pago`, que en un crédito en mora apunta a la cuota vencida más vieja:
   * el mensaje decía "tenés la cuota 1 vencida hace 11 días" y dos renglones después "tu
   * próxima cuota vence el 9/9", que era la misma cuota y una fecha ya pasada. Se toma la
   * primera que aún no cayó; si ya vencieron todas, se nombra la más vieja impaga, que es de
   * lo único que se puede hablar.
   */
  const cuotasDelCredito = habla?.cuotas ?? [];
  const impagas = cuotasDelCredito.filter((q) => q.pagado_capital < q.capital);
  const proximaCuota = impagas.find((q) => q.fecha_vencimiento > hoy) ?? impagas[0] ?? null;
  const proximo = proximaCuota?.fecha_vencimiento ?? null;

  /**
   * 🔴 `cuota` estaba FIJO EN 0.
   *
   * El placeholder `[cuota]` figuraba como disponible, así que una financiera que lo usara
   * le habría escrito a su cliente que su próxima cuota es de $0,00. Peor que no
   * reemplazarlo: un número inventado y con aire de oficial.
   *
   * Es el importe PROGRAMADO de la primera cuota impaga del crédito más atrasado —el mismo
   * del que habla el mensaje—. Se usa el nominal del plan y no lo que habría que cobrar hoy
   * con punitorios: la cuota es un número del contrato, fijo, y el atraso ya viaja aparte en
   * `[deuda]` y `[dias]`.
   */
  return {
    cliente,
    comm,
    // La gestión se cuelga del crédito MÁS ATRASADO de los que se hablan en el mensaje.
    creditoParaGestion: habla?.id ?? vivos[0]?.id ?? null,
    /**
     * Los créditos de este cliente cuyo plan ya venció. Con esto el mensaje puede nombrarlos
     * en vez de sumarlos, y saber si NO quedó nada cobrable (ahí el aviso de mora se
     * reemplaza entero por la invitación a refinanciar).
     */
    /**
     * `hayCobrable` es "hay algo VENCIDO que reclamar", no "hay algún crédito que el sistema
     * todavía cobre". Con la definición vieja, el aviso de mora se mandaba igual aunque no
     * hubiera un peso vencido, y pedía $0,00.
     */
    refinanciar: { numeros: numerosARefinanciar, hayCobrable: vencido > 0 },
    /**
     * El recordatorio del acuerdo reemplaza al aviso de mora cuando no quedó nada exigible:
     * es el mismo trato que `PLANTILLA_SOLO_REFINANCIAR`. Viaja para que el POST no lo corte
     * por "no tiene nada vencido" y para que la vista previa muestre el texto que va a salir.
     */
    acuerdo: soloAcuerdo
      ? { cuotaNro: avisoAcuerdo!.pactada.numero, monto: avisoAcuerdo!.pactada.pendiente, vencimiento: avisoAcuerdo!.pactada.vencimiento }
      : null,
    datos: {
      nombre: cliente.nombre,
      financiera: financiera?.nombre || "tu financiera",
      deuda: deudaViva,
      vencido,
      cuotas: venc.cuotas,
      /* Con el recordatorio del acuerdo, la cuota, el importe y la fecha son los de la
         PACTADA: el cliente tiene que poder cotejarlos contra el papel que firmó. Y `dias` es
         0 — está al día con lo que pactó. */
      nroCuota: soloAcuerdo ? avisoAcuerdo!.pactada.numero : nroCuotaVencida,
      dias: soloAcuerdo ? 0 : (habla?.dias ?? 0),
      cuota: soloAcuerdo ? round2(avisoAcuerdo!.pactada.pendiente) : round2(proximaCuota?.cuota_total ?? 0),
      vencimiento: soloAcuerdo ? avisoAcuerdo!.pactada.vencimiento : proximo,
    },
  } as const;
}

/**
 * Rellena los placeholders. La función vive en el DOMINIO (`renderPlantillaContacto`) porque
 * la comparte con la vista previa de Configuración: si cada lado tuviera la suya, la pantalla
 * mostraría un mensaje y al cliente le llegaría otro.
 *
 * Tenía dos defectos que se arreglaron al centralizarla: `[cuota]` estaba documentado y NUNCA
 * se sustituía (al cliente le llegaba el texto literal), y los importes salían redondeados a
 * pesos enteros, así que el mensaje decía una cifra y la caja cobraba otra.
 */
/**
 * El texto de un motivo, con el corte entre lo cobrable y lo que hay que refinanciar.
 *
 * Vive acá y lo usan el GET (la vista previa) y el POST (el envío) para que el operador mande
 * exactamente lo que leyó. Es el mismo criterio de una sola definición que ya rige para los
 * importes: dos caminos distintos terminan siendo dos mensajes distintos.
 */
function textoMotivo(
  motivo: MotivoContacto,
  base: string,
  d: DatosPlantillaContacto,
  refi: { numeros: string[]; hayCobrable: boolean },
  /** Si el cliente está CUMPLIENDO un acuerdo y no le quedó nada exigible. */
  acuerdo?: { cuotaNro: number; monto: number; vencimiento: Date } | null,
): string {
  if (motivo !== "mora") return render(base, d);
  /* Está cumpliendo su acuerdo: no hay reclamo que hacerle. El aviso de mora se reemplaza
     entero —como con la invitación a refinanciar— por el recordatorio de su cuota pactada,
     cuyos datos ya vienen en `d` (nro_cuota, cuota y vencimiento son los de la pactada). */
  if (acuerdo && !refi.hayCobrable) return render(PLANTILLA_ACUERDO_AL_DIA, d);
  // Nada cobrable: el aviso de mora pediría $0,00. Se reemplaza entero por la invitación.
  if (!refi.hayCobrable && refi.numeros.length > 0) return render(PLANTILLA_SOLO_REFINANCIAR, d);
  // Hay algo que reclamar: se reclama eso, y se nombran aparte los que ya no se cobran.
  return render(base, d) + avisoCreditosARefinanciar(refi.numeros);
}

function render(plantilla: string, d: DatosPlantillaContacto): string {
  return renderPlantillaContacto(plantilla, d);
}

/** Cuerpo del mail: el texto tal cual se leyó en pantalla, firmado por la financiera. */
function cuerpoHtml(texto: string, marca: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <p style="color:#374151;font-size:14px;line-height:1.6;margin:0;white-space:pre-line">${escapar(texto)}</p>
      <p style="color:#6b7280;font-size:12px;margin:24px 0 0;border-top:1px solid #f3f4f6;padding-top:16px">${escapar(marca)}</p>
    </div>
  </div>`;
}

function escapar(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

void nombreCompleto;
