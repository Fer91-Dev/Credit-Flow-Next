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
  /**
   * 🔴 LOS HONORARIOS POR GESTIÓN, QUE TAMBIÉN LOS PAGA EL CLIENTE.
   *
   * Se cobran como un cargo repartido en las cuotas, así que la cuota real es la francesa MÁS
   * su parte de honorarios. Sin esto el motor prometía una cuota que no era la que el cliente
   * iba a pagar: en la primera refinanciación real (CRD-000007) proponía $157.054,30 y el plan
   * salió con $150.371,89 de cuota, porque $9.100,25 de cada una eran honorarios que la cuenta
   * no había mirado. Entró por poco; con una capacidad más ajustada, el plan propuesto se
   * habría pasado de lo que el cliente puede pagar — rompiendo la única promesa que hace este
   * módulo.
   *
   * Se asume el TECHO de la banda, que es con lo que la pantalla prellena el campo: proponer
   * un plan que funciona con los honorarios más altos es lo conservador. Si el operador los
   * baja, la cuota baja con ellos.
   */
  honorariosPct: number;
  /** 12 mensual, 52 semanal, 365 diaria. */
  periodosAnio: number;
  /**
   * Cuántas veces lo prestado tiene que devolver el plan para que valga la pena refinanciar
   * en vez de acordar. Por debajo de esto el sistema recomienda el acuerdo, que es más barato
   * de gestionar y tiene una cuota más pagable.
   */
  margenMinimo: number;
  /**
   * 🔴 CUÁNTO SE PUEDE PERDONAR, en % de la deuda consolidada.
   *
   * Fernando (22/09/2026): "lo bueno que tenemos en refinanciación es que podemos negociar
   * para que el cliente pague un poco menos; lo ideal sería que el motor sugiera un descuento
   * y el plazo adecuado para que sea pagable, sin que la financiera tenga pérdidas".
   *
   * Es el MONTO que sale de `quitaMaxima`, la misma función que ya rige los acuerdos: lo
   * condonable es mora + interés (nunca el capital, que es plata que salió de la caja), y
   * para un vendedor eso además se acota por el porcentaje que la financiera le permite. No
   * es un parámetro nuevo ni un criterio propio de esta pantalla.
   */
  quitaMaxima: number;
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
  /**
   * El descuento que hace falta para que la cuota entre en lo que el cliente puede pagar.
   * 0 = no hace falta ninguno. El capital del plan es `deudaConsolidada − quita`.
   */
  quita: number;
  /** El mismo descuento en % de la deuda, que es como se carga en la pantalla. */
  quitaPct: number;
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

/** Lo que cada cuota lleva de honorarios por gestión: el total, repartido en partes iguales. */
function honorariosPorCuota(capital: number, pct: number, n: number): number {
  if (!(pct > 0) || n < 1) return 0;
  return round2(round2(capital * (pct / 100)) / n);
}

/**
 * La cuota COMPLETA: la francesa más su parte de honorarios. Es la que el cliente paga, y por
 * lo tanto la única contra la que tiene sentido medir si puede pagarla.
 */
function cuotaDe(capital: number, tasaAnual: number, n: number, periodosAnio: number, honPct = 0): number {
  return round2(capital * factorFrances(tasaAnual / 100 / periodosAnio, n) + honorariosPorCuota(capital, honPct, n));
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
    /*
      El objetivo que se le pide a la parte FRANCESA es la capacidad MENOS lo que esa cuota va
      a llevar de honorarios: son plata del cliente igual, y si no se descuentan acá la cuota
      emitida termina por encima de lo que puede pagar.
    */
    const honCuota = honorariosPorCuota(e.deudaConsolidada, e.honorariosPct, n);
    const objetivoFrances = round2(cap.cuota - honCuota);
    const iIdeal = objetivoFrances > 0
      ? tasaPeriodicaDesdeCoeficiente(objetivoFrances / e.deudaConsolidada, n)
      : null;
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
    const cuotaSinQuita = cuotaDe(e.deudaConsolidada, tasaAnual, n, e.periodosAnio, e.honorariosPct);
    const objetivo = round2(cap.cuota) + 0.01; // el centavo es tolerancia de redondeo

    /**
     * 🔴 SI NI CON EL PISO DE LA BANDA ENTRA, SE CALCULA EL DESCUENTO QUE FALTA.
     *
     * El orden lo decidió Fernando y es el que menos cuesta: PRIMERO la tasa, DESPUÉS el
     * descuento. Bajar la tasa resigna interés que todavía no salió de la caja; una quita
     * borra deuda que ya está contabilizada. Por eso el descuento sale solo por lo que la
     * tasa no pudo arreglar, y siempre el MÍNIMO necesario.
     *
     * La cuota es `capital × (factor francés + honorarios por cuota)`, y los honorarios se
     * calculan sobre el capital nuevo, así que la relación es lineal: despejando el capital
     * que produce exactamente la cuota objetivo sale el tope, y lo que sobra es la quita.
     *
     * Se redondea la quita HACIA ARRIBA: un centavo de más deja la cuota un centavo por
     * debajo del objetivo, que es el lado correcto del que equivocarse — al revés, el plan
     * propuesto se pasaría de lo que el cliente puede pagar y rompería la única promesa que
     * hace este módulo.
     */
    let quita = 0;
    let capitalPlan = e.deudaConsolidada;
    let tasaFinal = tasaAnual;
    if (cuotaSinQuita > objetivo && e.quitaMaxima > 0) {
      const factor = factorFrances(e.banda.min / 100 / e.periodosAnio, n);
      /**
       * 🔴 LOS HONORARIOS NO BAJAN CON EL DESCUENTO, así que son un monto FIJO en esta cuenta.
       *
       * Se calculan sobre la deuda consolidada —la que se gestionó— y no sobre el capital que
       * queda después de perdonar: es plata por el trabajo de recuperar, no un porcentaje de
       * lo que el cliente termina debiendo. La pantalla ya los calculaba así.
       *
       * Al despejar el capital hay que tratarlos como constante y no como proporción, o el
       * motor promete una cuota que el plan no da: con el capital descontado la parte de
       * honorarios salía más chica, y sobre CRD-000008 la propuesta decía $178.566,31 cuando
       * el plan emitía $179.388,27 — $821,96 por cuota de diferencia, justo por encima de lo
       * que el cliente puede pagar. Es la misma trampa que ya había costado el caso de
       * CRD-000007, con los honorarios ignorados por completo.
       */
      const honFijoPorCuota = honorariosPorCuota(e.deudaConsolidada, e.honorariosPct, n);
      if (factor > 0) {
        const capitalMax = (cap.cuota - honFijoPorCuota) / factor;
        const necesaria = Math.ceil((e.deudaConsolidada - capitalMax) * 100) / 100;
        if (necesaria > 0 && necesaria <= round2(e.quitaMaxima)) {
          quita = necesaria;
          capitalPlan = round2(e.deudaConsolidada - quita);
          // Con descuento, la tasa queda en el piso: es el orden que se eligió.
          tasaFinal = e.banda.min;
        }
      }
    }

    /* Con descuento: la cuota francesa sale del capital REDUCIDO, y los honorarios de la
       deuda consolidada, que es sobre lo que la financiera los cobra. */
    const cuota = quita > 0
      ? round2(capitalPlan * factorFrances(tasaFinal / 100 / e.periodosAnio, n)
               + honorariosPorCuota(e.deudaConsolidada, e.honorariosPct, n))
      : cuotaSinQuita;
    const total = round2(cuota * n);
    const multiplo = e.prestadoCadena > 0 ? round2((e.recuperadoCadena + total) / e.prestadoCadena) : 0;
    return {
      plazoMeses: n, tasaAnual: tasaFinal, tasaIdeal, cuota, total, multiplo,
      pagable: cuota <= objetivo,
      rentable: multiplo >= e.margenMinimo,
      quita,
      quitaPct: quita > 0 ? Math.round((quita / e.deudaConsolidada) * 10000) / 100 : 0,
    };
  });

  const sirven = opciones.filter((o) => o.pagable && o.rentable);
  if (sirven.length > 0) {
    /**
     * 🔴 SIN DESCUENTO, EL MÁS CORTO. CON DESCUENTO, EL QUE MENOS PERDONE.
     *
     * La regla de "el plazo más corto" se escribió cuando el descuento no existía: con la
     * cuota fija en la capacidad, el total es `cuota × n`, así que estirar el plazo siempre
     * cobraba más y elegir el más corto protegía del riesgo sin resignar plata.
     *
     * Con descuento se da vuelta, y no por poco. En CRD-000008 las tres opciones viables dan
     * la MISMA cuota para el cliente ($178.566,31), pero:
     *
     *    6 cuotas → perdona $629.910,49 y recupera $1.071.397,85 (2,14x)
     *   12 cuotas → perdona $197.269,10 y recupera $2.142.795,71 (4,29x)
     *
     * El plazo corto obliga a bajar más el capital, así que cuesta $432.641,39 de descuento
     * extra y recupera un millón menos. Y las dos cosas que el plazo corto protege no son
     * comparables con eso: el descuento es plata perdida CIERTA, el riesgo de una cuota más
     * es probable. Fernando lo decidió así el 22/09/2026.
     *
     * Entonces: si alguna opción entra SIN perdonar nada, gana la más corta de esas —la regla
     * vieja, intacta, para el caso en que se escribió—. Si todas necesitan descuento, gana la
     * que menos perdone, y a igual descuento la más corta.
     */
    const sinQuita = sirven.filter((o) => o.quita <= 0);
    const mejor = sinQuita.length > 0
      ? sinQuita[0]
      : [...sirven].sort((x, y) => (x.quita - y.quita) || (x.plazoMeses - y.plazoMeses))[0];
    return {
      capacidad: cap, opciones, mejor, veredicto: "refinanciar",
      motivo: mejor.quita > 0
        ? `${mejor.plazoMeses} cuota${mejor.plazoMeses === 1 ? "" : "s"} de $${mejor.cuota.toLocaleString("es-AR", { minimumFractionDigits: 2 })} al ${mejor.tasaAnual}%, con un descuento de $${mejor.quita.toLocaleString("es-AR", { minimumFractionDigits: 2 })} (${mejor.quitaPct}% de la deuda): sin ese descuento no hay plan que el cliente pueda pagar, y con él igual recupera ${mejor.multiplo.toFixed(2)} veces lo prestado.`
        : `${mejor.plazoMeses} cuota${mejor.plazoMeses === 1 ? "" : "s"} de $${mejor.cuota.toLocaleString("es-AR", { minimumFractionDigits: 2 })} al ${mejor.tasaAnual}%: entra en lo que el cliente puede pagar y recupera ${mejor.multiplo.toFixed(2)} veces lo prestado.`,
    };
  }

  /**
   * Ninguna sirve. El motivo importa, porque manda a lugares distintos: si el problema es la
   * cuota, corresponde un ACUERDO (reparte la deuda sin volver a cobrar interés y la cuota
   * queda mucho más baja). Si el problema es el margen, refinanciar no paga el trabajo.
   */
  const hayPagable = opciones.some((o) => o.pagable);
  /* Que el descuento se haya intentado y no alcance es OTRA cosa que no haberlo intentado:
     el operador tiene que saber que ya se probó con el tope que tiene permitido perdonar. */
  const seProboQuita = e.quitaMaxima > 0;
  return {
    capacidad: cap,
    opciones,
    mejor: null,
    veredicto: "acuerdo",
    motivo: hayPagable
      ? `Ningún plan devuelve al menos ${e.margenMinimo} veces lo prestado, ni con el descuento máximo. Refinanciar no paga la gestión: conviene un acuerdo de pago.`
      : `Con una capacidad de $${cap.cuota.toLocaleString("es-AR", { minimumFractionDigits: 2 })} por cuota no hay plan pagable${seProboQuita ? `, ni bajando la tasa al ${e.banda.min}% y perdonando los $${e.quitaMaxima.toLocaleString("es-AR", { minimumFractionDigits: 2 })} que se pueden condonar` : ""}. Lo que corresponde es un acuerdo de pago, que reparte la deuda sin volver a cobrarle interés.`,
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
  const cuota = cuotaDe(e.deudaConsolidada, tasaAnual, plazoMeses, e.periodosAnio, e.honorariosPct);
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
      ? "la cuota mensual que el cliente ya no pudo sostener, sin contar punitorios"
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
