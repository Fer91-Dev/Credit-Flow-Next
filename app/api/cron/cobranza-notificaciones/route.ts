import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sincronizarAcuerdos } from "@/lib/acuerdos";
import { Prisma } from "@prisma/client";
import { sinDeuda, ESTADOS_VIVOS, resolverPlantillasMeta, type PlantillaMeta } from "@/lib/domain";
import { enviarWhatsappApi, whatsappApiDisponible, type WhatsappApiConfig } from "@/lib/whatsapp";
import { hoyComercial } from "@/lib/utils";

// Reglas de mora para disparar notificaciones
const REGLAS = [
  { dias: -3, evento: "recordatorio" },   // 3 días antes del vencimiento
  { dias: 0,  evento: "vencimiento" },    // vence hoy
  { dias: 5,  evento: "mora_temprana" },
  { dias: 15, evento: "mora_media" },
  { dias: 30, evento: "mora_critica" },
];

/**
 * /api/cron/cobranza-notificaciones — Motor de notificaciones automáticas diarias.
 * Requiere header Authorization: Bearer <CRON_SECRET> para evitar ejecuciones no autorizadas.
 *
 * Se expone en GET y POST con la MISMA lógica:
 *  - GET  → lo dispara Vercel Cron (solo hace GET; agrega el Bearer <CRON_SECRET> solo).
 *  - POST → disparadores externos (Supabase Edge Function, cron local, curl).
 */
export async function GET(req: NextRequest) {
  return ejecutarCron(req);
}

export async function POST(req: NextRequest) {
  return ejecutarCron(req);
}

async function ejecutarCron(req: NextRequest) {
  // Verificar token secreto
  /**
   * 🔴 FAIL-CLOSED. Antes era `if (cronSecret) { ...comparar... }`: si la variable no estaba
   * definida **no se comparaba nada y el handler seguía**. Esta ruta está en PUBLIC_PATHS
   * del middleware, así que no hay ninguna otra barrera detrás — una `CRON_SECRET` borrada,
   * un entorno nuevo o una rotación a medias dejaban el endpoint abierto a internet sin que
   * nada fallara ni avisara. Y este handler escribe cross-tenant a propósito.
   *
   * La comodidad de desarrollo se conserva, pero acotada a que NO sea producción.
   */
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
    }
  } else {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  /**
   * 🔴 El día ARGENTINO, no el del servidor.
   *
   * `setHours` usa la zona horaria de quien corre el proceso, y en Vercel eso es UTC. Hoy
   * coincide porque el cron dispara 12:00 UTC (09:00 AR, mismo día de calendario) — pero es
   * una coincidencia del horario, no una garantía: mover el cron a la madrugada haría que
   * el servidor viera el día siguiente y rompiera las promesas un día antes.
   */
  const hoy = hoyComercial();

  // Promesas de pago vencidas: se procesan SIEMPRE (es una actualización de estado,
  // no depende de tener canales de notificación configurados).
  const promesas = await procesarPromesasVencidas(hoy);

  // Reconciliación de estado: cierra créditos cuyo ledger ya no tiene deuda pero que
  // quedaron en "activo"/"vencido" (datos legacy o drift). El camino normal ya los pasa
  // a "pagado" al cobrar la última cuota; esto es la red de seguridad. Corre SIEMPRE.
  const reconciliacion = await reconciliarCreditosSaldados();

  // Acuerdos de pago: se cierran los cumplidos y se rompen los incumplidos. Mismo criterio
  // que las promesas —el estado se DERIVA de lo cobrado, no de que alguien lo marque— y
  // corre SIEMPRE, para todos los tenants: es actualización de estado, no notificación.
  const acuerdos = await sincronizarAcuerdos({ hoy });

  // Obtener todos los tenants con configuración de canales activa
  const configs = await prisma.configuraciones.findMany({
    where: {
      OR: [
        { whatsapp_config: { not: Prisma.JsonNull } },
        { sms_config:      { not: Prisma.JsonNull } },
        { email_config:    { not: Prisma.JsonNull } },
      ],
    },
  });

  const resultados: { tenant_id: string; enviados: number; errores: number }[] = [];

  for (const config of configs) {
    const whatsapp = config.whatsapp_config as WhatsappConfig | null;
    const sms = config.sms_config as SmsConfig | null;
    const email = config.email_config as EmailConfig | null;
    // Las plantillas registradas de este tenant: hacen falta para poder mandarle a Meta los
    // parámetros de la que corresponda a cada evento.
    const plantillasMeta = resolverPlantillasMeta(
      (config.cobranza_config as { plantillas_meta?: unknown } | null)?.plantillas_meta,
    );

    // Solo procesar si hay al menos un canal activo
    if (!whatsapp?.enabled && !sms?.enabled && !email?.enabled) continue;

    let enviados = 0;
    let errores = 0;

    for (const regla of REGLAS) {
      /**
       * TODAS las reglas se resuelven contra `proximo_pago`, con UNA fórmula.
       *
       * 🔴 Antes había dos caminos y los dos estaban mal:
       *
       *  · Las de MORA filtraban por `creditos.dias_mora`, que es un CACHE y solo se escribe
       *    al cobrar — nada lo avanza día a día. Un crédito al que el cliente nunca le pagó
       *    una cuota conserva `dias_mora = 0` desde que nació, así que **no matcheaba ninguna
       *    regla y no recibía jamás un aviso de mora**: justo el deudor que más hay que
       *    perseguir era el único al que el sistema no le escribía.
       *
       *  · La de RECORDATORIO (−3 = "tres días antes de vencer") calculaba `hoy + (−3)`, o
       *    sea tres días ATRÁS, y buscaba cuotas ya vencidas. Disparaba un mensaje de
       *    "se te viene el vencimiento" al tercer día de atraso.
       *
       * `regla.dias` son días de ATRASO (negativo = todavía falta para vencer), así que la
       * cuota que buscamos venció hace `regla.dias` días: `hoy − regla.dias`. Con −3 da
       * hoy + 3 (vence en tres días) y con 15 da hoy − 15 (venció hace quince). Una sola
       * cuenta para las cinco reglas.
       */
      const fechaObjetivo = new Date(hoy);
      fechaObjetivo.setDate(hoy.getDate() - regla.dias);

      // Créditos vivos cuya cuota más vieja impaga vence (o venció) exactamente ese día.
      const creditos = await prisma.creditos.findMany({
        where: {
          tenant_id: config.tenant_id,
          estado: { in: [...ESTADOS_VIVOS] },
          proximo_pago: fechaObjetivo,
        },
        include: {
          cliente: { select: { nombre: true, apellido: true, telefono: true, email: true } },
        },
        take: 500, // límite de seguridad por regla/tenant
      });

      for (const credito of creditos) {
        // Evitar duplicar: no enviar si ya se notificó hoy con este evento
        const yaNotificado = await prisma.acciones_cobranza.findFirst({
          where: {
            tenant_id: config.tenant_id,
            credito_id: credito.id,
            automatico: true,
            nota: { contains: regla.evento },
            created_at: { gte: hoy },
          },
        });
        if (yaNotificado) continue;

        let enviado = false;

        // Intentar envío por canal disponible (WhatsApp > SMS > Email)
        if (whatsapp?.enabled) {
          enviado = await enviarWhatsapp(whatsapp, credito, regla.evento, plantillasMeta);
        } else if (sms?.enabled) {
          enviado = await enviarSms(sms, credito, regla.evento);
        } else if (email?.enabled) {
          enviado = await enviarEmail(email, credito, regla.evento);
        }

        // Registrar la gestión automática en acciones_cobranza
        await prisma.acciones_cobranza.create({
          data: {
            tenant_id: config.tenant_id,
            credito_id: credito.id,
            tipo: whatsapp?.enabled ? "whatsapp" : sms?.enabled ? "otro" : "email",
            resultado: enviado ? "contactado" : "no_contesta",
            nota: `[AUTO] Notificación ${regla.evento} - ${enviado ? "Enviada" : "Error de envío"}`,
            automatico: true,
          },
        });

        if (enviado) enviados++; else errores++;
      }
    }

    resultados.push({ tenant_id: config.tenant_id, enviados, errores });
  }

  return NextResponse.json({ ok: true, promesas, acuerdos, reconciliacion, procesados: configs.length, resultados });
}

/**
 * Cierra los créditos que ya no tienen deuda (ledger saldado) pero cuyo `estado` quedó
 * en "activo"/"vencido". Usa el mismo criterio autoritativo que las lecturas (`sinDeuda`:
 * saldo ~ 0 y todas las cuotas con capital saldado). Idempotente: solo toca los que hace
 * falta. Corre para TODOS los tenants (no depende de canales configurados).
 */
async function reconciliarCreditosSaldados(): Promise<{ cerrados: number }> {
  const candidatos = await prisma.creditos.findMany({
    where: { estado: { in: ["activo", "vencido"] }, saldo_pendiente: { lte: 0.01 } },
    select: { id: true, saldo_pendiente: true, cuotas: { select: { capital: true, pagado_capital: true } } },
    take: 2000, // límite de seguridad
  });
  const ids = candidatos.filter((c) => sinDeuda(c.saldo_pendiente, c.cuotas)).map((c) => c.id);
  if (ids.length === 0) return { cerrados: 0 };
  await prisma.creditos.updateMany({
    where: { id: { in: ids } },
    data: { estado: "pagado", dias_mora: 0, proximo_pago: null },
  });
  return { cerrados: ids.length };
}

// ─── Promesas de pago vencidas (automatización de incumplimiento) ─────────────

/** Formatea una fecha a DD/MM/AAAA (UTC-safe) para la nota de la gestión. */
function fmtFechaCorta(d: Date | null): string {
  if (!d) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/**
 * Marca como INCUMPLIDA (rota) toda promesa de pago pendiente cuya fecha límite ya
 * pasó y que no fue cubierta por pagos. Auto-corrección: si hubo pagos posteriores a
 * la promesa que la cubren, la rescata como CUMPLIDA (por si la conciliación al cobrar
 * no la marcó). Por cada promesa rota registra una gestión automática como "alerta" en
 * el historial del crédito, con próximo contacto = hoy. Corre para TODOS los tenants.
 */
async function procesarPromesasVencidas(hoy: Date): Promise<{ rotas: number; rescatadas: number }> {
  const vencidas = await prisma.acciones_cobranza.findMany({
    where: {
      resultado: "promesa_pago",
      promesa_estado: "pendiente",
      promesa_fecha: { lt: hoy }, // fecha límite estrictamente anterior a hoy (vencía ayer o antes)
    },
    take: 2000, // límite de seguridad
  });

  let rotas = 0;
  let rescatadas = 0;

  for (const promesa of vencidas) {
    // ¿Hubo pagos desde que se hizo la promesa que la cubran? (auto-corrección)
    /**
     * 🔴 El día ARGENTINO en que se tomó la promesa.
     *
     * `created_at` es un TIMESTAMP y `setHours` recortaba por el día UTC del servidor. Una
     * promesa tomada después de las 21:00 hora argentina ya pertenece al día UTC siguiente,
     * así que `desde` quedaba en el día de DESPUÉS: un pago hecho esa misma noche no la
     * rescataba y el cliente figuraba como que no cumplió su palabra. Medido: 1 de las 4
     * promesas de la base cae en esa franja.
     *
     * `pagos.fecha` es `@db.Date`, así que el borde va a medianoche UTC del día argentino
     * correcto — que es exactamente lo que devuelve `hoyComercial` para hoy y lo que se
     * arma acá para la fecha de la promesa.
     */
    const ymdAR = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(promesa.created_at);
    const desde = new Date(`${ymdAR}T00:00:00.000Z`);
    const agg = await prisma.pagos.aggregate({
      where: { tenant_id: promesa.tenant_id, credito_id: promesa.credito_id, fecha: { gte: desde }, anulado: false },
      _sum: { monto: true },
    });
    const pagado = agg._sum.monto ?? 0;
    const cubierta = promesa.promesa_monto ? pagado >= promesa.promesa_monto : pagado > 0;

    if (cubierta) {
      await prisma.acciones_cobranza.update({
        where: { id: promesa.id },
        data: { promesa_estado: "cumplida" },
      });
      rescatadas++;
      continue;
    }

    // Romper la promesa + registrar la alerta (gestión automática) en una transacción.
    const montoTxt = promesa.promesa_monto
      ? ` por $${promesa.promesa_monto.toLocaleString("es-AR")}`
      : "";
    await prisma.$transaction([
      prisma.acciones_cobranza.update({
        where: { id: promesa.id },
        data: { promesa_estado: "incumplida" },
      }),
      prisma.acciones_cobranza.create({
        data: {
          tenant_id: promesa.tenant_id,
          credito_id: promesa.credito_id,
          tipo: "otro",
          resultado: "otro",
          nota: `[AUTO] Promesa de pago INCUMPLIDA — vencía ${fmtFechaCorta(promesa.promesa_fecha)}${montoTxt}; no se registró el pago. Recontactar al cliente.`,
          automatico: true,
          proximo_contacto: hoy, // sugiere recontacto inmediato
        },
      }),
    ]);
    rotas++;
  }

  return { rotas, rescatadas };
}

// ─── Tipos de configuración ───────────────────────────────────────────────────

// La forma vive junto al emisor (`lib/whatsapp`). `templates` mapea evento → NOMBRE de la
// plantilla registrada, que es la que sabe qué variables tiene.
type WhatsappConfig = WhatsappApiConfig;

type SmsConfig = {
  enabled: boolean;
  api_key: string;
  provider: string;
};

type EmailConfig = {
  enabled: boolean;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  api_key?: string;
  provider?: string;
};

type CreditoConCliente = {
  id: string;
  cliente: { nombre: string; telefono: string | null; email: string | null };
};

// ─── Funciones de envío (stubs — implementar con SDK del proveedor) ───────────

/**
 * Aviso automático por WhatsApp.
 *
 * 🔴 Mandaba la plantilla como `{ name, language: "es_AR" }` SIN parámetros y con el idioma
 * fijo. Meta rechaza las dos cosas: una plantilla con variables sin parámetros, y una
 * búsqueda por nombre + idioma que no coincide con ninguno aprobado. Como el resultado se
 * reducía a un booleano, el cron anotaba "Error de envío" un día tras otro sin que nada
 * dijera por qué.
 *
 * Ahora pasa por el emisor único y busca la plantilla entre las REGISTRADAS, para poder
 * mandarle sus parámetros. El mapa viejo `config.templates[evento]` se sigue respetando: es
 * el que dice qué plantilla corresponde a cada evento del cron.
 */
async function enviarWhatsapp(
  config: WhatsappConfig,
  credito: CreditoConCliente,
  evento: string,
  plantillas: PlantillaMeta[],
): Promise<boolean> {
  if (!credito.cliente.telefono) return false;
  if (!whatsappApiDisponible(config)) return false;
  const nombrePlantilla = config.templates?.[evento];
  if (!nombrePlantilla) return false;

  const plantilla = plantillas.find((p) => p.nombre === nombrePlantilla && p.activa) ?? null;
  // Sin la plantilla registrada no se puede completar sus variables; mandarla igual sería
  // repetir el error que se está corrigiendo.
  if (!plantilla) return false;

  const res = await enviarWhatsappApi(config, {
    telefono: credito.cliente.telefono,
    plantilla,
    // El cron no tiene la deuda calculada adelante: solo completa lo que sí sabe. Una
    // plantilla de aviso automático que pida importes no es para este camino.
    resolver: (clave) => (clave === "nombre" ? credito.cliente.nombre : ""),
  });
  return res.ok;
}

async function enviarSms(
  _config: SmsConfig,
  _credito: CreditoConCliente,
  _evento: string
): Promise<boolean> {
  // TODO: implementar con Twilio u otro gateway cuando se configure
  return false;
}

async function enviarEmail(
  _config: EmailConfig,
  _credito: CreditoConCliente,
  _evento: string
): Promise<boolean> {
  // TODO: implementar con Resend/SendGrid/SMTP cuando se configure
  return false;
}
