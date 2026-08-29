/**
 * El texto del certificado de libre deuda. UNA sola definición.
 *
 * Vivía dentro del componente del diálogo, que es `"use client"`, así que el PDF —que se
 * arma en el servidor— no podía usarlo: habría terminado con su propia copia del párrafo.
 * Dos redacciones del mismo certificado es exactamente el problema que este archivo evita;
 * la pantalla y el papel tienen que decir lo mismo, palabra por palabra.
 *
 * Módulo PURO (solo formateo), para que lo puedan importar el cliente y el Route Handler.
 */
import { formatCreditoNumero, formatFecha } from "@/lib/utils";
import { montoALetras } from "@/lib/domain/numero-a-letras";

/**
 * Lo mínimo que el párrafo necesita. Se declara estructural —y no como el tipo de la API—
 * para que el servidor pueda pasarle sus propios datos sin construir la respuesta completa.
 */
export interface LibreDeudaTexto {
  empresa: string;
  cliente: { nombre: string; documento: string | null };
  credito: {
    numero: number | null;
    refinancia_a_numero?: number | null;
    monto_original: number;
    fecha_otorgamiento: string | Date;
  };
  totales: {
    total_pagado: number;
    cuotas: number;
    fecha_cancelacion: string | Date | null;
  };
}

const n2 = (x: number) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);

/**
 * 🔴 LOS DOS IMPORTES, CADA UNO CON SU NOMBRE.
 *
 * Decía "ha cancelado en su totalidad el crédito CRD-000003, otorgado el 02/07/2026 por un
 * monto de $600.000" — y "por un monto de" se lee pegado a *cancelado*, no a *otorgado*: el
 * papel parecía decir que el cliente pagó $600.000 cuando pagó $1.253.341,90. El desglose de
 * la tabla lo desmentía, pero el párrafo es lo que se lee primero.
 *
 * Son dos hechos distintos y ninguno reemplaza al otro: el CAPITAL identifica la operación
 * (lo que el cliente se llevó) y el TOTAL ABONADO es lo que efectivamente pagó — capital +
 * interés pactado + punitorios. Van los dos, nombrados.
 *
 * En letras además de en números, como todo instrumento: ante una discrepancia entre la cifra
 * y la letra, prevalece la letra. `montoALetras` redondea antes de escribir, así que el texto
 * no puede contradecir al número impreso al lado.
 */
export function libreDeudaTexto(ld: LibreDeudaTexto): string {
  const nro = formatCreditoNumero(ld.credito.numero, ld.credito.refinancia_a_numero);
  const cancel = ld.totales.fecha_cancelacion ? formatFecha(ld.totales.fecha_cancelacion) : "—";
  const capital = ld.credito.monto_original;
  const abonado = ld.totales.total_pagado;
  const cuotas = ld.totales.cuotas;

  return (
    `Se certifica que ${ld.cliente.nombre}${ld.cliente.documento ? ` (DNI ${ld.cliente.documento})` : ""} ` +
    `ha cancelado en su totalidad el crédito ${nro}, ` +
    `otorgado el ${formatFecha(ld.credito.fecha_otorgamiento)} ` +
    `por un capital de $${n2(capital)} (${montoALetras(capital)}) ` +
    `en ${cuotas} cuota${cuotas !== 1 ? "s" : ""}, ` +
    `habiendo abonado un total de $${n2(abonado)} (${montoALetras(abonado)}) ` +
    `según el detalle que se acompaña. ` +
    `El crédito se encuentra CANCELADO al ${cancel} y el cliente no registra deuda pendiente ` +
    `con ${ld.empresa} respecto de esta operación.`
  );
}
