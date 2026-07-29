/**
 * Salud del respaldo — lógica PURA (sin deps de server ni framework), compartida entre el
 * cliente (Configuración → Respaldos) y el server (/api/backups/salud, que alimenta la
 * campanita). Mantener acá el umbral evita que las dos vistas se desincronicen.
 */

export type CorridaLite = { estado: string; conclusion: string | null; creado: string };

export type SaludBackup = {
  tono: "ok" | "alerta" | "neutro";
  titulo: string;
  detalle: string;
};

/** Horas desde la última copia exitosa a partir de las cuales se considera "atrasado". */
export const HORAS_ATRASO = 36;

/** "hace X" legible a partir de una fecha ISO. */
export function haceTexto(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d !== 1 ? "s" : ""}`;
}

/**
 * Estado de salud a partir de la última corrida EXITOSA:
 *  - ok: hubo una copia exitosa hace ≤ HORAS_ATRASO.
 *  - alerta: nunca hubo una exitosa, o la última fue hace más de HORAS_ATRASO.
 *  - neutro: todavía no se pudo consultar (sin datos / no configurado).
 */
export function calcularSaludBackup(corridas: CorridaLite[] | null): SaludBackup {
  if (!corridas) return { tono: "neutro", titulo: "Consultando estado de los respaldos…", detalle: "" };
  const exitosa = corridas.find((c) => c.estado === "completed" && c.conclusion === "success");
  const enCurso = corridas.some((c) => c.estado !== "completed");
  if (!exitosa) {
    return {
      tono: "alerta",
      titulo: enCurso ? "Backup en curso…" : "Sin copia exitosa reciente",
      detalle: enCurso ? "Esperá a que termine y refrescá." : "Revisá el estado o generá una copia ahora mismo.",
    };
  }
  const horas = (Date.now() - new Date(exitosa.creado).getTime()) / 3_600_000;
  if (horas > HORAS_ATRASO) {
    return {
      tono: "alerta",
      titulo: `Última copia exitosa ${haceTexto(exitosa.creado)}`,
      detalle: "Pasó más de un día sin un respaldo exitoso. Conviene revisarlo o generar uno ahora.",
    };
  }
  return {
    tono: "ok",
    titulo: `Última copia exitosa ${haceTexto(exitosa.creado)}`,
    detalle: "Tus datos están respaldados y a salvo.",
  };
}
