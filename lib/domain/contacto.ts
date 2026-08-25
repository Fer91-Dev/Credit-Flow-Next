/**
 * CONTACTO INDIVIDUAL con un cliente — el mensaje uno a uno, no la campaña masiva.
 *
 * Las campañas ya resolvían el envío a MUCHOS créditos en mora a la vez. Lo que faltaba era
 * lo más común del mostrador: escribirle a UN cliente puntual, desde su ficha, para avisarle
 * de una cuota, ofrecerle algo o mandarle un dato.
 *
 * Comparte con las campañas el armador de mensajes (`construirMensajeCampana`, placeholders
 * `[clave]`) y el link de WhatsApp: un mensaje al mismo cliente no puede escribirse distinto
 * según desde qué pantalla salió.
 */

/** Para qué se contacta. Define la plantilla por defecto y —lo importante— si cuenta como gestión. */
export type MotivoContacto = "mora" | "promocion" | "informacion";

export const MOTIVO_LABEL: Record<MotivoContacto, string> = {
  mora: "Aviso de mora",
  promocion: "Promoción",
  informacion: "Información",
};

/**
 * 🔴 SOLO "mora" ES GESTIÓN DE COBRANZA.
 *
 * La efectividad de cobranza (Reportes → Cobranza) mide sobre gestiones manuales: contactos
 * → promesas → cumplidas. Si un mensaje promocional se registrara como gestión, engordaría
 * el denominador del embudo y la tasa de conversión caería sin que nadie hubiera trabajado
 * peor. Los otros dos motivos quedan igual en la auditoría del cliente: se guardan, no se
 * cuentan.
 */
export function cuentaComoGestion(motivo: MotivoContacto): boolean {
  return motivo === "mora";
}

export interface PlantillasContacto {
  mora: string;
  promocion: string;
  informacion: string;
  /** Asunto del email (el WhatsApp no lleva). */
  asunto_mora: string;
  asunto_promocion: string;
  asunto_informacion: string;
}

/**
 * Los datos que se pueden intercalar en un mensaje. Esta lista es la ÚNICA fuente: la
 * pantalla de Configuración la muestra y `renderPlantillaContacto` la aplica, así que no
 * puede ofrecerse algo que después no se reemplaza.
 *
 * 🔴 Pasó exactamente eso: la documentación prometía `[cuota]` y el renderizador nunca lo
 * sustituía. Un mensaje escrito con esa clave le llegaba al cliente diciendo "[cuota]".
 */
export const PLACEHOLDERS_CONTACTO = [
  { clave: "nombre",       descripcion: "Nombre del cliente" },
  { clave: "financiera",   descripcion: "Nombre de tu financiera" },
  { clave: "vencido",      descripcion: "Lo que está VENCIDO hoy, con mora — es lo que hay que reclamar" },
  { clave: "cuotas",       descripcion: "Cuántas cuotas tiene vencidas" },
  { clave: "nro_cuota",    descripcion: "N° de la cuota vencida más vieja" },
  { clave: "dias",         descripcion: "Días de atraso" },
  { clave: "cuota",        descripcion: "Importe de la próxima cuota a pagar" },
  { clave: "vencimiento",  descripcion: "Fecha del próximo vencimiento" },
  { clave: "deuda",        descripcion: "TODO el crédito si lo cancela hoy (capital + interés + mora)" },
] as const;

/** Lo que hace falta saber del cliente para completar un mensaje. */
export interface DatosPlantillaContacto {
  nombre: string;
  financiera: string;
  /**
   * 🔴 DOS NÚMEROS DISTINTOS, Y NO SON INTERCAMBIABLES.
   *
   * `vencido` es lo que el cliente TIENE QUE PAGAR AHORA: las cuotas que ya vencieron más su
   * mora. `deuda` es todo el crédito, incluidas las cuotas que todavía no vencieron.
   *
   * Un aviso de mora tiene que reclamar lo VENCIDO. La plantilla por defecto pedía `deuda`,
   * así que a alguien con 15 días de atraso sobre una cuota de $73.441,71 se le reclamaban
   * $221.426,76 — el préstamo entero, cuotas futuras incluidas. Eso no es un recordatorio de
   * mora, es exigir la caducidad de plazos, y encima no coincidía con lo que la ficha muestra
   * como deuda ni con lo que la caja iba a cobrar.
   */
  vencido: number;
  deuda: number;
  /** Cuotas vencidas e impagas, y el número de la más vieja (la que hay que nombrar). */
  cuotas: number;
  nroCuota: number | null;
  dias: number;
  cuota: number;
  vencimiento: Date | string | null;
}

const money = (n: number) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Reemplaza los `[claves]` de una plantilla con los datos del cliente.
 *
 * Vive en el dominio y no en el endpoint a propósito: lo usan el ENVÍO real y la VISTA
 * PREVIA de Configuración. Si cada uno tuviera su copia, la pantalla mostraría un mensaje y
 * al cliente le llegaría otro — el mismo error de dos fórmulas que ya se pagó con los cargos
 * y con la mora.
 *
 * Los importes van CON CENTAVOS. Antes se redondeaban a pesos enteros: al cliente se le
 * decía que debía $1.872.415 y al pagar el sistema le pedía $1.872.415,37. Un mensaje de
 * cobranza que no coincide con la caja es una discusión en el mostrador.
 */
export function renderPlantillaContacto(plantilla: string, d: DatosPlantillaContacto): string {
  const venc = d.vencimiento
    ? new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(new Date(d.vencimiento))
    : "—";
  const valores: Record<string, string> = {
    nombre: d.nombre,
    financiera: d.financiera,
    vencido: money(d.vencido),
    deuda: money(d.deuda),
    cuotas: String(d.cuotas),
    nro_cuota: d.nroCuota != null ? String(d.nroCuota) : "—",
    dias: String(d.dias),
    cuota: money(d.cuota),
    vencimiento: venc,
  };
  // Solo se tocan las claves conocidas: un `[texto entre corchetes]` que el operador haya
  // escrito por su cuenta se respeta tal cual, en vez de desaparecer.
  return plantilla.replace(/\[(\w+)\]/g, (full, k: string) => valores[k.toLowerCase()] ?? full);
}

/**
 * Textos por defecto. Neutros a propósito: los escribe cada financiera desde Configuración.
 */
export const PLANTILLAS_CONTACTO_DEFAULT: PlantillasContacto = {
  // Reclama lo VENCIDO y nombra la cuota: el cliente tiene que poder cotejar el número
  // contra su plan de pagos. Antes pedía `[deuda]` —el crédito entero— y eso no coincidía
  // ni con la ficha ni con lo que la caja iba a cobrar.
  mora: "Hola [nombre], te escribimos de [financiera]. Tenés la cuota [nro_cuota] vencida hace [dias] días. Para regularizarte tenés que abonar $[vencido] (mora incluida). Tu próxima cuota es de $[cuota] y vence el [vencimiento]. Comunicate con nosotros.",
  promocion: "Hola [nombre], te escribimos de [financiera]. Tenemos una propuesta para vos. Respondé este mensaje y te contamos.",
  informacion: "Hola [nombre], te escribimos de [financiera].",
  asunto_mora: "Tu crédito tiene cuotas pendientes",
  asunto_promocion: "Tenemos algo para vos",
  asunto_informacion: "Mensaje de [financiera]",
};

/**
 * Textos por defecto VIEJOS, que hay que reconocer para poder reemplazarlos.
 *
 * 🔴 El default de mora reclamaba `[deuda]` —todo el crédito, cuotas futuras incluidas— en
 * vez de lo vencido. Los tenants que apretaron "Guardar" alguna vez tienen ese texto
 * PERSISTIDO, así que arreglar el default no los alcanza: seguirían mandando el reclamo
 * improcedente para siempre.
 *
 * Si el texto guardado es EXACTAMENTE el default viejo, nadie lo escribió: es el que vino de
 * fábrica y se reemplaza por el nuevo. Un texto que la financiera haya redactado de verdad
 * —aunque se le parezca— no se toca.
 */
const LEGACY: Partial<Record<keyof PlantillasContacto, string[]>> = {
  mora: ["Hola [nombre], te escribimos de [financiera]. Registramos un atraso de [dias] días en tu crédito, por un total de $[deuda]. Comunicate con nosotros para regularizarlo."],
};

/** Config guardada del tenant (parcial) sobre los defaults. */
export function resolverPlantillasContacto(parcial?: Partial<PlantillasContacto> | null): PlantillasContacto {
  const p = parcial ?? {};
  const limpio = <K extends keyof PlantillasContacto>(k: K): string => {
    const v = p[k];
    if (typeof v !== "string" || v.trim() === "") return PLANTILLAS_CONTACTO_DEFAULT[k];
    if (LEGACY[k]?.includes(v.trim())) return PLANTILLAS_CONTACTO_DEFAULT[k];
    return v;
  };
  return {
    mora: limpio("mora"),
    promocion: limpio("promocion"),
    informacion: limpio("informacion"),
    asunto_mora: limpio("asunto_mora"),
    asunto_promocion: limpio("asunto_promocion"),
    asunto_informacion: limpio("asunto_informacion"),
  };
}

export function plantillaDe(p: PlantillasContacto, motivo: MotivoContacto): { texto: string; asunto: string } {
  if (motivo === "mora") return { texto: p.mora, asunto: p.asunto_mora };
  if (motivo === "promocion") return { texto: p.promocion, asunto: p.asunto_promocion };
  return { texto: p.informacion, asunto: p.asunto_informacion };
}

/** El tipo de `acciones_cobranza` que corresponde a cada canal (el enum de la tabla). */
export function tipoGestionDeCanal(canal: "whatsapp" | "email"): string {
  return canal;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANTILLAS APROBADAS POR META (WhatsApp Business)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 POR QUÉ EXISTEN, Y POR QUÉ NO SON OBLIGATORIAS
 *
 * Las plantillas de arriba (`PlantillasContacto`) son texto libre de la financiera. Mientras
 * el WhatsApp lo mande una persona desde su teléfono —por `wa.me`, que es como funciona hoy—
 * alcanza. El problema aparece al crecer, y es de dos tipos distintos:
 *
 *  1. **Con la API de WhatsApp Business**: fuera de la ventana de 24 h desde el último
 *     mensaje del cliente, Meta SOLO entrega mensajes hechos con una plantilla que aprobó
 *     antes. Un texto libre no es que llegue mal: no llega, y la financiera cree que avisó.
 *  2. **Mandando a mano en volumen**: nada lo bloquea técnicamente, pero los reportes de los
 *     destinatarios ("bloquear / reportar") bajan la calidad del número. Primero se recorta
 *     el límite de mensajes por día y después se pierde la línea, con las conversaciones
 *     adentro.
 *
 * Por eso el sistema PERMITE registrar las plantillas que Meta ya aprobó y usarlas, pero no
 * las exige: hoy se manda uno por uno desde el teléfono, y obligar a dar de alta una
 * plantilla para escribirle a un cliente sería trabar el mostrador por un riesgo que todavía
 * no existe. Lo que sí hace es AVISAR, y el aviso sube de tono con el volumen.
 *
 * El cuerpo se guarda tal como lo aprobó Meta, con `{{1}}`, `{{2}}`… Cambiar una letra
 * invalida la aprobación, así que el texto de una plantilla Meta NO se edita antes de
 * mandarlo: lo único que se completa son sus variables.
 */

/** Categorías con las que Meta clasifica una plantilla. Definen sus límites de envío. */
export const CATEGORIAS_META = ["utility", "marketing", "authentication"] as const;
export type CategoriaMeta = (typeof CATEGORIAS_META)[number];

export const CATEGORIA_META_LABEL: Record<CategoriaMeta, string> = {
  utility: "Utilidad (servicio)",
  marketing: "Marketing",
  authentication: "Autenticación",
};

/**
 * Qué implica cada categoría. Importa al elegir: una plantilla de cobranza declarada como
 * "marketing" cae bajo las preferencias de publicidad del destinatario y puede no entregarse,
 * además de consumir un cupo distinto.
 */
export const CATEGORIA_META_NOTA: Record<CategoriaMeta, string> = {
  utility:
    "Avisos sobre algo que el cliente ya tiene con vos: un vencimiento, un pago recibido, un recordatorio. Es la que corresponde a una cobranza.",
  marketing:
    "Ofertas y promociones. Meta la trata como publicidad: el cliente puede tenerla silenciada y no le llega. Reclamar una deuda con esta categoría hace que el aviso no se entregue.",
  authentication: "Solo códigos de verificación. No corresponde a cobranza.",
};

export interface PlantillaMeta {
  /** Id interno (lo genera la pantalla). No es el id de Meta. */
  id: string;
  /** El `name` EXACTO con el que Meta la aprobó (minúsculas y guiones bajos). */
  nombre: string;
  /** Código de idioma de Meta: es_AR, es, en_US. */
  idioma: string;
  categoria: CategoriaMeta;
  /** El cuerpo aprobado, tal cual, con las variables numeradas de Meta. */
  cuerpo: string;
  /**
   * Qué dato del sistema va en cada variable, en orden: `variables[0]` es la primera.
   * Las claves son las mismas de `PLACEHOLDERS_CONTACTO`.
   */
  variables: string[];
  /** Apagarla la saca de los selectores sin borrar el registro (Meta puede pausarla). */
  activa: boolean;
}

/** Cuántas variables numeradas declara un cuerpo aprobado (la más alta que aparece). */
export function variablesDeCuerpoMeta(cuerpo: string): number {
  const encontradas: number[] = [];
  for (const m of cuerpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) encontradas.push(Number(m[1]));
  return encontradas.length === 0 ? 0 : Math.max(...encontradas);
}

/**
 * Revisa una plantilla antes de guardarla. Devuelve los problemas; vacío = está bien.
 *
 * No valida contra Meta —no hay API configurada— así que lo único que puede hacer es que el
 * registro sea COHERENTE: que el nombre tenga el formato que Meta acepta y, sobre todo, que
 * no queden variables sin asignar. Una variable sin dato se le manda al cliente con el texto
 * literal adentro.
 */
export function revisarPlantillaMeta(p: Partial<PlantillaMeta>): string[] {
  const errores: string[] = [];
  const nombre = (p.nombre ?? "").trim();
  if (!nombre) errores.push("Falta el nombre con el que Meta aprobó la plantilla.");
  else if (!/^[a-z0-9_]+$/.test(nombre))
    errores.push("El nombre solo admite minúsculas, números y guiones bajos: es el formato de Meta (ej. aviso_mora_ar).");
  if (!(p.idioma ?? "").trim()) errores.push("Falta el código de idioma (es_AR, es, en_US).");
  const cuerpo = (p.cuerpo ?? "").trim();
  if (!cuerpo) errores.push("Falta el cuerpo aprobado.");

  const nVars = variablesDeCuerpoMeta(cuerpo);
  const asignadas = (p.variables ?? []).slice(0, nVars).filter((v) => !!v && v.trim() !== "").length;
  if (nVars > asignadas)
    errores.push(
      `El cuerpo usa ${nVars} variable${nVars === 1 ? "" : "s"} y ${
        asignadas === 0 ? "no hay ninguna asignada" : `solo ${asignadas} tiene${asignadas === 1 ? "" : "n"} dato`
      }. Sin asignar, al cliente le llega la variable escrita en crudo.`,
    );
  return errores;
}

/**
 * Completa una plantilla de Meta con los datos del cliente.
 *
 * Reemplaza cada variable numerada por el valor del placeholder declarado en `variables`.
 * Usa el MISMO diccionario que `renderPlantillaContacto`, así que un `[vencido]` de una
 * plantilla libre y una variable mapeada a `vencido` dan exactamente el mismo importe.
 */
export function renderPlantillaMeta(p: PlantillaMeta, d: DatosPlantillaContacto): string {
  return p.cuerpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (full, n: string) => {
    const clave = p.variables[Number(n) - 1];
    if (!clave) return full;
    // Se apoya en el renderizador de siempre: una sola tabla de valores para los dos formatos.
    const rendered = renderPlantillaContacto(`[${clave}]`, d);
    return rendered === `[${clave}]` ? full : rendered;
  });
}

/** Normaliza lo que viene guardado en la config (JSON libre). */
export function resolverPlantillasMeta(raw: unknown): PlantillaMeta[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p, i) => ({
      id: typeof p.id === "string" && p.id ? p.id : `meta-${i}`,
      nombre: String(p.nombre ?? "").trim(),
      idioma: String(p.idioma ?? "es_AR").trim(),
      categoria: (CATEGORIAS_META as readonly string[]).includes(String(p.categoria))
        ? (p.categoria as CategoriaMeta)
        : "utility",
      cuerpo: String(p.cuerpo ?? ""),
      variables: Array.isArray(p.variables) ? p.variables.map((v) => String(v ?? "")) : [],
      activa: p.activa !== false,
    }))
    .filter((p) => p.nombre && p.cuerpo);
}

/**
 * De qué placeholder de CAMPAÑA sale cada dato del contacto individual.
 *
 * 🔴 Son dos vocabularios distintos y hay que traducir a mano. La campaña conoce
 * `[nombre] [monto] [saldo] [dias] [descuento]` (ver `construirMensajeCampana`); el contacto
 * individual conoce la lista de `PLACEHOLDERS_CONTACTO`, que es más rica porque tiene todo
 * el crédito de UN cliente adelante.
 *
 * Lo que NO está en esta tabla no se puede mandar en una campaña, y eso es correcto, no una
 * limitación a esconder: una campaña arma un mensaje por lote y no resuelve el número de
 * cuota ni la fecha de vencimiento de cada uno. Traducirlo igual, con el dato de otro, sería
 * mandarle por escrito a 200 clientes una cifra que no es la suya.
 *
 * `monto` es lo que se le PIDE (la oferta, ya con la quita si hay promo), que es
 * deliberadamente lo que tiene que leer el cliente en una campaña de recupero.
 */
const CAMPANA_DESDE_CONTACTO: Record<string, string> = {
  nombre: "nombre",
  vencido: "monto",
  dias: "dias",
};

/**
 * Convierte una plantilla de Meta al formato que entiende una campaña.
 *
 * Devuelve el template y, por separado, los datos que la campaña NO sabe completar. Con
 * `faltantes` no vacío la plantilla no se puede usar en una campaña — la pantalla lo dice y
 * explica cuál es el dato que sobra, en vez de ofrecerla y mandar el texto roto.
 *
 * `financiera` se resuelve acá mismo como texto fijo: es constante para todo el lote, así
 * que no necesita ser un placeholder.
 */
export function plantillaMetaParaCampana(
  p: PlantillaMeta,
  financiera: string,
): { template: string; faltantes: string[] } {
  const faltantes: string[] = [];
  const template = p.cuerpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (full, n: string) => {
    const clave = p.variables[Number(n) - 1];
    if (!clave) { faltantes.push(`variable ${n} sin asignar`); return full; }
    if (clave === "financiera") return financiera;
    const destino = CAMPANA_DESDE_CONTACTO[clave];
    if (!destino) { faltantes.push(clave); return full; }
    return `[${destino}]`;
  });
  return { template, faltantes: [...new Set(faltantes)] };
}

/** Nivel del aviso sobre políticas de Meta. `null` = no hay nada que advertir. */
export type RiesgoMeta = "info" | "alto" | null;

/**
 * Qué avisarle a quien está por mandar un WhatsApp sin plantilla aprobada.
 *
 * Escala con el volumen porque el riesgo escala con el volumen: escribirle a un cliente desde
 * el mostrador no restringe ninguna línea; mandarle lo mismo a 200 de una vez, sí. Nunca
 * bloquea el envío — es una advertencia, no una regla de negocio.
 */
export function riesgoEnvioMeta(opts: {
  canal: "whatsapp" | "email";
  usaPlantillaMeta: boolean;
  /** A cuántos destinatarios va. 1 = contacto individual. */
  destinatarios: number;
  /** `true` si hay al menos una plantilla aprobada registrada en el sistema. */
  hayPlantillas: boolean;
}): { nivel: RiesgoMeta; titulo: string; puntos: string[] } {
  const { canal, usaPlantillaMeta, destinatarios, hayPlantillas } = opts;
  if (canal !== "whatsapp" || usaPlantillaMeta) return { nivel: null, titulo: "", puntos: [] };

  const masivo = destinatarios > 1;
  const puntos = [
    "Fuera de las 24 h desde el último mensaje del cliente, la API de WhatsApp Business solo entrega mensajes hechos con una plantilla aprobada. Un texto libre no se entrega, y el sistema no se entera.",
    "Los destinatarios que bloquean o reportan bajan la calidad del número: primero se recorta el límite de mensajes por día y después se pierde la línea, con las conversaciones adentro.",
  ];
  if (masivo) {
    puntos.unshift(`Van ${destinatarios} mensajes con el mismo texto libre desde el mismo número.`);
    puntos.push("Mandarlos de a tandas y escalonados a lo largo del día reduce el riesgo, pero no lo elimina.");
  }
  if (!hayPlantillas) {
    puntos.push("Todavía no hay ninguna plantilla aprobada cargada. Se dan de alta en Configuración → Cobranza.");
  }
  return {
    nivel: masivo ? "alto" : "info",
    titulo: masivo ? "Envío masivo sin plantilla aprobada por Meta" : "Sin plantilla aprobada por Meta",
    puntos,
  };
}
