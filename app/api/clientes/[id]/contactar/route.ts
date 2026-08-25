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
} from "@/lib/domain";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import { enviarEmailTenant, motivoEmailNoDisponible, type EmailTenantConfig } from "@/lib/mailer-tenant";
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
  const r = await cargarContactable(ctx, id);
  if ("error" in r && r.error) return r.error;

  const { cliente, datos, comm } = r as Extract<typeof r, { cliente: object }>;
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
      return [m, { texto: render(texto, datos), asunto: render(asunto, datos), label: MOTIVO_LABEL[m] }];
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
      whatsapp: { disponible: !!cliente.telefono, automatico: !!comm.whatsapp?.enabled },
      // "automatico" ahora mira si el canal PUEDE mandar de verdad, no solo si el
      // switch está prendido: la config podía estar activa y sin credenciales completas.
      email: { disponible: !!cliente.email, automatico: !motivoEmailNoDisponible(comm.email) },
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
  const r = await cargarContactable(ctx, id);
  if ("error" in r && r.error) return r.error;
  const { cliente, datos, comm, creditoParaGestion } = r as Extract<typeof r, { cliente: object }>;

  const body = await req.json().catch(() => null);
  if (!body) return errorResponse("Body JSON inválido", "INVALID_JSON", 400);

  const canal = body.canal === "email" ? "email" : "whatsapp";
  const motivo: MotivoContacto = MOTIVOS.includes(body.motivo) ? body.motivo : "informacion";

  const cobranzaCfg = await getCobranzaConfig(ctx.tenantId);
  const plantillas = resolverPlantillasContacto(cobranzaCfg.contacto);
  const base = plantillaDe(plantillas, motivo);

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
  if (plantillaMeta && plantillaMeta.motivo !== motivo)
    return errorResponse(
      `La plantilla "${plantillaMeta.nombre}" es para ${MOTIVO_LABEL[plantillaMeta.motivo].toLowerCase()}, no para ${MOTIVO_LABEL[motivo].toLowerCase()}.`,
      "INVALID_INPUT",
      400,
    );

  // Sin plantilla de Meta, el operador puede editar el texto; si no lo toca, va la del tenant.
  const texto = plantillaMeta
    ? renderPlantillaMeta(plantillaMeta, datos)
    : typeof body.mensaje === "string" && body.mensaje.trim() ? body.mensaje.trim() : render(base.texto, datos);
  const asunto = typeof body.asunto === "string" && body.asunto.trim() ? body.asunto.trim() : render(base.asunto, datos);
  if (!texto) return errorResponse("El mensaje está vacío.", "INVALID_INPUT", 400);

  let enviado: { metodo: "api" | "manual"; link?: string } ;

  if (canal === "whatsapp") {
    if (!cliente.telefono) return errorResponse("El cliente no tiene teléfono cargado.", "SIN_TELEFONO", 409);
    // Sin API de Meta configurada, el envío es MANUAL: se devuelve el link wa.me y lo abre
    // el operador. Se registra igual — el contacto ocurrió, lo haya mandado un bot o una
    // persona, y la ficha tiene que poder contarlo.
    enviado = { metodo: "manual", link: linkWhatsapp(cliente.telefono, texto) };
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
    descripcion: `${MOTIVO_LABEL[motivo]} por ${canal === "email" ? "email" : "WhatsApp"} a ${datos.nombre}`,
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
async function cargarContactable(ctx: Ctx, id: string) {
  const cliente = await prisma.clientes.findFirst({
    where: { ...withTenant(ctx.tenantId), id },
    include: {
      creditos: {
        orderBy: { created_at: "desc" },
        select: {
          id: true, estado: true, saldo_pendiente: true, proximo_pago: true, vendedor_id: true,
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
  const vivos = cliente.creditos.filter((c) => esCreditoVivo(c.estado));
  // Mora EN VIVO, no el caché de `creditos.dias_mora`: nada lo avanza día a día, y un aviso
  // de mora que dice "0 días" es peor que no mandarlo.
  const conMora = vivos
    .map((c) => ({ ...c, dias: diasMoraActual(c.proximo_pago, hoy) }))
    .sort((a, b) => b.dias - a.dias);
  const peor = conMora[0];

  const financiera = await getFinanciera(ctx.tenantId);
  const commRaw = await getComunicacionConfig(ctx.tenantId);
  const comm = {
    whatsapp: (commRaw.whatsappConfig ?? null) as { enabled?: boolean } | null,
    email: (commRaw.emailConfig ?? null) as EmailTenantConfig | null,
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

  for (const c of vivos) {
    const cuotasDom: CuotaParaImputar[] = c.cuotas.map((q) => ({
      id: q.id, nro: q.nro, fechaVencimiento: q.fecha_vencimiento,
      capital: q.capital, interes: q.interes, cargos: round2(q.iva + q.seguro + q.gastos),
      cuotaTotal: q.cuota_total,
      pagadoCapital: q.pagado_capital, pagadoInteres: q.pagado_interes,
      pagadoMora: q.pagado_mora, pagadoCargos: q.pagado_cargos,
    }));
    const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
    const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
    // Dia comercial argentino: con el ahora en UTC, entre las 21:00 y la medianoche de
    // Argentina se le cobra —y se le INFORMA— un dia de mora de mas.
    const opts = { moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct, diasGracia: gracia, hoy };

    deudaTotal += calcularDeudaConsolidada(cuotasDom, opts).total;

    const dv = calcularDeudaVencida(cuotasDom, opts);
    venc = { total: venc.total + dv.total, cuotas: venc.cuotas + dv.cuotas_vencidas };
    // La cuota que se nombra es la vencida MÁS VIEJA: es la que el cliente tiene que buscar
    // en su plan de pagos para reconocer el reclamo.
    const masVieja = cuotasDom.find((q) => diasAtraso(q.fechaVencimiento, hoy) > 0 && q.pagadoCapital < q.capital);
    if (masVieja && (nroCuotaVencida == null || masVieja.nro < nroCuotaVencida)) nroCuotaVencida = masVieja.nro;
  }

  const deudaViva = round2(deudaTotal);
  const vencido = round2(venc.total);

  const proximo = vivos
    .map((c) => c.proximo_pago)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

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
  const creditoDelMensaje = peor ?? vivos[0] ?? null;
  const proximaCuota = creditoDelMensaje?.cuotas?.find((q) => q.pagado_capital < q.capital) ?? null;

  return {
    cliente,
    comm,
    // La gestión se cuelga del crédito MÁS ATRASADO: es del que se está hablando.
    creditoParaGestion: peor?.id ?? vivos[0]?.id ?? null,
    datos: {
      nombre: cliente.nombre,
      financiera: financiera?.nombre || "tu financiera",
      deuda: deudaViva,
      vencido,
      cuotas: venc.cuotas,
      nroCuota: nroCuotaVencida,
      dias: peor?.dias ?? 0,
      cuota: round2(proximaCuota?.cuota_total ?? 0),
      vencimiento: proximo,
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
