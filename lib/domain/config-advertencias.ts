/**
 * ADVERTENCIAS DE CONFIGURACIÓN: valores que el sistema acepta pero que casi siempre son un
 * error de quien los cargó.
 *
 * ── POR QUÉ EXISTE ──
 *
 * Fernando puso 100% mensual en el interés del acuerdo mientras configuraba producción. El
 * sistema lo aceptó sin decir nada, porque es un valor válido: hay financieras que trabajan
 * así. Pero a un acuerdo —el arreglo con alguien que YA no pudo pagar— el 100% mensual lo
 * vuelve incobrable, y eso no se ve escrito en ningún lado hasta que el acuerdo se rompe tres
 * meses después.
 *
 * ── LA REGLA ──
 *
 * 🔴 ADVIERTEN, NO BLOQUEAN. La financiera manda: si Silvio quiere el 100%, lo pone. Lo que
 * no puede pasar es que lo ponga *sin enterarse* de lo que significa.
 *
 * 🔴 CADA ADVERTENCIA TRAE EL NÚMERO, no un adjetivo. "Es muy alto" no sirve para decidir;
 * "la deuda se multiplica por 8 en 3 meses" sí. El que configura tiene que poder ver la
 * consecuencia en la misma pantalla donde escribe el parámetro.
 *
 * Estas funciones son puras y viven en el dominio para que la regla tenga UNA definición: la
 * misma que se muestra en Configuración podría usarse mañana en un chequeo previo al alta de
 * una financiera nueva.
 */

const pesos = (n: number) =>
  `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Una advertencia sobre un parámetro. `null` = el valor no llama la atención. */
export type Advertencia = string | null;

/**
 * Interés mensual del acuerdo de pago.
 *
 * El acuerdo NO es un crédito nuevo: es la última chance de recuperar capital que ya se dio
 * por difícil. Un interés que duplica la deuda garantiza que se rompa, y al romperse el
 * deudor vuelve a morosos con los punitorios corriendo de nuevo — o sea, se pierde la única
 * herramienta de recupero que había.
 */
export function advertirTasaAcuerdo(tasaMensualPct: number | null | undefined): Advertencia {
  if (tasaMensualPct == null || tasaMensualPct <= 10) return null;
  const t = tasaMensualPct / 100;
  const base = 100_000;
  const aTresMeses = base * Math.pow(1 + t, 3);
  const veces = aTresMeses / base;
  return (
    `Al ${tasaMensualPct}% mensual, un acuerdo de ${pesos(base)} pasa a ${pesos(aTresMeses)} ` +
    `en 3 meses (${veces.toFixed(1)} veces). El acuerdo es con alguien que ya no pudo pagar: ` +
    `a esta tasa se rompe y el deudor vuelve a morosos con los punitorios corriendo de nuevo. ` +
    `Por encima del 10% mensual conviene revisarlo.`
  );
}

/**
 * Mora diaria. El número se ve chico porque es diario, y ahí está la trampa: 1% por día son
 * 30% al mes. Se muestra el equivalente mensual, que es como lo piensa cualquiera.
 */
export function advertirMoraDiaria(tasaDiariaPct: number | null | undefined): Advertencia {
  if (tasaDiariaPct == null || tasaDiariaPct <= 0.5) return null;
  const mensual = tasaDiariaPct * 30;
  return (
    `${tasaDiariaPct}% por día son ${mensual.toFixed(1)}% al mes de punitorios. ` +
    `Una cuota de ${pesos(100_000)} atrasada 30 días suma ${pesos(100_000 * (mensual / 100))} ` +
    `solo de mora. Por encima del 0,5% diario conviene mirar el techo de punitorios.`
  );
}

/**
 * Techo de punitorios como % de la deuda. En 100%, la mora puede llegar a valer lo mismo que
 * todo lo que se debe: el deudor deja de tener incentivo para pagar porque ya no puede
 * alcanzar el total nunca.
 */
export function advertirTopeMora(topePct: number | null | undefined): Advertencia {
  if (topePct == null || topePct <= 50) return null;
  return (
    `Con un techo del ${topePct}%, sobre una deuda de ${pesos(100_000)} los punitorios pueden ` +
    `llegar a ${pesos(100_000 * (topePct / 100))} — la deuda se ${topePct >= 100 ? "duplica" : "vuelve inalcanzable"}. ` +
    `Pasado cierto punto el deudor deja de intentar pagar porque no puede alcanzar el total.`
  );
}

/** Días de gracia: cuántos días de atraso NO devengan mora. */
export function advertirDiasGracia(dias: number | null | undefined): Advertencia {
  if (dias == null || dias <= 10) return null;
  return (
    `Con ${dias} días de gracia, atrasarse no cuesta nada durante ${dias} días. ` +
    `La fecha de vencimiento deja de ser la fecha real de pago: el cliente aprende que el ` +
    `plazo verdadero es ${dias} días después.`
  );
}

/**
 * Máximo de cuotas del acuerdo. Con muchas cuotas el acuerdo deja de ser un arreglo de
 * mostrador y pasa a ser una refinanciación encubierta — sin contrato, sin firma y sin las
 * guardas que sí tiene refinanciar.
 */
export function advertirCuotasAcuerdo(maxCuotas: number | null | undefined): Advertencia {
  if (maxCuotas == null || maxCuotas <= 12) return null;
  return (
    `${maxCuotas} cuotas ya no son un arreglo de mostrador: es una refinanciación encubierta, ` +
    `sin contrato nuevo ni las guardas que sí tiene refinanciar. Para plazos largos conviene ` +
    `usar la refinanciación, que arma un crédito nuevo y queda documentada.`
  );
}

/** Cuántos créditos activos simultáneos admite un mismo cliente. */
export function advertirMaxCreditosActivos(max: number | null | undefined): Advertencia {
  if (max == null || max === 0 || max <= 3) return null;
  return (
    `Con ${max} créditos simultáneos por cliente, la misma persona puede acumular ${max} cuotas ` +
    `por mes. El motor descuenta esas cuotas de su capacidad de pago, pero el riesgo se ` +
    `concentra en pocos deudores.`
  );
}

/**
 * Ratio cuota/ingreso. Por encima del 50% del sueldo, la cuota compite con la comida: el
 * cliente entra en default aunque quiera pagar.
 */
export function advertirRatioCuotaIngreso(ratio: number | null | undefined): Advertencia {
  if (ratio == null || ratio <= 0.5) return null;
  const pct = Math.round(ratio * 100);
  return (
    `Con el ${pct}%, alguien que gana ${pesos(1_000_000)} puede comprometer ` +
    `${pesos(1_000_000 * ratio)} de cuota por mes. Por encima del 50% la cuota compite con los ` +
    `gastos de vivir: el cliente cae en mora aunque quiera pagar.`
  );
}
