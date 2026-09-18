/**
 * EL ORDEN DE UNA HOJA DE RUTA: puerta por puerta, cada una la más cercana a la anterior.
 *
 * La planilla del cobrador ordenaba por domicilio alfabético dentro de cada zona: "Alberdi
 * 120" antes que "Zavalía 900" aunque estén a diez cuadras y "Alberdi 130" a cien metros del
 * otro lado. Con las coordenadas del geocodificador el orden es el que camina una persona:
 * arranca por la primera puerta y sigue por la más próxima que falte (vecino más cercano).
 * No es la ruta óptima —eso es el problema del viajante— pero es la que un cobrador arma
 * solo con un mapa, y es determinista: la misma lista da siempre el mismo recorrido.
 *
 * Los que no tienen ubicación van al final, en su orden de siempre: se los puede llamar, no
 * visitar con criterio. Puro, sin dependencias.
 */

export interface PuntoRecorrido {
  latitud: number | null;
  longitud: number | null;
}

/** Distancia en metros entre dos puntos (haversine). */
export function distanciaMetros(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Ordena las filas por recorrido. Prueba el vecino más cercano arrancando desde CADA puerta y
 * se queda con el recorrido más corto; y si el orden de entrada (domicilio) caminaba menos
 * todavía, se queda con ese. Así nunca empeora lo que había. `filas` viene en el orden de
 * respaldo (domicilio): es como van los sin ubicar y el desempate.
 */
export function ordenarRecorrido<T extends PuntoRecorrido>(filas: T[]): T[] {
  const conUbicacion = filas.filter((f) => f.latitud != null && f.longitud != null);
  const sinUbicacion = filas.filter((f) => f.latitud == null || f.longitud == null);
  if (conUbicacion.length <= 2) return [...conUbicacion, ...sinUbicacion];

  const desde = (inicio: number): T[] => {
    const pendientes = [...conUbicacion];
    const ruta: T[] = [pendientes.splice(inicio, 1)[0]];
    while (pendientes.length > 0) {
      const actual = ruta[ruta.length - 1];
      let mejor = 0;
      let mejorDist = Infinity;
      for (let i = 0; i < pendientes.length; i++) {
        const d = distanciaMetros(actual.latitud!, actual.longitud!, pendientes[i].latitud!, pendientes[i].longitud!);
        if (d < mejorDist) { mejorDist = d; mejor = i; }
      }
      ruta.push(pendientes.splice(mejor, 1)[0]);
    }
    return ruta;
  };

  let mejorRuta = conUbicacion;
  let mejorLargo = largoRecorridoMetros(conUbicacion);
  for (let i = 0; i < conUbicacion.length; i++) {
    const r = desde(i);
    const l = largoRecorridoMetros(r);
    if (l < mejorLargo) { mejorLargo = l; mejorRuta = r; }
  }
  return [...mejorRuta, ...sinUbicacion];
}

/** Metros totales del recorrido entre las filas ubicadas, en el orden dado. */
export function largoRecorridoMetros(filas: PuntoRecorrido[]): number {
  let total = 0;
  let previo: PuntoRecorrido | null = null;
  for (const f of filas) {
    if (f.latitud == null || f.longitud == null) continue;
    if (previo) total += distanciaMetros(previo.latitud!, previo.longitud!, f.latitud, f.longitud);
    previo = f;
  }
  return Math.round(total);
}
