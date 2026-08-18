/**
 * PLANES: cotizar por coeficiente en vez de por tasa.
 *
 * Muchas financieras del rubro no publican una tasa: publican una tabla de planes, y cada
 * plan dice cuánto sale cada peso prestado. `cuota = monto × coeficiente`. El vendedor tipea
 * el monto y la cuota sale sola.
 *
 * 🔴 La decisión de fondo: el crédito NO guarda el coeficiente, guarda la TASA DESPEJADA.
 * Un crédito nacido de un plan queda indistinguible de uno tipeado a mano, así que cobranza,
 * mora, refinanciación, C.F.T., reportes y PDF siguen funcionando sin enterarse de que los
 * planes existen. Si mañana se saca la función, no quedan créditos huérfanos.
 *
 * El coeficiente define la cuota PURA (capital + interés). Los cargos se suman por encima,
 * igual que con una tasa tipeada.
 */
import type { ConvencionTasa, CargosConfig, PlazoOpcion } from "./config";
import { resolverFrecuencia, type Frecuencia, type FrecuenciaDef } from "./frequency";

/**
 * Factor de la cuota francesa: `cuota = capital × factor`.
 *   factor = i / (1 - (1+i)^-n)   ; con i = 0  →  1/n
 * Es exactamente el "coeficiente" de las tablas del rubro.
 */
export function factorFrances(tasaPeriodica: number, cuotas: number): number {
  if (cuotas < 1) return 0;
  if (tasaPeriodica === 0) return 1 / cuotas;
  return tasaPeriodica / (1 - Math.pow(1 + tasaPeriodica, -cuotas));
}

/**
 * Despeja la tasa periódica que produce ese coeficiente en `n` cuotas — la inversa de
 * `factorFrances`, por bisección (no tiene forma cerrada para n > 2).
 *
 * `factorFrances` es estrictamente creciente en i, así que la bisección converge siempre.
 * Devuelve `null` si el coeficiente es imposible: por debajo de `1/n` implicaría una tasa
 * negativa (el cliente devolvería menos de lo que se llevó).
 */
export function tasaPeriodicaDesdeCoeficiente(coeficiente: number, cuotas: number): number | null {
  if (!Number.isFinite(coeficiente) || coeficiente <= 0 || cuotas < 1) return null;

  const piso = 1 / cuotas; // el coeficiente con tasa 0
  if (coeficiente < piso - 1e-12) return null;
  if (coeficiente <= piso + 1e-12) return 0;

  // Techo: se duplica hasta pasar el coeficiente buscado. Con n = 1 el factor es 1 + i,
  // así que un coeficiente grande necesita un techo grande; el tope evita colgarse.
  let hi = 1;
  let vueltas = 0;
  while (factorFrances(hi, cuotas) < coeficiente && vueltas++ < 60) hi *= 2;
  if (factorFrances(hi, cuotas) < coeficiente) return null;

  let lo = 0;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (factorFrances(mid, cuotas) < coeficiente) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Lleva una tasa periódica a la tasa que se guarda en el crédito, en la convención del
 * tenant. Es la INVERSA exacta de `tasaPeriodicaSegunConvencion` (frequency.ts) — las dos
 * tienen que moverse juntas o el crédito se guardaría con una tasa que el motor lee distinto.
 */
export function tasaDesdePeriodica(
  tasaPeriodica: number,
  convencion: ConvencionTasa,
  frecuencia: Frecuencia,
  catalogo?: FrecuenciaDef[]
): number {
  const def = resolverFrecuencia(frecuencia, catalogo);
  const periodos = def.periodosAnio;

  switch (convencion) {
    case "nominal_anual":
      return tasaPeriodica * periodos * 100;
    case "efectiva_anual":
      return (Math.pow(1 + tasaPeriodica, periodos) - 1) * 100;
    case "mensual":
      if (def.esMensual) return tasaPeriodica * 100;
      return (Math.pow(1 + tasaPeriodica, periodos / 12) - 1) * 100;
    default:
      throw new Error(`Convención de tasa desconocida: ${convencion}`);
  }
}

/**
 * Coeficiente → tasa a guardar en el crédito (en %, convención del tenant).
 * Devuelve `null` si el coeficiente no representa ninguna tasa válida.
 */
export function tasaDesdeCoeficiente(
  coeficiente: number,
  cuotas: number,
  convencion: ConvencionTasa,
  frecuencia: Frecuencia,
  catalogo?: FrecuenciaDef[]
): number | null {
  const i = tasaPeriodicaDesdeCoeficiente(coeficiente, cuotas);
  if (i === null) return null;
  return tasaDesdePeriodica(i, convencion, frecuencia, catalogo);
}

// ─── Los planes del tenant ────────────────────────────────────────────────────

/** Identificador estable de un plan. Los viejos (sin `id`) se derivan de forma determinista. */
export function planId(p: PlazoOpcion): string {
  return p.id || `p-${p.cuotas}-${p.frecuencia ?? "todas"}`;
}

/** "1 cuota" / "3 cuotas". Se usa como nombre de respaldo y como sufijo de la etiqueta. */
export function textoCuotas(cuotas: number): string {
  return `${cuotas} ${cuotas === 1 ? "cuota" : "cuotas"}`;
}

/** Nombre visible del plan. Sin nombre propio cae en "N cuotas", que es como se ve hoy. */
export function nombrePlan(p: PlazoOpcion): string {
  return p.nombre?.trim() || textoCuotas(p.cuotas);
}

/**
 * Etiqueta del desplegable del simulador: "Plan 81 · 1 cuota".
 *
 * El código NO va acá. Es un dato interno de la financiera y en la práctica ya viaja dentro
 * del nombre ("Plan 81"), así que mostrarlo repetía el mismo número dos veces y desplazaba lo
 * único que el vendedor necesita leer en ese momento: cuántas cuotas son.
 */
export function etiquetaPlan(p: PlazoOpcion): string {
  const nombre = p.nombre?.trim();
  return nombre ? `${nombre} · ${textoCuotas(p.cuotas)}` : textoCuotas(p.cuotas);
}

/**
 * Planes que se pueden ofrecer con esa frecuencia.
 *
 * Regla de compatibilidad: un plan SIN frecuencia vale para todas — es el comportamiento
 * histórico (la lista de plazos era una sola para todo). La frecuencia solo hace falta
 * cuando hay coeficiente, porque "0,38" significa "6 cuotas MENSUALES" y nada más.
 */
export function planesParaFrecuencia(plazos: PlazoOpcion[], frecuencia: Frecuencia): PlazoOpcion[] {
  return plazos.filter((p) => p.activo && (!p.frecuencia || p.frecuencia === frecuencia));
}

/** Busca un plan por su identificador. */
export function buscarPlan(plazos: PlazoOpcion[], id: string | null | undefined): PlazoOpcion | undefined {
  if (!id) return undefined;
  return plazos.find((p) => planId(p) === id);
}

/**
 * Cargos efectivos de un plan: los gastos administrativos propios del plan MANDAN sobre los
 * del bloque Cargos, y solo si se definieron. Es la única herencia del modelo — todo lo demás
 * (comisión, IVA, seguro) sigue siendo global.
 */
export function cargosConPlan(cargos: CargosConfig, plan?: PlazoOpcion | null): CargosConfig {
  if (!plan?.gastos) return cargos;
  return {
    ...cargos,
    gastosAdministrativos: {
      activo: plan.gastos.valor > 0,
      modo: plan.gastos.modo,
      valor: plan.gastos.valor,
    },
  };
}
