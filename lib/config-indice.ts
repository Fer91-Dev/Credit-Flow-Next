/**
 * ÍNDICE DE PARÁMETROS de Configuración, para el buscador de esa pantalla.
 *
 * Son 11 pestañas y más de 90 parámetros: sin buscador, encontrar "días de gracia" implica
 * acordarse de que vive en Simulador y no en Motor. Acá cada parámetro dice en qué pestaña
 * y en qué bloque está, para poder llevar al usuario hasta él.
 *
 * 🔴 SE GENERÓ LEYENDO EL PROPIO ConfigForm (las etiquetas de cada Field y SwitchRow), no
 * a mano. Si se agrega un parámetro nuevo hay que sumarlo acá: el buscador no lo va a
 * encontrar solo. Un índice incompleto es peor que no tener buscador, porque el que busca
 * y no encuentra concluye que el parámetro no existe.
 */
export type TabConfig =
  | "financiera" | "motor" | "simulador" | "comunicaciones" | "gamificacion" | "rentabilidad"
  | "riesgo" | "cobranza" | "cajas" | "documentos" | "notificaciones" | "backups";

export interface ParametroIndexado {
  /** Etiqueta tal como se ve en pantalla. */
  label: string;
  /** Pestaña donde vive. */
  tab: TabConfig;
  /** Título del bloque: ubica el parámetro dentro de la pestaña y da el ancla de scroll. */
  seccion: string;
}

/** Nombre del ancla de una sección. Se deriva del título, así que no hay que declararla. */
export function anclaSeccion(titulo: string): string {
  return "cfg-" + titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const PARAMETROS: ParametroIndexado[] = [
  { label: "Moneda", tab: "financiera", seccion: "Presentación" },
  { label: "Región (locale)", tab: "financiera", seccion: "Presentación" },
  { label: "Convención de tasa", tab: "motor", seccion: "Motor financiero" },
  { label: "Sistema de amortización", tab: "motor", seccion: "Motor financiero" },
  { label: "Monto ($)", tab: "simulador", seccion: "Financiación del simulador" },
  { label: "Tasa (% …)", tab: "simulador", seccion: "Financiación del simulador" },
  { label: "Monto mínimo ($)", tab: "simulador", seccion: "Financiación del simulador" },
  { label: "Monto máximo ($)", tab: "simulador", seccion: "Financiación del simulador" },
  { label: "Tasa mínima (%)", tab: "simulador", seccion: "Financiación del simulador" },
  { label: "Tasa máxima (%)", tab: "simulador", seccion: "Financiación del simulador" },
  { label: "Plan por defecto", tab: "simulador", seccion: "Planes de cuotas" },
  { label: "Frecuencia por defecto", tab: "simulador", seccion: "Frecuencias de pago" },
  { label: "Redondea", tab: "simulador", seccion: "Redondeo de cuota" },
  { label: "Múltiplo", tab: "simulador", seccion: "Redondeo de cuota" },
  { label: "Día de vencimiento", tab: "simulador", seccion: "Cronograma de cobranza" },
  { label: "Día de corte", tab: "simulador", seccion: "Cronograma de cobranza" },
  { label: "Días de gracia", tab: "simulador", seccion: "Cronograma de cobranza" },
  { label: "Domingo no hábil", tab: "simulador", seccion: "Cronograma de cobranza" },
  { label: "Sábado no hábil", tab: "simulador", seccion: "Cronograma de cobranza" },
  { label: "Comisión de otorgamiento", tab: "simulador", seccion: "Comisión de otorgamiento" },
  { label: "Modo", tab: "simulador", seccion: "Comisión de otorgamiento" },
  { label: "¿Financiada?", tab: "simulador", seccion: "Comisión de otorgamiento" },
  { label: "IVA sobre interés", tab: "simulador", seccion: "IVA sobre interés" },
  { label: "Tasa de IVA (%)", tab: "simulador", seccion: "IVA sobre interés" },
  { label: "Seguro", tab: "simulador", seccion: "Seguro" },
  { label: "Base", tab: "simulador", seccion: "Seguro" },
  { label: "Gastos administrativos", tab: "simulador", seccion: "Gastos administrativos" },
  { label: "Tasa de mora diaria (%)", tab: "motor", seccion: "Interés por mora" },
  { label: "Token de acceso permanente", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "Phone Number ID", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "Business Account ID (opcional)", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "Proveedor", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "API Key", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "Host SMTP", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "Puerto", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "Usuario", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "Contraseña", tab: "comunicaciones", seccion: "Canales de comunicación" },
  { label: "Período de evaluación", tab: "gamificacion", seccion: "Gamificación (medallas y logros)" },
  { label: "Costo de fondeo anual (%)", tab: "rentabilidad", seccion: "Rentabilidad (costo de fondeo)" },
  { label: "Otros costos mensuales ($)", tab: "rentabilidad", seccion: "Rentabilidad (costo de fondeo)" },
  { label: "Ratio cuota / ingreso máx (%)", tab: "riesgo", seccion: "Política de originación" },
  { label: "Tope de monto (× ingreso mensual)", tab: "riesgo", seccion: "Política de originación" },
  { label: "Situación BCRA máx aceptada", tab: "riesgo", seccion: "Política de originación" },
  { label: "Límite base sin bureau ($)", tab: "riesgo", seccion: "Política de originación" },
  { label: "Máx. créditos activos por cliente", tab: "riesgo", seccion: "Política de originación" },
  { label: "Máx. ediciones del sueldo (vendedor)", tab: "riesgo", seccion: "Política de originación" },
  { label: "Alerta por salto de sueldo (%)", tab: "riesgo", seccion: "Política de originación" },
  { label: "Score externo mínimo", tab: "riesgo", seccion: "Política de originación" },
  { label: "Si el cliente no califica", tab: "riesgo", seccion: "Política de originación" },
  { label: "Si el cliente no tiene sueldo cargado", tab: "riesgo", seccion: "Política de originación" },
  { label: "Bloquear si tiene cuotas vencidas impagas", tab: "riesgo", seccion: "Política de originación" },
  { label: "…pero un administrador puede autorizarlo igual", tab: "riesgo", seccion: "Política de originación" },
  { label: "Rechazar con cheques rechazados", tab: "riesgo", seccion: "Política de originación" },
  { label: "Rechazar con proceso judicial", tab: "riesgo", seccion: "Política de originación" },
  { label: "Revisar si refinanció en otra entidad", tab: "riesgo", seccion: "Política de originación" },
  { label: "Endpoint (URL base)", tab: "riesgo", seccion: "Política de originación" },
  { label: "Usuario (si aplica)", tab: "riesgo", seccion: "Política de originación" },
  { label: "Token / API key", tab: "riesgo", seccion: "Política de originación" },
  { label: "Consulta automática al evaluar", tab: "riesgo", seccion: "Política de originación" },
  { label: "Movimientos de caja", tab: "notificaciones", seccion: "Notificaciones del sistema" },
  { label: "Respaldos", tab: "notificaciones", seccion: "Notificaciones del sistema" },
  { label: "Plan y facturación", tab: "notificaciones", seccion: "Notificaciones del sistema" },
  { label: "Cobranza abierta", tab: "cobranza", seccion: "Quien puede cobrar" },
  { label: "Días sin gestión", tab: "cobranza", seccion: "Agenda de cobranza" },
  { label: "A quién llamar primero", tab: "cobranza", seccion: "Agenda de cobranza" },
  { label: "Mora media, hasta", tab: "cobranza", seccion: "Tramos de mora" },
  { label: "Máximo de cuotas", tab: "cobranza", seccion: "Acuerdos de pago" },
  { label: "Días entre cuotas", tab: "cobranza", seccion: "Acuerdos de pago" },
  { label: "Cuotas impagas que lo rompen", tab: "cobranza", seccion: "Acuerdos de pago" },
  { label: "Descuento máx. del vendedor (%)", tab: "cobranza", seccion: "Acuerdos de pago" },
  { label: "Congelar punitorios mientras cumple", tab: "cobranza", seccion: "Acuerdos de pago" },
  { label: "Sacarlo de la agenda del día mientras cumple", tab: "cobranza", seccion: "Acuerdos de pago" },
  { label: "El acuerdo se lleva todo el crédito", tab: "cobranza", seccion: "Acuerdos de pago" },
  { label: "Frenar los punitorios", tab: "cobranza", seccion: "Clientes fallecidos" },
  { label: "Bloquear el contacto", tab: "cobranza", seccion: "Clientes fallecidos" },
  { label: "Sacarlo de la agenda del día", tab: "cobranza", seccion: "Clientes fallecidos" },
  { label: "Días mínimos de atraso para refinanciar", tab: "cobranza", seccion: "Escalera de recupero" },
  { label: "Cobrar honorarios por gestión de cobranza al refinanciar", tab: "cobranza", seccion: "Escalera de recupero" },
  { label: "Honorarios (% de la deuda consolidada)", tab: "cobranza", seccion: "Escalera de recupero" },
  { label: "Exigir haberlo contactado antes de armar un acuerdo", tab: "cobranza", seccion: "Escalera de recupero" },
  { label: "No refinanciar por debajo de la tasa original", tab: "cobranza", seccion: "Escalera de recupero" },
  { label: "Exigir un acuerdo roto antes de refinanciar", tab: "cobranza", seccion: "Escalera de recupero" },
  { label: "Jurisdicción", tab: "documentos", seccion: "Documentos del crédito" },
  { label: "Pagaré", tab: "documentos", seccion: "Documentos del crédito" },
  { label: "Caducidad de plazos", tab: "documentos", seccion: "Documentos del crédito" },
  { label: "Sin protesto", tab: "documentos", seccion: "Documentos del crédito" },
  { label: "Actualizar por IPC del INDEC", tab: "documentos", seccion: "Documentos del crédito" },
  { label: "Autorización a pedir informes", tab: "documentos", seccion: "Documentos del crédito" },
  { label: "Cesión de crédito", tab: "documentos", seccion: "Documentos del crédito" },
  { label: "Entidad autorizada por el BCRA", tab: "documentos", seccion: "Documentos del crédito" },
  { label: "Cláusulas adicionales", tab: "documentos", seccion: "Documentos del crédito" },
];

/**
 * Entradas AGREGADAS A MANO. Son las que el extractor no puede ver porque viven en
 * componentes propios (`BackupsView`, los bloques de canales) o porque la palabra que la
 * gente usa no es la etiqueta: nadie busca "Proveedor", busca "whatsapp".
 *
 * 🔴 Van APARTE de las generadas y no mezcladas, para que la próxima regeneración del índice
 * no se las lleve puestas.
 */
const EXTRAS: ParametroIndexado[] = [
  { label: "WhatsApp (Meta Cloud API)", tab: "comunicaciones", seccion: "Comunicaciones" },
  { label: "Email (Resend / SMTP)",     tab: "comunicaciones", seccion: "Comunicaciones" },
  { label: "SMS",                       tab: "comunicaciones", seccion: "Comunicaciones" },
  { label: "Plantillas de mensajes",    tab: "comunicaciones", seccion: "Comunicaciones" },
  { label: "Respaldos / backup",        tab: "backups",        seccion: "Respaldos" },
  { label: "Restaurar un respaldo",     tab: "backups",        seccion: "Respaldos" },
  { label: "Cajas y arqueo",            tab: "cajas",          seccion: "Cajas" },
  { label: "Planes y plazos",           tab: "simulador",      seccion: "Plazos disponibles" },
  { label: "Frecuencias de pago",       tab: "simulador",      seccion: "Frecuencias de pago" },
  { label: "Feriados",                  tab: "simulador",      seccion: "Cronograma de cobranza" },
];

/** Normaliza para comparar sin tildes ni mayúsculas. */
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Busca por etiqueta, bloque o pestaña. Devuelve como máximo `tope`: una lista larga en un
 * desplegable no se lee, y pasados diez resultados lo que hace falta es afinar el texto.
 */
export function buscarParametros(q: string, tope = 10): ParametroIndexado[] {
  const t = norm(q.trim());
  if (t.length < 2) return [];
  const partes = t.split(/s+/);
  const puntaje = (p: ParametroIndexado) => {
    const label = norm(p.label), sec = norm(p.seccion), tab = norm(p.tab);
    if (!partes.every((w) => label.includes(w) || sec.includes(w) || tab.includes(w))) return -1;
    // Coincidir en la ETIQUETA vale más que en el nombre del bloque, y empezar con lo
    // buscado vale más que contenerlo en el medio.
    if (label.startsWith(t)) return 3;
    if (label.includes(t)) return 2;
    return 1;
  };
  return [...PARAMETROS, ...EXTRAS].map((p) => ({ p, s: puntaje(p) })).filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.p.label.localeCompare(b.p.label))
    .slice(0, tope).map((x) => x.p);
}
