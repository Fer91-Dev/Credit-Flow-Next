/**
 * ARQUEO de caja — conciliar lo que dice el sistema contra lo que hay realmente.
 *
 * La regla de oro: **quien tiene la plata en la mano no puede borrar su propio faltante.**
 * Un arqueo que se autoconcilia es, para quien maneja efectivo ajeno, un botón para hacer
 * desaparecer lo que falta. Por eso hay dos modos, y cuál corre lo decide el ROL:
 *
 *  - `auto`      — el admin arquea la caja principal (es el dueño de la tesorería): la
 *                  diferencia se ajusta en el acto.
 *  - `declarado` — el vendedor arquea SU caja: declara el conteo y la diferencia queda
 *                  PENDIENTE para que la resuelva un admin. Su caja no se toca sola.
 *
 * Dominio PURO: sin framework ni base.
 */

import { round2 } from "./money";

/** cuadrado = sin diferencia · pendiente = falta que el admin la resuelva · conciliado = ajustada. */
export type EstadoArqueo = "cuadrado" | "pendiente" | "conciliado";

export const ESTADOS_ARQUEO: readonly EstadoArqueo[] = ["cuadrado", "pendiente", "conciliado"] as const;

export function esEstadoArqueo(v: unknown): v is EstadoArqueo {
  return typeof v === "string" && (ESTADOS_ARQUEO as readonly string[]).includes(v);
}

export const ESTADO_ARQUEO_LABEL: Record<EstadoArqueo, string> = {
  cuadrado: "Cuadrado",
  pendiente: "Pendiente de conciliar",
  conciliado: "Conciliado",
};

/** Cómo se resuelve la diferencia. Lo decide el rol de quien arquea, no la UI. */
export type ModoArqueo = "auto" | "declarado";

export interface ResultadoArqueo {
  sistema: number;
  fisico: number;
  /** fisico − sistema. Sobrante > 0, faltante < 0. */
  diferencia: number;
  /** Sin diferencia. */
  cuadra: boolean;
  /** Hay MENOS plata que la que dice el sistema: es el caso que importa vigilar. */
  faltante: boolean;
  estado: EstadoArqueo;
  /** Si corresponde crear el movimiento de ajuste ahora mismo. */
  requiereAjuste: boolean;
}

/**
 * Compara conteo físico contra saldo de sistema y resuelve en qué estado queda el arqueo.
 *
 * El redondeo a 2 decimales es lo que hace que "cuadra" signifique algo: sin él, un saldo
 * arrastrado de divisiones (una cuota con centavos) daría diferencias de 0,0000001 y ningún
 * arqueo cerraría nunca en cero.
 */
export function evaluarArqueo(sistema: number, fisico: number, modo: ModoArqueo): ResultadoArqueo {
  const s = round2(sistema);
  const f = round2(fisico);
  const diferencia = round2(f - s);
  const cuadra = diferencia === 0;

  const estado: EstadoArqueo = cuadra ? "cuadrado" : modo === "auto" ? "conciliado" : "pendiente";

  return {
    sistema: s,
    fisico: f,
    diferencia,
    cuadra,
    faltante: diferencia < 0,
    estado,
    requiereAjuste: !cuadra && modo === "auto",
  };
}

/** "Sobrante" / "Faltante" / "Cuadra exacto" — la misma palabra en la UI, el PDF y la auditoría. */
export function etiquetaDiferencia(diferencia: number): string {
  if (round2(diferencia) === 0) return "Cuadra exacto";
  return diferencia > 0 ? "Sobrante" : "Faltante";
}

/**
 * Un arqueo con faltante NO bloquea la operación: el vendedor sigue trabajando y el admin
 * decide qué hacer. Bloquear la caja por una diferencia sería una decisión de negocio que
 * no nos toca tomar — pero sí hay que hacerla visible, y para eso está el estado pendiente.
 */
export function requiereAtencionAdmin(estado: EstadoArqueo): boolean {
  return estado === "pendiente";
}
