/**
 * Importes en letras (español rioplatense) para documentos legales.
 *
 * El **pagaré exige la suma escrita en letras**: es uno de sus requisitos formales, y ante
 * una discrepancia entre lo escrito en números y en letras, **prevalece la letra**
 * (Dec. Ley 5965/63, art. 6 por remisión del art. 103). O sea que un error acá no es
 * cosmético: es la cifra que un juez toma como válida.
 *
 * Dominio PURO: sin dependencias de framework, para poder probarlo aparte.
 */

const UNIDADES = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
  "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
  "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];

const DECENAS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];

/** "ciento" salvo el 100 exacto, que es "cien". El 500/700/900 son irregulares. */
const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/**
 * 0–999 en letras. `apocope` convierte "uno" en "un" (va antes de un sustantivo:
 * "un millón", "veintiún mil"), que es la forma correcta y el error más común.
 */
function hasta999(n: number, apocope: boolean): string {
  if (n === 0) return "";
  if (n === 100) return "cien";

  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);

  if (resto > 0) {
    if (resto < 30) {
      let p = UNIDADES[resto];
      if (apocope && (resto === 1 || resto === 21)) p = resto === 1 ? "un" : "veintiún";
      partes.push(p);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      if (u === 0) partes.push(DECENAS[d]);
      else {
        const unidad = apocope && u === 1 ? "un" : UNIDADES[u];
        partes.push(`${DECENAS[d]} y ${unidad}`);
      }
    }
  }
  return partes.join(" ");
}

/**
 * Parte entera en letras. Soporta hasta billones (millón de millones, escala larga).
 *
 * `apocope` afecta SOLO al último bloque (las unidades), que es el que puede quedar pegado a
 * un sustantivo masculino: `true` para "veintiún pesos", `false` para "PESOS VEINTIUNO CON
 * 00/100", donde el sustantivo va adelante y no corresponde apocopar.
 */
function enteroALetras(n: number, apocope = false): string {
  if (n === 0) return "cero";

  const bloques: string[] = [];
  const billones = Math.floor(n / 1_000_000_000_000);
  const resto1 = n % 1_000_000_000_000;
  const millones = Math.floor(resto1 / 1_000_000);
  const resto2 = resto1 % 1_000_000;
  const miles = Math.floor(resto2 / 1000);
  const unidades = resto2 % 1000;

  if (billones > 0) {
    bloques.push(billones === 1 ? "un billón" : `${hasta999(billones, true)} billones`);
  }
  if (millones > 0) {
    // 🔴 `true`: "millones" es un sustantivo masculino, así que el número que lo precede se
    // apocopa. Sin esto salía "VEINTIUNO MILLONES" y "TREINTA Y UNO MILLONES" — en el
    // pagaré, que es donde la letra le gana al número.
    bloques.push(millones === 1 ? "un millón" : `${enteroALetras(millones, true)} millones`);
  }
  if (miles > 0) {
    // "mil", nunca "un mil".
    bloques.push(miles === 1 ? "mil" : `${hasta999(miles, true)} mil`);
  }
  if (unidades > 0) bloques.push(hasta999(unidades, apocope));

  return bloques.join(" ");
}

/**
 * Importe completo tal como va en un pagaré o contrato:
 *   1273684.21 → "PESOS UN MILLÓN DOSCIENTOS SETENTA Y TRES MIL SEISCIENTOS OCHENTA Y CUATRO CON 21/100"
 *
 * Los centavos van como fracción sobre 100 (la forma usada en instrumentos argentinos),
 * no en letras: "CON 21/100" y no "con veintiún centavos".
 *
 * @param monto  importe en pesos. Se redondea a 2 decimales antes de escribirlo, para que
 *               la letra coincida SIEMPRE con el número impreso al lado.
 * @param moneda etiqueta de la moneda; "PESOS" por defecto.
 */
export function montoALetras(monto: number, moneda = "PESOS"): string {
  if (!Number.isFinite(monto)) throw new Error("Importe inválido para escribir en letras");
  if (monto < 0) throw new Error("Un importe negativo no puede ir en un instrumento de pago");

  // Se redondea PRIMERO: si la letra saliera del valor sin redondear y el número impreso
  // del redondeado, el documento se contradiría a sí mismo — y ante la duda vale la letra.
  const centavosTotales = Math.round(monto * 100);
  const entero = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;

  const letras = `${moneda} ${enteroALetras(entero)} con ${String(centavos).padStart(2, "0")}/100`;
  return letras.toUpperCase();
}

/** Versión en minúscula, para textos corridos dentro del contrato. */
export function montoALetrasMinuscula(monto: number, moneda = "pesos"): string {
  return montoALetras(monto, moneda).toLowerCase();
}

/**
 * Importe en letras para LEER EN PANTALLA — distinto del formato de documento.
 *
 *   500000    → "quinientos mil pesos"
 *   367391.30 → "trescientos sesenta y siete mil trescientos noventa y un pesos con treinta centavos"
 *   1000000   → "un millón de pesos"
 *
 * Tres diferencias con `montoALetras`, y las tres son porque acá se lee, no se firma:
 *  1. La moneda va DETRÁS, así que el número se apocopa ("un peso", no "uno peso").
 *  2. Los centavos van en palabras, no como fracción: "con treinta centavos" se entiende
 *     de un vistazo, "con 30/100" es jerga de instrumento de pago.
 *  3. Si no hay centavos, no se los nombra.
 *
 * Sirve como control de lectura antes de otorgar: un cero de más pasa desapercibido entre
 * los dígitos y salta enseguida en las palabras.
 */
export function montoEnPalabras(monto: number, singular = "peso", plural = "pesos"): string {
  if (!Number.isFinite(monto)) return "";

  const negativo = monto < 0;
  const centavosTotales = Math.round(Math.abs(monto) * 100);
  const entero = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;

  const letras = enteroALetras(entero, true);
  /**
   * "millón" y "billón" son sustantivos y piden **de** antes de la moneda: se dice "un millón
   * DE pesos", pero "mil pesos" sin nada en el medio. Y solo cuando el número termina ahí —
   * "un millón doscientos mil pesos" no lo lleva, porque el sustantivo que manda pasó a ser
   * "mil". Por eso se mira el final del texto ya armado, no la magnitud.
   */
  const pideDe = /(mill(ón|ones)|bill(ón|ones))$/.test(letras);
  let texto = `${letras} ${pideDe ? "de " : ""}${entero === 1 ? singular : plural}`;

  if (centavos > 0) {
    texto += ` con ${enteroALetras(centavos, true)} ${centavos === 1 ? "centavo" : "centavos"}`;
  }

  return negativo ? `menos ${texto}` : texto;
}
