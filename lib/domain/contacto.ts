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
  { clave: "nombre",      descripcion: "Nombre del cliente" },
  { clave: "financiera",  descripcion: "Nombre de tu financiera" },
  { clave: "deuda",       descripcion: "Lo que debe hoy, con mora incluida" },
  { clave: "dias",        descripcion: "Días de atraso" },
  { clave: "cuota",       descripcion: "Importe de la próxima cuota" },
  { clave: "vencimiento", descripcion: "Fecha del próximo vencimiento" },
] as const;

/** Lo que hace falta saber del cliente para completar un mensaje. */
export interface DatosPlantillaContacto {
  nombre: string;
  financiera: string;
  deuda: number;
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
    deuda: money(d.deuda),
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
  mora: "Hola [nombre], te escribimos de [financiera]. Registramos un atraso de [dias] días en tu crédito, por un total de $[deuda]. Comunicate con nosotros para regularizarlo.",
  promocion: "Hola [nombre], te escribimos de [financiera]. Tenemos una propuesta para vos. Respondé este mensaje y te contamos.",
  informacion: "Hola [nombre], te escribimos de [financiera].",
  asunto_mora: "Tu crédito tiene cuotas pendientes",
  asunto_promocion: "Tenemos algo para vos",
  asunto_informacion: "Mensaje de [financiera]",
};

/** Config guardada del tenant (parcial) sobre los defaults. */
export function resolverPlantillasContacto(parcial?: Partial<PlantillasContacto> | null): PlantillasContacto {
  const p = parcial ?? {};
  const limpio = <K extends keyof PlantillasContacto>(k: K): string => {
    const v = p[k];
    return typeof v === "string" && v.trim() !== "" ? v : PLANTILLAS_CONTACTO_DEFAULT[k];
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
