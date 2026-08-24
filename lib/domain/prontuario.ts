/**
 * PRONTUARIO DEL CLIENTE — la línea de tiempo de su relación con la financiera.
 *
 * La ficha ya decía CÓMO ESTÁ el cliente (deuda, mora, score, créditos vivos). Lo que no
 * decía es CÓMO LLEGÓ HASTA ACÁ: si el atraso de hoy es un tropiezo o la costumbre, si
 * prometió y cumplió o prometió y no apareció, cuántas veces hubo que refinanciarle.
 *
 * Eso decide si se le presta de nuevo, y hasta ahora había que reconstruirlo abriendo
 * crédito por crédito. El dato ya estaba entero en la base; lo que faltaba era juntarlo.
 *
 * 🔴 NO HAY TABLA NUEVA, y es a propósito. Un "historial" persistido sería un cache más que
 * alguien tiene que mantener al día —el mismo problema que ya tiene `creditos.dias_mora`—
 * y que se desincroniza el día que se anula un pago. Todo se deriva de los hechos que ya
 * están registrados: créditos, pagos, gestiones, promesas, acuerdos y consultas al bureau.
 */

/** Qué clase de hecho es. Define el ícono, el color y el orden de desempate. */
export type TipoEventoProntuario =
  | "credito"        // se le otorgó un crédito
  | "refinanciacion" // se le reestructuró la deuda
  | "pago"           // cobró bien
  | "pago_anulado"   // un cobro que después se dio de baja
  | "gestion"        // lo llamaron / le escribieron
  | "promesa"        // se comprometió a pagar
  | "promesa_rota"   // no cumplió
  | "acuerdo"        // arregló en cuotas lo vencido
  | "acuerdo_roto"
  | "bureau"         // se lo consultó en un bureau
  | "estado";        // cambió el estado de la persona (fallecido, baja, reactivación)

/**
 * El tono con el que se lee el hecho. No es decoración: es lo que permite escanear una
 * columna de veinte renglones y ver de un vistazo si este cliente es de fiar.
 */
export type TonoEvento = "bueno" | "malo" | "neutro";

export const TONO_EVENTO: Record<TipoEventoProntuario, TonoEvento> = {
  credito: "neutro",
  refinanciacion: "malo",   // se refinancia lo que no se pudo pagar
  pago: "bueno",
  pago_anulado: "neutro",   // puede ser un error de carga, no necesariamente del cliente
  gestion: "neutro",
  promesa: "neutro",        // prometer no es cumplir; el mérito es la promesa CUMPLIDA
  promesa_rota: "malo",
  acuerdo: "neutro",
  acuerdo_roto: "malo",
  bureau: "neutro",
  estado: "neutro",
};

export const LABEL_EVENTO: Record<TipoEventoProntuario, string> = {
  credito: "Crédito otorgado",
  refinanciacion: "Refinanciación",
  pago: "Pago",
  pago_anulado: "Pago anulado",
  gestion: "Gestión",
  promesa: "Promesa de pago",
  promesa_rota: "Promesa incumplida",
  acuerdo: "Acuerdo de pago",
  acuerdo_roto: "Acuerdo roto",
  bureau: "Consulta a bureau",
  estado: "Cambio de estado",
};

export interface EventoProntuario {
  /** ISO. Es el eje: todo se ordena por acá. */
  fecha: string;
  tipo: TipoEventoProntuario;
  /** Una línea, concreta. El importe o el dato, no una explicación. */
  titulo: string;
  /** Contexto corto y opcional (la nota del cobrador, el motivo). */
  detalle?: string | null;
  /** Importe en pesos cuando el hecho mueve plata. */
  monto?: number | null;
  /** Crédito al que pertenece, ya formateado (CRD-000001 / REF-000060). */
  credito?: string | null;
  /** Quién lo hizo, cuando quedó registrado. */
  actor?: string | null;
}

/**
 * Resumen de conducta: lo que hay que poder leer sin recorrer la lista entera.
 *
 * Se cuenta sobre los hechos, no sobre opiniones: promesas hechas vs. rotas, veces que hubo
 * que refinanciarle, cobros efectivos. Es el respaldo del score, con los números a la vista.
 */
export interface ResumenProntuario {
  creditos: number;
  refinanciaciones: number;
  pagos: number;
  montoCobrado: number;
  promesas: number;
  promesasRotas: number;
  acuerdos: number;
  acuerdosRotos: number;
  /**
   * Fecha del hecho más viejo registrado. **No es "cliente desde"**: el alta del cliente
   * (`clientes.created_at`, que ya muestra el encabezado de la ficha) puede ser muy anterior
   * o posterior al primer movimiento real. Son dos datos distintos y se rotulan distinto.
   */
  desde: string | null;
}

/** Del más nuevo al más viejo. Con misma fecha, primero lo que mueve plata. */
const PESO_DESEMPATE: Record<TipoEventoProntuario, number> = {
  credito: 0, refinanciacion: 1, pago: 2, pago_anulado: 3, acuerdo: 4, acuerdo_roto: 5,
  promesa: 6, promesa_rota: 7, gestion: 8, bureau: 9, estado: 10,
};

export function ordenarEventos(eventos: EventoProntuario[]): EventoProntuario[] {
  return [...eventos].sort((a, b) => {
    const d = new Date(b.fecha).getTime() - new Date(a.fecha).getTime();
    return d !== 0 ? d : PESO_DESEMPATE[a.tipo] - PESO_DESEMPATE[b.tipo];
  });
}

export function resumirProntuario(eventos: EventoProntuario[]): ResumenProntuario {
  const cuenta = (t: TipoEventoProntuario) => eventos.filter((e) => e.tipo === t).length;
  const pagos = eventos.filter((e) => e.tipo === "pago");
  const fechas = eventos.map((e) => new Date(e.fecha).getTime()).filter((n) => !Number.isNaN(n));
  return {
    creditos: cuenta("credito"),
    refinanciaciones: cuenta("refinanciacion"),
    pagos: pagos.length,
    montoCobrado: Math.round(pagos.reduce((s, e) => s + (e.monto ?? 0), 0) * 100) / 100,
    // Una promesa rota TAMBIÉN fue una promesa: el denominador son todas las que hizo, o
    // "2 de 2 cumplidas" y "2 de 5" se leerían igual.
    promesas: cuenta("promesa") + cuenta("promesa_rota"),
    promesasRotas: cuenta("promesa_rota"),
    acuerdos: cuenta("acuerdo") + cuenta("acuerdo_roto"),
    acuerdosRotos: cuenta("acuerdo_roto"),
    desde: fechas.length ? new Date(Math.min(...fechas)).toISOString() : null,
  };
}

/**
 * Hoy, como YYYY-MM-DD y en calendario argentino.
 *
 * Se calcula con el huso de Argentina y no con la fecha local del navegador: entre las 21:00
 * y la medianoche, `new Date()` en UTC ya está en el día siguiente, y el encabezado diría
 * "Ayer" sobre algo que pasó hace dos horas.
 */
export function hoyComercialYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

/** Clave de agrupación por DÍA (YYYY-MM-DD). Los eventos del mismo día van juntos. */
export function diaDe(fechaIso: string): string {
  const d = new Date(fechaIso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

/**
 * Encabezado del día: "Hoy" / "Ayer" / "martes 18 de agosto de 2026".
 *
 * Los dos primeros importan más de lo que parece: en cobranza, "ayer prometió" y "prometió
 * el 22/08" son el mismo dato pero no se leen igual de rápido.
 */
export function etiquetaDia(diaYmd: string, hoyYmd: string): string {
  if (diaYmd === hoyYmd) return "Hoy";
  const ayer = new Date(`${hoyYmd}T00:00:00Z`);
  ayer.setUTCDate(ayer.getUTCDate() - 1);
  if (diaYmd === ayer.toISOString().slice(0, 10)) return "Ayer";
  const d = new Date(`${diaYmd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return diaYmd;
  return d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
