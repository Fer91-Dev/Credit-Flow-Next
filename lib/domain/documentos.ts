/**
 * Configuración de los DOCUMENTOS del crédito: la solicitud/mutuo y el pagaré.
 *
 * Son las decisiones que la financiera toma UNA vez y valen para todos los créditos:
 * jurisdicción, punitorios, qué cláusulas incluir. El texto de cada documento se arma con
 * esto + los datos congelados del crédito.
 *
 * Referencia de estructura: el formulario real de una financiera de Tucumán (aprobado por
 * abogados, contenido convalidado en sede judicial). De ahí sale el modelo de **una sola
 * hoja**: la solicitud documenta el mutuo y el pagaré va al pie, con línea de corte.
 *
 * Dominio PURO: tipos, defaults y resolución. Sin framework ni base.
 */

/** Cómo se emite el pagaré. Define qué se imprime y qué queda para completar a mano. */
export type ModoPagare =
  /** Monto y vencimiento impresos. Simple, pero la cifra queda vieja: no incluye lo que
   *  se devengó después de firmar. */
  | "con_monto"
  /** En blanco, para completar al ejecutarlo con la deuda a esa fecha (capital + interés +
   *  punitorios corridos). Es la práctica habitual y por eso el pagaré va "a la vista".
   *  Exige que el contrato quede impecable: es el papel que sostiene al pagaré si se
   *  discute la deuda. */
  | "sin_monto";

export interface DocumentosConfig {
  /** Fuero al que se someten las partes. Vacío = no se imprime la cláusula. */
  jurisdiccion: string;
  /** Actualización por IPC del INDEC, además del punitorio. */
  actualiza_por_ipc: boolean;
  /** Con monto impreso, o en blanco para completar al ejecutar. */
  modo_pagare: ModoPagare;
  /** Cláusula "sin protesto": evita el trámite notarial previo a ejecutar. */
  sin_protesto: boolean;
  /**
   * Amplía el plazo de presentación del pagaré a la vista (art. 36, Dec. Ley 5965/63).
   * Sin esta cláusula el plazo es mucho más corto — un pagaré guardado "por las dudas"
   * puede quedar fuera de término.
   */
  anios_presentacion: number;
  /**
   * Cuántas cuotas impagas hacen caer todos los plazos y vuelven exigible el total.
   * 0 = sin caducidad de plazos (solo se reclama lo vencido).
   */
  cuotas_caducidad: number;
  /** Autoriza a ceder la cartera a un tercero. Solo si la financiera lo hace. */
  incluye_cesion_credito: boolean;
  /** Autoriza a informar el comportamiento de pago a bureaus y terceros. */
  incluye_autorizacion_informes: boolean;
  /**
   * Si la entidad está autorizada por el BCRA. **Declararlo sin serlo es grave**, por eso
   * arranca en false y hay que activarlo a conciencia.
   */
  autorizada_bcra: boolean;
  /** Texto libre que se agrega al final de las cláusulas. Para lo que no previmos. */
  clausulas_extra: string;
}

export const DOCUMENTOS_DEFAULT: DocumentosConfig = {
  jurisdiccion: "",
  actualiza_por_ipc: false,
  modo_pagare: "con_monto",
  sin_protesto: true,
  anios_presentacion: 5,
  cuotas_caducidad: 2,
  incluye_cesion_credito: false,
  incluye_autorizacion_informes: true,
  autorizada_bcra: false,
  clausulas_extra: "",
};

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const texto = (v: unknown, def: string, max = 4000) =>
  typeof v === "string" ? v.trim().slice(0, max) : def;
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

/** Completa lo que falte con los defaults y acota los valores fuera de rango. */
export function resolverDocumentos(raw: Partial<DocumentosConfig> | null | undefined): DocumentosConfig {
  const d = DOCUMENTOS_DEFAULT;
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    jurisdiccion: texto(raw.jurisdiccion, d.jurisdiccion, 200),
    actualiza_por_ipc: bool(raw.actualiza_por_ipc, d.actualiza_por_ipc),
    modo_pagare: raw.modo_pagare === "sin_monto" ? "sin_monto" : "con_monto",
    sin_protesto: bool(raw.sin_protesto, d.sin_protesto),
    anios_presentacion: Math.round(num(raw.anios_presentacion, d.anios_presentacion, 1, 10)),
    cuotas_caducidad: Math.round(num(raw.cuotas_caducidad, d.cuotas_caducidad, 0, 24)),
    incluye_cesion_credito: bool(raw.incluye_cesion_credito, d.incluye_cesion_credito),
    incluye_autorizacion_informes: bool(raw.incluye_autorizacion_informes, d.incluye_autorizacion_informes),
    autorizada_bcra: bool(raw.autorizada_bcra, d.autorizada_bcra),
    clausulas_extra: texto(raw.clausulas_extra, d.clausulas_extra),
  };
}

/** Aviso, con su motivo. `bloqueante` impide emitir; el resto solo advierte. */
export interface AvisoDocumentos {
  /** Clave del bloque señalado. "mora" apunta al motor, que es donde se cambia. */
  campo: keyof DocumentosConfig | "mora";
  mensaje: string;
  bloqueante: boolean;
}

/**
 * Revisa la configuración y señala lo que dejaría un documento débil.
 *
 * No alcanza con que el documento se genere: puede salir perfecto y no servir para nada.
 * Un contrato sin punitorios no permite reclamar el atraso; uno sin jurisdicción deja la
 * competencia abierta a discusión. Son huecos que recién se notan cuando hay que cobrar.
 */

/**
 * Punitorio MENSUAL, en %, derivado de la tasa de mora diaria que el motor realmente cobra.
 *
 * 🔴 Esto existe porque antes eran DOS números independientes: la tasa diaria en Motor
 * financiero (lo que la caja cobra) y un "interés punitorio mensual" suelto acá (lo que el
 * papel declara). Nada verificaba que coincidieran — `revisarDocumentos` ni siquiera podía
 * verlos juntos— así que el documento podía declarar 5% mensual mientras el sistema cobraba
 * el equivalente a 3%. En una pantalla desalineada eso es un detalle; en un pagaré firmado
 * es la cifra que vale ante un juez.
 *
 * La mora del motor es interés SIMPLE por día (`cuota × tasaDiaria × días`, ver
 * `interesMora`), así que el mensual equivalente es la diaria por 30. Nada de capitalizar:
 * el documento tiene que declarar lo que efectivamente se cobra, no una aproximación.
 */
export function punitorioMensualDesdeDiaria(tasaMoraDiaria: number): number {
  if (!Number.isFinite(tasaMoraDiaria) || tasaMoraDiaria <= 0) return 0;
  return Math.round(tasaMoraDiaria * 30 * 100 * 100) / 100; // fracción diaria → % mensual
}

export function revisarDocumentos(c: DocumentosConfig, punitorioMensual = 0): AvisoDocumentos[] {
  const avisos: AvisoDocumentos[] = [];

  if (!c.jurisdiccion.trim()) {
    avisos.push({
      campo: "jurisdiccion",
      mensaje: "Sin jurisdicción pactada, el deudor puede discutir ante qué tribunal se lo reclama.",
      bloqueante: false,
    });
  }
  if (punitorioMensual <= 0) {
    avisos.push({
      campo: "mora",
      mensaje:
        "Con la mora apagada o en cero, el documento no reclama nada por el atraso: pagar " +
        "tarde sale lo mismo que pagar a término. Se activa en Motor financiero → Interés por mora.",
      bloqueante: false,
    });
  }
  if (c.modo_pagare === "sin_monto" && !c.sin_protesto) {
    avisos.push({
      campo: "sin_protesto",
      mensaje:
        "Un pagaré en blanco sin la cláusula \"sin protesto\" obliga a un trámite notarial " +
        "previo para poder ejecutarlo.",
      bloqueante: false,
    });
  }
  if (c.autorizada_bcra) {
    avisos.push({
      campo: "autorizada_bcra",
      mensaje:
        "Se va a imprimir que la entidad está autorizada por el BCRA. Declararlo sin estarlo " +
        "es una infracción grave: activalo solo si tenés la autorización.",
      bloqueante: false,
    });
  }
  return avisos;
}
