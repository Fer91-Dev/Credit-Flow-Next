/**
 * El orden de la hoja de ruta, sin base ni red: puntos conocidos del centro de Tucumán.
 *   npx tsx scripts/probar-recorrido.mts
 */
import { ordenarRecorrido, largoRecorridoMetros, distanciaMetros } from "../lib/domain/recorrido";

let fallos = 0, pruebas = 0;
const ok = (c: boolean, t: string, d = "") => { pruebas++; if (!c) fallos++; console.log(`  ${c ? "OK   " : "FALLA"} ${t}${d ? "  ·  " + d : ""}`); };

// Plaza Independencia, y puertas a distintas distancias. Orden de entrada = alfabético por calle.
const puntos = [
  { nombre: "Alberdi 120 (lejos, oeste)",   latitud: -26.8305, longitud: -65.2300 },
  { nombre: "Congreso 50 (a 300 m)",        latitud: -26.8330, longitud: -65.2045 },
  { nombre: "Laprida 500 (a 100 m)",        latitud: -26.8310, longitud: -65.2050 },
  { nombre: "Plaza Independencia",          latitud: -26.8300, longitud: -65.2040 },
  { nombre: "Sin ubicar",                   latitud: null,     longitud: null },
  { nombre: "Zavalía 900 (a 700 m)",        latitud: -26.8250, longitud: -65.2000 },
];
const ruta = ordenarRecorrido(puntos);
console.log("  recorrido:", ruta.map((p) => p.nombre).join(" → "));
ok(ruta[ruta.length - 1].nombre === "Sin ubicar", "el que no tiene ubicación va al final");
// Un orden alfabético que zigzaguea: dos puertas en el centro, una lejos en el medio de la lista.
const zigzag = [
  { nombre: "Alberdi 120 (centro)",     latitud: -26.8300, longitud: -65.2040 },
  { nombre: "Mendoza 100 (lejos, este)", latitud: -26.8300, longitud: -65.1700 },
  { nombre: "Muñecas 200 (centro)",     latitud: -26.8305, longitud: -65.2045 },
  { nombre: "Santiago 300 (centro)",    latitud: -26.8310, longitud: -65.2050 },
];
const rutaZ = ordenarRecorrido(zigzag);
console.log("  zigzag  :", rutaZ.map((p) => p.nombre.split(" ")[0]).join(" → "), `· ${largoRecorridoMetros(rutaZ)} m vs ${largoRecorridoMetros(zigzag)} m alfabético`);
ok(largoRecorridoMetros(rutaZ) < largoRecorridoMetros(zigzag) * 0.6, "un orden alfabético que zigzaguea se reordena y camina bastante menos", `${largoRecorridoMetros(rutaZ)} m vs ${largoRecorridoMetros(zigzag)} m`);
ok(rutaZ[0].nombre.startsWith("Mendoza") || rutaZ[rutaZ.length - 1].nombre.startsWith("Mendoza"), "la puerta lejana queda en una punta del recorrido, no en el medio");
const largoRuta = largoRecorridoMetros(ruta);
const largoAlfabetico = largoRecorridoMetros(puntos);
ok(largoRuta <= largoAlfabetico, "el recorrido nunca camina más que el orden alfabético", `${largoRuta} m vs ${largoAlfabetico} m`);
ok(Math.abs(distanciaMetros(-26.8300, -65.2040, -26.8310, -65.2050) - 149) < 10, "la distancia es en metros de verdad (100 m ≈ 149 m en diagonal)", `${Math.round(distanciaMetros(-26.8300, -65.2040, -26.8310, -65.2050))} m`);
ok(ordenarRecorrido(puntos).map((p) => p.nombre).join() === ordenarRecorrido(puntos).map((p) => p.nombre).join(), "determinista: la misma lista da el mismo recorrido");
ok(ordenarRecorrido([puntos[4]]).length === 1 && ordenarRecorrido([]).length === 0, "con uno o ninguno no se rompe");

console.log(`\n  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? ` · ${fallos} FALLARON` : "  ·  EL RECORRIDO CUADRA"}`);
process.exit(fallos ? 1 : 0);
