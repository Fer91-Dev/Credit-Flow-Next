"use client";

import { useEffect, useState } from "react";

/**
 * Devuelve `valor` retrasado `ms` milisegundos, reiniciando la espera con cada cambio.
 *
 * ── PARA QUÉ ──
 *
 * Cuando lo que se tipea dispara una consulta al servidor —la búsqueda de clientes, por
 * ejemplo— sin esto sale una request por tecla: escribir un DNI son ocho consultas, siete de
 * ellas ya obsoletas cuando llegan. Con el retraso viaja solo lo que el operador terminó de
 * escribir.
 *
 * 250 ms es el punto donde no se siente lento al tipear y ya no sale una consulta por dígito.
 *
 * ⚠️ El valor devuelto va ATRASADO respecto del input. Quien lo use tiene que contemplar el
 * intervalo en el que el campo dice una cosa y este valor todavía dice la anterior: mostrar
 * los resultados viejos como si fueran los del término nuevo es peor que no mostrar nada.
 */
export function useDebounce<T>(valor: T, ms = 250): T {
  const [retrasado, setRetrasado] = useState(valor);

  useEffect(() => {
    const t = setTimeout(() => setRetrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);

  return retrasado;
}
