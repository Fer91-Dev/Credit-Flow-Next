/**
 * El PAGARÉ del crédito y la información del art. 36 de la Ley 24.240 que lo acompaña.
 *
 * Parte del papel que Silvio usaba en la calle (`PAGARE + mutuo.pdf`) y lo adapta a lo que el
 * sistema cobra DE VERDAD. Todo sale de datos del crédito que quedaron CONGELADOS al otorgar
 * —cuotas persistidas, cargos, convención de la tasa, condiciones de mora—, nunca de la
 * configuración vigente: un documento reimpreso dentro de un año tiene que decir lo mismo que
 * el que se firmó.
 *
 * Lo que cambia respecto del papel original, y por qué:
 *  - **"Dec. Ley 5965/13" → "5965/63".** Errata del original.
 *  - **"Tasa directa" → "sistema francés".** Es el que calcula el motor y el que Silvio cobra
 *    (decidido el 05/08/2026: el documento se adapta al sistema, no al revés).
 *  - **El punitorio sale de la mora del crédito**, no de un número suelto: el papel no puede
 *    declarar un porcentaje y la caja cobrar otro.
 *  - **Sin "interés compensatorio" ni "gastos de gestión de cobranza".** El sistema no los
 *    cobra; declararlos en un papel firmado es darle al deudor una discusión gratis.
 *  - **El inciso b se decide solo:** en efectivo se aclara que no aplica; en un crédito de
 *    producto se describe el bien y su precio de contado, que es lo que la ley pide.
 *
 * El pagaré va "A LA VISTA" y por el TOTAL de las cuotas (decisión del 27/09/2026): con
 * vencimiento en la última cuota, un cliente que deja de pagar en la 2 de 12 no se podría
 * ejecutar hasta que venza la 12. La cláusula que amplía el plazo de presentación
 * (`anios_presentacion`) es la que evita que un pagaré a la vista guardado caduque al año.
 *
 * Dominio PURO: recibe todo ya cargado. El PDF (`lib/pdf/pagare.ts`) solo dibuja lo que esto
 * devuelve, así el texto se puede verificar sin generar un archivo.
 */
import { montoALetras } from "./numero-a-letras";
import type { DocumentosConfig } from "./documentos";

export interface PersonaPagare {
  /** Nombre y apellido (deudor) o nombre/razón social del titular (acreedor). */
  nombre: string;
  /** DNI del deudor, o CUIT/CUIL del acreedor. Vacío = no se imprime. */
  documento: string | null;
  /** Domicilio completo en un renglón. */
  domicilio: string;
  localidad: string | null;
  provincia: string | null;
}

export interface CuotaPagare {
  nro: number;
  vencimiento: Date;
  total: number;
}

export interface DatosPagare {
  /** "CRD-000014" o "REF-000015". */
  numero: string;
  /** Día en que se firmó: la fecha de creación del pagaré. NO la de la reimpresión. */
  fechaOtorgamiento: Date;
  acreedor: PersonaPagare;
  deudor: PersonaPagare;
  tipo: "efectivo" | "producto" | "refinanciacion";
  /** Producto financiado (solo tipo "producto"): se describe por el inciso b. */
  producto?: { nombre: string; cantidad: number } | null;
  /** Crédito que esta refinanciación reemplaza (solo tipo "refinanciacion"). */
  refinanciaA?: string | null;
  /** Capital: lo prestado (efectivo), el precio de contado (producto) o la deuda consolidada. */
  capital: number;
  /** Las cuotas tal como se cobran (persistidas), con todos sus cargos. */
  cuotas: CuotaPagare[];
  /** Total de intereses del plan. */
  totalIntereses: number;
  /** Cargos del plan, discriminados. Los que están en 0 no se imprimen. */
  cargos: {
    comision: number;
    /** true = va adentro de las cuotas; false = se paga al firmar. */
    comisionFinanciada: boolean;
    iva: number;
    seguro: number;
    gastos: number;
    honorarios: number;
  };
  frecuenciaLabel: string;
  /** Tasa efectiva anual, en fracción (1,4523 = 145,23%). */
  tea: number;
  /** Costo financiero total anual, en fracción. null = no se pudo calcular. */
  cft: number | null;
  mora: { activa: boolean; tasaDiaria: number; diasGracia: number; topePct: number };
  documentos: DocumentosConfig;
}

/** Un bloque de la información del art. 36: un título corto y su texto. */
export interface ClausulaPagare {
  titulo: string;
  texto: string;
}

export interface TextoPagare {
  titulo: string;
  /** Importe del pagaré (el total a pagar). null = modo "sin monto", se completa al ejecutar. */
  importe: number | null;
  /** Importe escrito, en mayúsculas. null en modo "sin monto". */
  importeLetras: string | null;
  /** "San Miguel de Tucumán, 26 de septiembre de 2026". */
  lugarYFecha: string;
  /** El cuerpo del pagaré: la promesa de pago. */
  cuerpo: string;
  /** Dónde se paga. */
  lugarDePago: string;
  /** Intereses del art. 5 desde la presentación. null = sin la cláusula (apagada o sin mora). */
  intereses: string | null;
  /** Ampliación del plazo de presentación. null = sin la cláusula (rige el año de la ley). */
  presentacion: string | null;
  /** Leyenda del encabezado de las condiciones, si la entidad está autorizada por el BCRA. */
  leyendaBcra: string | null;
  condiciones: ClausulaPagare[];
  /** Cierre del art. 36: "En San Miguel de Tucumán, a los 26 días del mes de septiembre de 2026". */
  cierre: string;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * Las fechas del crédito son días (`@db.Date`, medianoche UTC): se leen en UTC. En hora
 * argentina caerían en el día anterior.
 */
const dia = (d: Date) => d.getUTCDate();
const mes = (d: Date) => MESES[d.getUTCMonth()];
const anio = (d: Date) => d.getUTCFullYear();
const fecha = (d: Date) => `${String(dia(d)).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${anio(d)}`;

const pesos = (n: number) =>
  "$" + new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pct = (fraccion: number) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(fraccion * 100) + "%";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "Juan Pérez, DNI 30.123.456" — el documento solo si está. */
const identificado = (p: PersonaPagare, etiqueta: string) =>
  p.documento ? `${p.nombre}, ${etiqueta} ${p.documento}` : p.nombre;

/** CUIT/CUIL (11 dígitos) o DNI: el acreedor puede ser una empresa o una persona. */
const etiquetaDocumento = (doc: string | null) => ((doc ?? "").replace(/\D/g, "").length === 11 ? "CUIT/CUIL" : "DNI");

/** Total que se promete pagar: la suma de las cuotas tal como se cobran. */
export function totalPagare(cuotas: CuotaPagare[]): number {
  return round2(cuotas.reduce((s, c) => s + c.total, 0));
}

/**
 * "12 cuotas mensuales de $95.000,00" o, si no son todas iguales (redondeo, última cuota
 * ajustada), "12 cuotas mensuales: 11 de $95.000,00 y 1 de $94.812,40".
 */
export function describirCuotas(cuotas: CuotaPagare[], frecuenciaLabel: string): string {
  const n = cuotas.length;
  const plural = n === 1 ? "cuota" : "cuotas";
  const frec = n === 1 ? frecuenciaLabel : pluralizarFrecuencia(frecuenciaLabel);
  const grupos = new Map<number, number>();
  for (const c of cuotas) grupos.set(round2(c.total), (grupos.get(round2(c.total)) ?? 0) + 1);
  if (grupos.size === 1) return `${n} ${plural} ${frec} de ${pesos(cuotas[0].total)}`;
  const partes = [...grupos.entries()].map(([monto, cant]) => `${cant} de ${pesos(monto)}`);
  const ultima = partes.pop();
  return `${n} ${plural} ${frec}: ${partes.join(", ")} y ${ultima}`;
}

/** "mensual" → "mensuales", "quincenal" → "quincenales", "diaria" → "diarias". */
function pluralizarFrecuencia(label: string): string {
  const l = label.trim();
  if (/[aeiou]$/i.test(l)) return `${l}s`;
  return `${l}es`;
}

export function armarPagare(d: DatosPagare): TextoPagare {
  const docs = d.documentos;
  const total = totalPagare(d.cuotas);
  const conMonto = docs.modo_pagare === "con_monto";
  const lugar = d.acreedor.localidad?.trim() || "";
  const lugarYFecha = `${lugar ? `${lugar}, ` : ""}${dia(d.fechaOtorgamiento)} de ${mes(d.fechaOtorgamiento)} de ${anio(d.fechaOtorgamiento)}`;

  // ── El pagaré ──────────────────────────────────────────────────────────
  const sinProtesto = docs.sin_protesto ? " sin protesto (art. 50, Dec. Ley 5965/63)" : "";
  const cantidad = conMonto
    ? `la cantidad de ${montoALetras(total)} (${pesos(total)})`
    : "la cantidad de pesos ______________________________________________ ($ ______________)";
  const valor = d.tipo === "producto"
    ? "por igual valor recibido en mercadería"
    : d.tipo === "refinanciacion"
      ? "por igual valor recibido"
      : "por igual valor recibido en dinero efectivo";
  const cuerpo =
    `A la vista pagaré${sinProtesto} a ${identificado(d.acreedor, etiquetaDocumento(d.acreedor.documento))} ` +
    `o a su orden, ${cantidad}, ${valor} a mi entera satisfacción.`;
  const lugarDePago =
    `Pagadero en ${d.acreedor.domicilio}${d.acreedor.localidad ? `, de la ciudad de ${d.acreedor.localidad}` : ""}` +
    `${d.acreedor.provincia ? `, Provincia de ${d.acreedor.provincia}` : ""}.`;
  /*
    ART. 5: el pagaré a la vista puede devengar intereses si la tasa está escrita en él. Es la
    misma tasa de mora del crédito (congelada al otorgar), así que papel y sistema dicen lo
    mismo. Desde la PRESENTACIÓN: desde la firma duplicaría el interés de las cuotas. Sin mora
    activa no hay tasa que escribir, y el art. 5 da por no escrita una cláusula sin tasa.
  */
  const intereses = docs.intereses_art5 && d.mora.activa && d.mora.tasaDiaria > 0
    ? `Desde su presentación al cobro y hasta su efectivo pago, esta suma devengará un interés punitorio del ` +
      `${pct(d.mora.tasaDiaria)} diario, equivalente al ${pct(d.mora.tasaDiaria * 30)} mensual (art. 5, Dec. Ley 5965/63).`
    : null;

  /*
    Sin la ampliación rige el plazo de la ley (un año desde el libramiento): no hay nada que
    declarar. Imprimir "se amplía a 1 año" sería una cláusula que no amplía nada.
  */
  const presentacion = docs.anios_presentacion > 1
    ? `Conforme al art. 36 del Dec. Ley 5965/63, se amplía a ${docs.anios_presentacion} años desde su ` +
      "libramiento el plazo para presentarlo al pago."
    : null;

  // ── Información del art. 36 de la Ley 24.240 ───────────────────────────
  const c: ClausulaPagare[] = [];
  const primera = d.cuotas[0];
  const ultima = d.cuotas[d.cuotas.length - 1];

  c.push({
    titulo: "Partes",
    texto:
      `Acreedor: ${identificado(d.acreedor, etiquetaDocumento(d.acreedor.documento))}, ` +
      `con domicilio en ${domicilioCompleto(d.acreedor)}. ` +
      `Deudor: ${identificado(d.deudor, "DNI")}, con domicilio en ${domicilioCompleto(d.deudor)}.`,
  });

  if (d.tipo === "producto") {
    const p = d.producto;
    c.push({
      titulo: "Objeto (inc. a y b)",
      texto:
        `Financiación de la compra de ${p ? `${p.cantidad} × ${p.nombre}` : "los bienes detallados"}, ` +
        `cuyo precio de contado es de ${pesos(d.capital)}. El deudor declara haber recibido los bienes de conformidad.`,
    });
  } else if (d.tipo === "refinanciacion") {
    c.push({
      titulo: "Objeto (inc. a)",
      texto:
        `Refinanciación de la deuda del crédito ${d.refinanciaA ?? "anterior"}, que queda cancelado y reemplazado ` +
        `por el presente. No hay entrega de dinero: la deuda consolidada es de ${pesos(d.capital)}. ` +
        `El inciso b no es de aplicación por no tratarse de la adquisición de bienes o servicios.`,
    });
  } else {
    c.push({
      titulo: "Objeto (inc. a)",
      texto:
        `Préstamo de dinero en efectivo. El deudor declara recibir en este acto la suma de ${pesos(d.capital)}. ` +
        `El inciso b no es de aplicación por no tratarse de un crédito para la adquisición de bienes o servicios.`,
    });
  }

  const comisionAlFirmar = d.cargos.comision > 0 && !d.cargos.comisionFinanciada ? d.cargos.comision : 0;
  c.push({
    titulo: "Monto financiado (inc. c)",
    texto:
      `${pesos(d.capital)}` +
      (d.cargos.comision > 0 && d.cargos.comisionFinanciada
        ? `, más ${pesos(d.cargos.comision)} de comisión de otorgamiento que se financia dentro de las cuotas.`
        : ".") +
      (comisionAlFirmar > 0 ? ` La comisión de otorgamiento de ${pesos(comisionAlFirmar)} se abona al firmar.` : ""),
  });

  c.push({
    titulo: "Pagos (inc. g)",
    texto:
      `${capitalizar(describirCuotas(d.cuotas, d.frecuenciaLabel))}, consecutivas, ` +
      (d.cuotas.length === 1
        ? `con vencimiento el ${fecha(primera.vencimiento)}.`
        : `la primera con vencimiento el ${fecha(primera.vencimiento)} y la última el ${fecha(ultima.vencimiento)}, ` +
          `según el cronograma que se detalla al pie.`) +
      ` Total a pagar: ${pesos(total)}.`,
  });

  c.push({
    titulo: "Intereses y tasas (inc. d y e)",
    texto:
      `El total de intereses a pagar es de ${pesos(d.totalIntereses)}. Tasa efectiva anual (T.E.A.): ${pct(d.tea)}.` +
      (d.cft != null ? ` Costo financiero total (C.F.T.) efectivo anual: ${pct(d.cft)}.` : ""),
  });

  c.push({
    titulo: "Sistema de amortización (inc. f)",
    texto: "Sistema francés: cuota de capital e interés constante; cada cuota cancela primero el interés del período y el resto amortiza capital.",
  });

  const cargos: string[] = [];
  if (d.cargos.comision > 0) cargos.push(`comisión de otorgamiento ${pesos(d.cargos.comision)}`);
  if (d.cargos.iva > 0) cargos.push(`IVA sobre intereses ${pesos(d.cargos.iva)}`);
  if (d.cargos.seguro > 0) cargos.push(`seguro ${pesos(d.cargos.seguro)}`);
  if (d.cargos.gastos > 0) cargos.push(`gastos administrativos ${pesos(d.cargos.gastos)}`);
  if (d.cargos.honorarios > 0) cargos.push(`honorarios de gestión de cobranza ${pesos(d.cargos.honorarios)}`);
  c.push({
    titulo: "Gastos y cargos (inc. h)",
    texto: cargos.length
      ? `${capitalizar(cargos.join("; "))}. Todos están incluidos en el total a pagar${comisionAlFirmar > 0 ? ", salvo la comisión que se abona al firmar" : ""}.`
      : "No se cobran gastos, seguros ni cargos adicionales.",
  });

  const m = d.mora;
  const mensual = m.tasaDiaria * 30;
  c.push({
    titulo: "Mora",
    texto:
      "La falta de pago en término constituirá en mora al deudor de pleno derecho, sin necesidad de interpelación alguna. " +
      (m.activa && m.tasaDiaria > 0
        ? `Cada cuota vencida e impaga devengará un interés punitorio del ${pct(m.tasaDiaria)} diario sobre su importe ` +
          `(${pct(mensual)} mensual)` +
          (m.diasGracia > 0 ? `, pasados ${m.diasGracia} ${m.diasGracia === 1 ? "día" : "días"} de gracia desde el vencimiento` : ", desde su vencimiento") +
          (m.topePct > 0 ? `, con un tope del ${pct(m.topePct / 100)} del importe de la cuota` : "") +
          "."
        : "El atraso no devenga interés punitorio."),
  });

  c.push({
    titulo: "Imputación de los pagos",
    texto: "Cada pago se aplica a la cuota más antigua y, dentro de ella, primero a punitorios, luego a intereses y cargos, y por último a capital (art. 903 del Código Civil y Comercial).",
  });

  if (docs.cuotas_caducidad > 0) {
    c.push({
      titulo: "Caducidad de plazos",
      texto:
        `La falta de pago de ${docs.cuotas_caducidad} ${docs.cuotas_caducidad === 1 ? "cuota" : "cuotas"}, consecutivas o alternadas, ` +
        "producirá la caducidad de todos los plazos y hará exigible el total adeudado, con sus intereses y punitorios.",
    });
  }

  c.push({
    titulo: "Pagaré",
    texto: conMonto
      ? `En garantía de este crédito el deudor libra un pagaré a la vista por ${pesos(total)}. ` +
        "El acreedor solo podrá reclamar por él el saldo que el deudor no haya pagado, con los intereses y punitorios aquí pactados."
      /*
        🔴 EN BLANCO, la autorización para completarlo tiene que estar ESCRITA y firmada. Un
        pagaré librado sin monto se completa después (art. 11, Dec. Ley 5965/63); si el deudor
        no autorizó por escrito cómo, puede impugnar lo que se puso. Acá queda el criterio:
        el saldo impago según este contrato, a la fecha de presentación.
      */
      : "En garantía de este crédito el deudor libra un pagaré a la vista con el importe en blanco, y autoriza " +
        "expresamente al acreedor a completarlo, al presentarlo al cobro, por el saldo que adeude a esa fecha según " +
        "este contrato: las cuotas impagas, con sus intereses y los punitorios aquí pactados" +
        // Solo si la caducidad está pactada: sin ella no hay "total exigible" que invocar.
        (docs.cuotas_caducidad > 0 ? ", y el total si operó la caducidad de plazos" : "") +
        ". El pagaré no podrá completarse por un importe mayor.",
  });

  if (docs.actualiza_por_ipc) {
    c.push({
      titulo: "Actualización",
      texto: "Las sumas adeudadas en mora se actualizarán por el Índice de Precios al Consumidor (IPC) que publica el INDEC, además del interés punitorio.",
    });
  }
  if (docs.incluye_cesion_credito) {
    c.push({
      titulo: "Cesión",
      texto: "El acreedor podrá ceder este crédito sin necesidad de notificar al deudor, en los términos de los arts. 70 a 72 de la Ley 24.441.",
    });
  }
  if (docs.incluye_autorizacion_informes) {
    c.push({
      titulo: "Informes",
      texto: "El deudor autoriza al acreedor a informar su comportamiento de pago a bases de datos de antecedentes crediticios, conforme a la Ley 25.326.",
    });
  }
  c.push({
    titulo: "Domicilios",
    texto: "Las partes constituyen domicilio en los indicados arriba, donde serán válidas todas las notificaciones.",
  });
  if (docs.jurisdiccion.trim()) {
    c.push({
      titulo: "Jurisdicción",
      texto: `Para cualquier controversia, las partes se someten a ${docs.jurisdiccion.trim()}, con renuncia a cualquier otro fuero.`,
    });
  }
  if (docs.clausulas_extra.trim()) {
    c.push({ titulo: "Otras condiciones", texto: docs.clausulas_extra.trim() });
  }

  const cierre =
    `En ${lugar || "________________"}, a los ${dia(d.fechaOtorgamiento)} días del mes de ${mes(d.fechaOtorgamiento)} de ${anio(d.fechaOtorgamiento)}, ` +
    "se firman dos ejemplares de estas condiciones, uno para cada parte. El pagaré se firma en un " +
    // 🔴 Un pagaré firmado dos veces son DOS títulos por la misma deuda. Si alguien imprime
    // el PDF dos veces para dar copia al cliente, la hoja 1 de la copia no se firma.
    "único ejemplar, que conserva el acreedor.";

  return {
    titulo: docs.sin_protesto ? "PAGARÉ SIN PROTESTO" : "PAGARÉ",
    importe: conMonto ? total : null,
    importeLetras: conMonto ? montoALetras(total) : null,
    lugarYFecha,
    cuerpo,
    lugarDePago,
    intereses,
    presentacion,
    // Va en el encabezado, como dice Configuración → Documentos: es un dato de quién presta,
    // no una condición del préstamo.
    leyendaBcra: docs.autorizada_bcra ? "Entidad autorizada por el Banco Central de la República Argentina" : null,
    condiciones: c,
    cierre,
  };
}

/** "Av. Siempreviva 742, San Miguel de Tucumán, Tucumán". */
export function domicilioCompleto(p: PersonaPagare): string {
  return [p.domicilio, p.localidad, p.provincia].map((s) => s?.trim()).filter(Boolean).join(", ");
}

const capitalizar = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
