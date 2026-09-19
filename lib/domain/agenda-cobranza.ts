/**
 * QUIÉN ENTRA HOY EN LA COLA DE COBRANZA, y en qué grupo.
 *
 * Una sola decisión, pura, compartida por la agenda del día (`/api/cobranza/agenda`, que
 * además calcula la plata) y por el aviso del menú (`/api/cobranza/alerta`, que solo cuenta).
 * Si vivieran separadas, el número del menú y la cola dirían cosas distintas.
 *
 * EL CRITERIO (Fernando, 19/09/2026): «Cobranzas es una sección para trabajar el contacto
 * con el cliente; la alerta sirve para organizar el trabajo del operador y se apaga porque
 * los contactó. Pero contactarlo una vez no la apaga para siempre: tiene que volver a saltar
 * cada vez que vence una cuota nueva.»
 *
 * De ahí salen las dos mitades de la regla:
 *  1. ALGO PASÓ Y NADIE LO TRABAJÓ TODAVÍA → entra, aunque se lo haya contactado ayer:
 *     se venció una cuota del acuerdo, se rompió una promesa, se cayó el acuerdo, quedó
 *     pactado volver a llamarlo hoy, o —la pieza que faltaba— VENCIÓ OTRA CUOTA desde el
 *     último contacto. Cada hecho nuevo vuelve a encender la alerta.
 *  2. NO PASÓ NADA NUEVO → entra solo si hace `diasSinGestion` que nadie lo toca.
 *
 * Qué cuenta como «contacto»: una gestión humana (llamada, visita, el WhatsApp o el SMS del
 * renglón) Y el envío de una campaña — alguien eligió a esa persona y le mandó un mensaje.
 * NO cuenta el aviso automático del cron: al cliente le llegó, pero nadie lo trabajó, y la
 * cola es la lista de trabajo de una persona. (Para la EFECTIVIDAD de cobranza la campaña
 * sigue sin contar: son dos preguntas distintas.)
 */

export type BucketAgenda = "acuerdo_vencido" | "promesa" | "acuerdo_roto" | "agendado" | "cuota_nueva" | "enfriado";

/** Orden de urgencia de los grupos. Menor = más arriba en la cola. */
export const PRIORIDAD_AGENDA: Record<BucketAgenda, number> = {
  acuerdo_vencido: 0,
  promesa: 1,
  acuerdo_roto: 2,
  agendado: 3,
  cuota_nueva: 4,
  enfriado: 5,
};

/** Una gestión, con lo mínimo para decidir. `cuentaComoContacto` lo resuelve quien consulta. */
export interface GestionParaAgenda {
  created_at: Date;
  proximo_contacto: Date | null;
  promesa_estado: string | null;
  promesa_fecha: Date | null;
  /** true si es una gestión humana o el envío de una campaña; false si la mandó el cron. */
  cuentaComoContacto: boolean;
}

export interface EntradaAgenda {
  /** La cuota del acuerdo vigente que venció impaga (la más vieja), si la hay. */
  acuerdoVencido: { numero: number; vencimiento: Date } | null;
  /** El último acuerdo roto de este crédito, si quedó alguno. */
  acuerdoRoto: { cerrado_at: Date; motivo: string | null } | null;
  /**
   * Cuándo venció (ya con los días de gracia) la ÚLTIMA cuota impaga que cayó. Con esto se
   * detecta la cuota nueva: si venció después del último contacto, hay novedad.
   */
  ultimoVencimiento: Date | null;
  /** Cuántas cuotas están vencidas e impagas: para poder decirlo en el motivo. */
  cuotasVencidas: number;
  gestiones: GestionParaAgenda[];
}

export interface VeredictoAgenda {
  bucket: BucketAgenda;
  /** La fecha del hecho que lo puso en la cola (vencimiento, promesa, cierre del acuerdo…). */
  fecha: Date | null;
  motivo: string;
  /** La promesa pendiente que lo trajo, para poder mostrar el monto prometido. */
  promesa: GestionParaAgenda | null;
}

export function decidirAgenda(e: EntradaAgenda, opts: { hoy: Date; finHoy: number; diasSinGestion: number }): VeredictoAgenda | null {
  const { hoy, finHoy, diasSinGestion } = opts;
  const DIA = 86_400_000;
  const gestiones = e.gestiones;
  const promesaPend = gestiones.find((g) => g.promesa_estado === "pendiente" && g.promesa_fecha) ?? null;
  const conProx = gestiones.find((g) => g.proximo_contacto) ?? null;
  const ultimoContacto = gestiones.find((g) => g.cuentaComoContacto) ?? null;

  if (e.acuerdoVencido) {
    return { bucket: "acuerdo_vencido", fecha: e.acuerdoVencido.vencimiento, motivo: `Cuota ${e.acuerdoVencido.numero} del acuerdo vencida`, promesa: null };
  }
  if (promesaPend?.promesa_fecha && promesaPend.promesa_fecha.getTime() <= finHoy) {
    return { bucket: "promesa", fecha: promesaPend.promesa_fecha, motivo: "Promesa de pago vencida", promesa: promesaPend };
  }
  // Roto y sin gestionar DESDE que se rompió: si ya lo llamaron por eso, no vuelve a saltar.
  if (e.acuerdoRoto && (!ultimoContacto || ultimoContacto.created_at.getTime() < e.acuerdoRoto.cerrado_at.getTime())) {
    const m = e.acuerdoRoto.motivo;
    return { bucket: "acuerdo_roto", fecha: e.acuerdoRoto.cerrado_at, motivo: m ? `Acuerdo roto: ${m.replace(/^Incumplió/, "incumplió")}` : "Acuerdo roto", promesa: null };
  }
  if (conProx?.proximo_contacto && conProx.proximo_contacto.getTime() <= finHoy) {
    return { bucket: "agendado", fecha: conProx.proximo_contacto, motivo: "Contacto agendado", promesa: null };
  }
  /**
   * LA CUOTA NUEVA. Se lo contactó, sí, pero después de eso le venció otra: es un hecho
   * nuevo y la alerta tiene que volver a encenderse sin esperar los días de enfriamiento.
   * Sin esto, contactar a alguien el día 5 lo dejaba callado hasta el día 12 aunque el 6 le
   * cayera otra cuota encima.
   */
  if (ultimoContacto && e.ultimoVencimiento && e.ultimoVencimiento.getTime() > ultimoContacto.created_at.getTime()) {
    return {
      bucket: "cuota_nueva",
      fecha: e.ultimoVencimiento,
      motivo: e.cuotasVencidas > 1 ? `Venció otra cuota desde el último contacto (${e.cuotasVencidas} impagas)` : "Venció una cuota desde el último contacto",
      promesa: null,
    };
  }
  const dias = ultimoContacto ? Math.floor((hoy.getTime() - ultimoContacto.created_at.getTime()) / DIA) : Infinity;
  if (dias >= diasSinGestion) {
    return {
      bucket: "enfriado",
      fecha: ultimoContacto?.created_at ?? null,
      motivo: ultimoContacto ? `Sin gestión hace ${dias} ${dias === 1 ? "día" : "días"}` : "Nunca gestionado",
      promesa: null,
    };
  }
  return null;
}

/** ¿Esta gestión apaga la alerta? Humana o campaña sí; el aviso automático del cron no. */
export function cuentaComoContacto(g: { automatico: boolean; nota: string | null }): boolean {
  if (!g.automatico) return true;
  return (g.nota ?? "").startsWith("[CAMPAÑA");
}
