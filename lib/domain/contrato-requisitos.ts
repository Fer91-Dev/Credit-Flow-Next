/**
 * Qué datos faltan para poder emitir el contrato y el pagaré de un crédito.
 *
 * La regla es **no emitir un documento débil**. Un contrato al que le falta el domicilio del
 * deudor se firma igual y parece válido, pero cuando hay que reclamar no se sabe dónde
 * notificarlo; y al pagaré, si le falta un requisito formal, **deja de ser pagaré** y pierde
 * su única ventaja: ejecutarlo sin discutir la deuda (Dec. Ley 5965/63, art. 101 y 102).
 * Es peor que no tenerlo, porque da una falsa sensación de respaldo.
 *
 * Dominio PURO: recibe los datos ya cargados, no consulta la base.
 */

export type Severidad = "bloqueante" | "advertencia";

export interface FaltanteContrato {
  campo: string;
  /** Qué falta, en las palabras del usuario, no del modelo de datos. */
  detalle: string;
  /** Por qué importa: sin esto, el mensaje es una traba burocrática sin sentido. */
  porque: string;
  severidad: Severidad;
  /** Dónde se completa. */
  donde: string;
}

export interface DatosParaContrato {
  financiera: {
    razon_social?: string | null;
    cuit?: string | null;
    direccion?: string | null;
    localidad?: string | null;
    provincia?: string | null;
  };
  cliente: {
    nombre?: string | null;
    apellido?: string | null;
    documento?: string | null;
    direccion?: string | null;
    localidad?: string | null;
    provincia?: string | null;
  };
  credito: {
    monto_original?: number | null;
    cuotas: number;
  };
}

const vacio = (v: unknown) => typeof v !== "string" || v.trim() === "";

/**
 * Devuelve todo lo que falta. Lista vacía = se puede emitir.
 *
 * Se devuelven TODOS los faltantes de una, no el primero: si se informara de a uno, el
 * usuario tendría que ir y volver de la ficha cinco veces para enterarse del quinto.
 */
export function faltantesParaContrato(d: DatosParaContrato): FaltanteContrato[] {
  const faltan: FaltanteContrato[] = [];

  // ── La financiera: es quien reclama, y tiene que estar identificada ──
  if (vacio(d.financiera.razon_social)) {
    faltan.push({
      campo: "razon_social",
      detalle: "Falta la razón social de la financiera",
      porque: "Es quien figura como acreedor. El nombre comercial no alcanza para un contrato.",
      severidad: "bloqueante",
      donde: "Configuración → Datos de la financiera",
    });
  }
  if (vacio(d.financiera.cuit)) {
    faltan.push({
      campo: "cuit",
      detalle: "Falta el CUIT de la financiera",
      porque: "Identifica al acreedor ante la AFIP y ante un juez.",
      severidad: "bloqueante",
      donde: "Configuración → Datos de la financiera",
    });
  }
  if (vacio(d.financiera.direccion) || vacio(d.financiera.localidad)) {
    faltan.push({
      campo: "domicilio_financiera",
      detalle: "Falta el domicilio de la financiera",
      porque: "El pagaré necesita un LUGAR DE PAGO. Sin él deja de ser pagaré.",
      severidad: "bloqueante",
      donde: "Configuración → Datos de la financiera",
    });
  }

  // ── El cliente: es a quien hay que poder identificar y notificar ──
  if (vacio(d.cliente.nombre) || vacio(d.cliente.apellido)) {
    faltan.push({
      campo: "nombre_cliente",
      detalle: "El cliente tiene que tener nombre y apellido cargados",
      porque: "Es el deudor: sin apellido no queda identificado en el documento.",
      severidad: "bloqueante",
      donde: "Ficha del cliente → Editar",
    });
  }
  if (vacio(d.cliente.documento)) {
    faltan.push({
      campo: "documento",
      detalle: "Falta el DNI del cliente",
      porque: "Es lo que lo identifica sin ambigüedad. Dos personas pueden llamarse igual.",
      severidad: "bloqueante",
      donde: "Ficha del cliente → Editar",
    });
  }
  if (vacio(d.cliente.direccion) || vacio(d.cliente.localidad)) {
    faltan.push({
      campo: "domicilio_cliente",
      detalle: "Falta el domicilio del cliente",
      porque:
        "Es el domicilio donde se lo notifica si hay que reclamarle. Sin esto el contrato " +
        "se firma igual, pero a la hora de cobrar no se sabe dónde mandarle la intimación.",
      severidad: "bloqueante",
      donde: "Ficha del cliente → Editar",
    });
  }

  // ── El crédito ──
  if (!d.credito.monto_original || d.credito.monto_original <= 0) {
    faltan.push({
      campo: "monto",
      detalle: "El crédito no tiene un importe válido",
      porque: "Un pagaré exige una suma determinada.",
      severidad: "bloqueante",
      donde: "El crédito",
    });
  }
  if (d.credito.cuotas <= 0) {
    faltan.push({
      campo: "cuotas",
      detalle: "El crédito no tiene cuotas generadas",
      porque: "Sin cronograma no hay plazo de pago que declarar.",
      severidad: "bloqueante",
      donde: "El crédito",
    });
  }

  // ── Advertencias: no impiden emitir, pero conviene saberlas ──
  if (vacio(d.cliente.provincia)) {
    faltan.push({
      campo: "provincia_cliente",
      detalle: "El cliente no tiene provincia cargada",
      porque: "El domicilio queda incompleto y puede discutirse la competencia territorial.",
      severidad: "advertencia",
      donde: "Ficha del cliente → Editar",
    });
  }

  return faltan;
}

/** ¿Se puede emitir? Solo si no hay ningún faltante bloqueante. */
export function puedeEmitirContrato(faltantes: FaltanteContrato[]): boolean {
  return !faltantes.some((f) => f.severidad === "bloqueante");
}
