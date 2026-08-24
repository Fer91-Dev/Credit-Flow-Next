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
