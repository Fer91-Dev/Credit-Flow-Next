/**
 * QUÉ TASA Y QUÉ PLAZO PROPONERLE AL CLIENTE AL REFINANCIAR.
 *
 * 🔴 EL PROBLEMA QUE RESUELVE
 *
 * Refinanciar consolida capital + interés + punitorios en un capital nuevo, así que la base
 * llega inflada: sobre un caso real de la cartera, $260.000,00 prestados se convirtieron en
 * $604.659,31 de deuda. Cobrarle a esa base la tasa de originación produce planes que **no se
 * pueden pagar en ningún plazo**, y eso no es una opinión: la cuota nunca puede bajar del
 * interés del período, así que al 360% T.N.A. sobre esos $604.659,31 la cuota mínima teórica
 * es $181.397,79 — más que los $143.163,84 que el cliente ya demostró que no podía pagar.
 *
 * Hasta ahora la pantalla proponía la tasa del crédito viejo y el operador tenía que darse
 * cuenta solo. Este módulo hace la cuenta al revés: parte de lo que el cliente PUEDE pagar y
 * despeja la tasa, que es como se arma un plan de recupero.
 *
 * 🔴 NO DECIDE: PROPONE. El operador puede escribir lo que quiera; `diagnosticarRefinanciacion`
 * le dice qué significa lo que escribió. La barrera dura sigue siendo la banda de tasas y el
 * resto de la escalera.
 */
import { round2 } from "./money";
import { factorFrances, tasaPeriodicaDesdeCoeficiente } from "./planes";

/** Lo que hace falta saber para proponer un plan. Todo sale de datos que el sistema ya tiene. */
export interface EntradaSugerenciaRefi {
  /** Lo que se va a consolidar, NETO de la entrega (es el capital del crédito nuevo). */
  deudaConsolidada: number;
  /** Lo que de verdad salió de la caja en toda la cadena. Es contra esto que se mide ganar. */
  prestadoCadena: number;
  /** Lo que ya volvió en cualquier eslabón de la cadena. */
  recuperadoCadena: number;
  /**
   * La cuota del plan que se cayó. Es EVIDENCIA: el cliente ya demostró que no puede pagarla,
   * así que pedirle más es armar un plan para que se rompa.
   */
  cuotaFallida: number;
  /** Ingreso declarado en la ficha. `null` si no se cargó. */
  ingresoMensual: number | null;
  /** El mismo ratio con el que la financiera decide a quién le presta (Riesgo → Política). */
  ratioCuotaIngreso: number;
  /** Los plazos que la financiera admite para refinanciar. */
  plazos: number[];
  /** La banda de tasas pactables (Cobranza → Refinanciaciones). */
  banda: { min: number; max: number };
  /** 12 mensual, 52 semanal, 365 diaria. */
  periodosAnio: number;
  /**
   * Cuántas veces lo prestado tiene que devolver el plan para que valga la pena refinanciar
   * en vez de acordar. Por debajo de esto el sistema recomienda el acuerdo, que es más barato
   * de gestionar y tiene una cuota más pagable.
   */
  margenMinimo: number;
}

export interface OpcionRefi {
  plazoMeses: number;
  /** Tasa anual acotada a la banda. */
  tasaAnual: number;
  /** La tasa que habría hecho falta para dar exactamente la cuota objetivo (sin acotar). */
  tasaIdeal: number | null;
  cuota: number;
  total: number;
  /** Lo recuperado de toda la cadena sobre lo prestado, si este plan se cumple. */
  multiplo: number;
  pagable: boolean;
  rentable: boolean;
}

export interface SugerenciaRefi {
  /** La cuota que este cliente puede pagar, y de dónde sale el número. */
  capacidad: { cuota: number; origen: "ingreso" | "cuota_anterior" | "sin_datos" };
  /** Todas las combinaciones evaluadas, en el orden de los plazos configurados. */
  opciones: OpcionRefi[];
  /** La que el sistema propone. `null` = ninguna sirve. */
  mejor: OpcionRefi | null;
  veredicto: "refinanciar" | "acuerdo" | "sin_datos";
  motivo: string;
}

/** La cuota francesa de un capital a una tasa ANUAL y un plazo, en la frecuencia dada. */
function cuotaDe(capital: number, tasaAnual: number, n: number, periodosAnio: number): number {
  return round2(capital * factorFrances(tasaAnual / 100 / periodosAnio, n));
}

/**
 * LA CUOTA QUE ESTE CLIENTE PUEDE PAGAR.
 *
 * Dos señales, y manda la MENOR:
 *
 *  - **El ingreso declarado × el ratio de la financiera.** Es la misma regla con la que se
 *    decide a quién prestarle, no un criterio inventado para esta pantalla.
 *  - **La cuota que ya no pudo pagar.** Es evidencia, no declaración, y por eso pesa: el
 *    sueldo de la ficha puede estar viejo o inflado; el incumplimiento ya ocurrió.
 *
 * Sin ninguno de los dos no se propone nada — pero el diagnóstico de lo que escriba el
 * operador sigue funcionando.
 */
export function capacidadDePago(
  e: Pick<EntradaSugerenciaRefi, "cuotaFallida" | "ingresoMensual" | "ratioCuotaIngreso">,
): SugerenciaRefi["capacidad"] {
  const porIngreso =
    e.ingresoMensual && e.ingresoMensual > 0 && e.ratioCuotaIngreso > 0
      ? round2(e.ingresoMensual * e.ratioCuotaIngreso)
      : null;
  const porEvidencia = e.cuotaFallida > 0 ? round2(e.cuotaFallida) : null;

  if (porIngreso != null && porEvidencia != null) {
    return porEvidencia <= porIngreso
      ? { cuota: porEvidencia, origen: "cuota_anterior" }
      : { cuota: porIngreso, origen: "ingreso" };
  }
  if (porEvidencia != null) return { cuota: porEvidencia, origen: "cuota_anterior" };
  if (porIngreso != null) return { cuota: porIngreso, origen: "ingreso" };
  return { cuota: 0, origen: "sin_datos" };
}

/**
 * Propone tasa y plazo.
 *
 * 🔴 ELIGE EL PLAZO MÁS CORTO QUE SIRVA, NO EL QUE MÁS COBRA.
 *
 * Con la cuota fijada en la capacidad del cliente, el total es `cuota × n`: el plazo más largo
 * SIEMPRE cobra más en pesos nominales. Elegir por ahí propondría 24 cuotas siempre, y sería
 * un error por dos motivos que no aparecen en la suma:
 *
 *  - **El riesgo se multiplica.** Cada cuota es una oportunidad de dejar de pagar, y este
 *    cliente ya dejó de pagar una vez. Un plan de dos años sobre un deudor recuperado es una
 *    apuesta, no un cobro.
 *  - **La plata de hoy no vale lo que la de dentro de un año.** En este mercado esa
 *    diferencia no es un detalle académico: es la mitad del negocio.
 *
 * Así que se propone el plazo más corto que sea PAGABLE y RENTABLE, y el resto de las
 * opciones viajan igual para que el operador pueda estirarlo si el cliente lo pide.
 */
export function sugerirRefinanciacion(e: EntradaSugerenciaRefi): SugerenciaRefi {
  const cap = capacidadDePago(e);
  const plazos = [...new Set(e.plazos.filter((n) => Number.isFinite(n) && n >= 1))].sort((a, b) => a - b);

  if (cap.origen === "sin_datos" || e.deudaConsolidada <= 0 || plazos.length === 0) {
    return {
      capacidad: cap, opciones: [], mejor: null, veredicto: "sin_datos",
      motivo: "No hay con qué estimar la capacidad de pago: cargá el ingreso del cliente en su ficha.",
    };
  }

  const opciones: OpcionRefi[] = plazos.map((n) => {
    /**
     * La tasa que produce EXACTAMENTE la cuota objetivo. `null` cuando ni con tasa 0 la cuota
     * baja de ahí — pasa cuando la deuda es tan grande frente a la capacidad que ni repartirla
     * sin interés alcanza, y es un dato en sí mismo: ese plazo no sirve a ninguna tasa.
     */
    const iIdeal = tasaPeriodicaDesdeCoeficiente(cap.cuota / e.deudaConsolidada, n);
    /**
     * 🔴 LA TASA SE REDONDEA HACIA ABAJO, NO AL MAS CERCANO.
     *
     * La tasa se muestra con dos decimales, y redondear al mas cercano la sube: sobre el caso
     * real, la ideal de 132,6872% se mostraba como 132,69% y la cuota terminaba en
     * $143.164,12 -- 28 centavos POR ENCIMA de lo que el cliente puede pagar. Con la regla de
     * "no proponer una cuota que no entra", esos 28 centavos descartaban el unico plan que
     * servia y el sistema mandaba al acuerdo.
     *
     * Truncar garantiza que la cuota propuesta nunca supere el objetivo. Se pierde una
     * fraccion de punto de tasa; lo que se gana es que la propuesta nunca se contradiga a si
     * misma.
     */
    const tasaIdeal = iIdeal == null ? null : Math.floor(iIdeal * e.periodosAnio * 100 * 100) / 100;
    // La banda manda: si la ideal cae fuera, se usa el borde y la cuota sube o baja con ella.
    const tasaAnual = tasaIdeal == null
      ? e.banda.min
      : Math.min(e.banda.max, Math.max(e.banda.min, tasaIdeal));
    const cuota = cuotaDe(e.deudaConsolidada, tasaAnual, n, e.periodosAnio);
    const total = round2(cuota * n);
    const multiplo = e.prestadoCadena > 0 ? round2((e.recuperadoCadena + total) / e.prestadoCadena) : 0;
    return {
      plazoMeses: n, tasaAnual, tasaIdeal, cuota, total, multiplo,
      // Un centavo de tolerancia: la cuota sale de un redondeo y la capacidad de otro.
      pagable: cuota <= round2(cap.cuota) + 0.01,
      rentable: multiplo >= e.margenMinimo,
    };
  });

  const sirven = opciones.filter((o) => o.pagable && o.rentable);
  if (sirven.length > 0) {
    // El más corto: ya están ordenados por plazo ascendente.
    const mejor = sirven[0];
    return {
      capacidad: cap, opciones, mejor, veredicto: "refinanciar",
      motivo: `${mejor.plazoMeses} cuota${mejor.plazoMeses === 1 ? "" : "s"} de $${mejor.cuota.toLocaleString("es-AR", { minimumFractionDigits: 2 })} al ${mejor.tasaAnual}%: entra en lo que el cliente puede pagar y recupera ${mejor.multiplo.toFixed(2)} veces lo prestado.`,
    };
  }

  /**
   * Ninguna sirve. El motivo importa, porque manda a lugares distintos: si el problema es la
   * cuota, corresponde un ACUERDO (reparte la deuda sin volver a cobrar interés y la cuota
   * queda mucho más baja). Si el problema es el margen, refinanciar no paga el trabajo.
   */
  const hayPagable = opciones.some((o) => o.pagable);
  return {
    capacidad: cap,
    opciones,
    mejor: null,
    veredicto: "acuerdo",
    motivo: hayPagable
      ? `Ningún plan de la banda devuelve al menos ${e.margenMinimo} veces lo prestado. Refinanciar no paga la gestión: conviene un acuerdo de pago.`
      : `Con una capacidad de $${cap.cuota.toLocaleString("es-AR", { minimumFractionDigits: 2 })} por cuota no hay plazo ni tasa de la banda que dé un plan pagable. Lo que corresponde es un acuerdo de pago, que reparte la deuda sin volver a cobrarle interés.`,
  };
}

export interface DiagnosticoRefi {
  cuota: number;
  total: number;
  multiplo: number;
  pagable: boolean;
  rentable: boolean;
  /** Cuánta cuota de más respecto de lo que el cliente puede pagar (0 si entra). */
  excesoCuota: number;
  nivel: "ok" | "aviso" | "alerta";
  mensaje: string;
}

/**
 * QUÉ PASA SI SE PACTA ESTA TASA Y ESTE PLAZO.
 *
 * 🔴 Se calcula para CUALQUIER combinación que escriba el operador, incluida la que el sistema
 * no propuso. El pedido de Fernando es literal: "siempre con la alerta de parte del sistema de
 * qué pasa si pone esa tasa".
 *
 * La razón es la misma de toda la escalera: el operador tiene al cliente enfrente y decide con
 * lo que ve. Un plan impagable no se rechaza —hay casos donde el operador sabe algo que el
 * sistema no— pero no puede firmarse sin que la pantalla lo haya dicho.
 */
export function diagnosticarRefinanciacion(
  tasaAnual: number,
  plazoMeses: number,
  e: EntradaSugerenciaRefi,
): DiagnosticoRefi | null {
  if (!Number.isFinite(tasaAnual) || tasaAnual < 0 || !Number.isFinite(plazoMeses) || plazoMeses < 1) return null;
  if (e.deudaConsolidada <= 0) return null;

  const cap = capacidadDePago(e);
  const cuota = cuotaDe(e.deudaConsolidada, tasaAnual, plazoMeses, e.periodosAnio);
  const total = round2(cuota * plazoMeses);
  const multiplo = e.prestadoCadena > 0 ? round2((e.recuperadoCadena + total) / e.prestadoCadena) : 0;
  const recuperaCapital = e.prestadoCadena <= 0 || round2(e.recuperadoCadena + total) >= e.prestadoCadena;
  const pagable = cap.origen === "sin_datos" || cuota <= round2(cap.cuota) + 0.01;
  const rentable = multiplo >= e.margenMinimo;
  const excesoCuota = cap.origen === "sin_datos" ? 0 : Math.max(0, round2(cuota - cap.cuota));

  const $ = (n: number) => "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── ALERTA: el plan no se va a cobrar, o no recupera la plata ─────────────
  if (!recuperaCapital) {
    return {
      cuota, total, multiplo, pagable, rentable: false, excesoCuota, nivel: "alerta",
      mensaje: `Este plan cobra ${$(total)} y de la caja salieron ${$(e.prestadoCadena)}: no recupera el capital prestado ni cumpliéndose entero.`,
    };
  }
  if (!pagable) {
    const ref = cap.origen === "cuota_anterior"
      ? "la cuota que el cliente ya no pudo pagar"
      : `el ${Math.round(e.ratioCuotaIngreso * 100)}% de su ingreso declarado`;
    return {
      cuota, total, multiplo, pagable, rentable, excesoCuota, nivel: "alerta",
      mensaje: `La cuota queda en ${$(cuota)}, ${$(excesoCuota)} por encima de ${ref} (${$(cap.cuota)}). Un plan así se cae: mirá las opciones que propone el sistema, o armale un acuerdo de pago.`,
    };
  }

  // ── AVISO: se cobra, pero rinde poco ─────────────────────────────────────
  if (!rentable) {
    return {
      cuota, total, multiplo, pagable, rentable, excesoCuota, nivel: "aviso",
      mensaje: `Cuota pagable, pero el plan devuelve ${multiplo.toFixed(2)} veces lo prestado y la financiera pide al menos ${e.margenMinimo}. Un acuerdo de pago rinde parecido y se gestiona más barato.`,
    };
  }

  return {
    cuota, total, multiplo, pagable, rentable, excesoCuota, nivel: "ok",
    mensaje: `Cuota de ${$(cuota)}: entra en lo que el cliente puede pagar, y el plan devuelve ${multiplo.toFixed(2)} veces lo prestado.`,
  };
}
