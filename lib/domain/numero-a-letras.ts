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

/** Parte entera en letras. Soporta hasta billones (millón de millones, escala larga). */
function enteroALetras(n: number): string {
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
    bloques.push(millones === 1 ? "un millón" : `${enteroALetras(millones)} millones`);
  }
  if (miles > 0) {
    // "mil", nunca "un mil".
    bloques.push(miles === 1 ? "mil" : `${hasta999(miles, true)} mil`);
  }
  if (unidades > 0) bloques.push(hasta999(unidades, false));

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
