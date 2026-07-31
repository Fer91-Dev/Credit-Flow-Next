/**
 * check-endpoints — inventario de handlers HTTP por Route Handler.
 *
 * Nace de una regresión real (2026-07-31): al revertir un bloque de código con un
 * corte de texto se borraron sin querer el PATCH y el DELETE de
 * `/api/vendedores/[id]`, y el fallo llegó a producción. Editar un agente devolvía
 * "No se pudo guardar" y eliminarlo tampoco andaba.
 *
 * Ni `tsc` ni el build lo detectan: un archivo con menos exports compila perfecto.
 * Este script sí — compara los métodos exportados contra una referencia guardada.
 *
 * Uso:
 *   node scripts/check-endpoints.mjs           → imprime el inventario
 *   node scripts/check-endpoints.mjs --save    → guarda la referencia actual
 *   node scripts/check-endpoints.mjs --check   → compara y sale con 1 si falta alguno
 *
 * Correr `--check` antes de commitear cuando se tocaron archivos de `app/api`.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "app/api";
const REF = "scripts/.endpoints-ref.json";
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function rutas(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...rutas(p));
    else if (e === "route.ts") out.push(p);
  }
  return out;
}

/** Detecta las DOS formas que usa el repo: `export const X =` y `export async function X(`. */
function handlers(archivo) {
  const src = readFileSync(archivo, "utf8");
  return METODOS.filter((m) =>
    new RegExp("^export\\s+(const\\s+" + m + "\\s*=|async\\s+function\\s+" + m + "\\s*\\()", "m").test(src)
  );
}

const inventario = {};
for (const f of rutas(RAIZ).sort()) {
  const clave = f.split("\\").join("/").replace(RAIZ + "/", "");
  inventario[clave] = handlers(f);
}

const modo = process.argv[2];

if (modo === "--save") {
  writeFileSync(REF, JSON.stringify(inventario, null, 2));
  console.log("\u2713 Referencia guardada: " + Object.keys(inventario).length + " endpoints.");
} else if (modo === "--check") {
  if (!existsSync(REF)) {
    console.error("\u2717 No hay referencia. Corre --save primero.");
    process.exit(1);
  }
  const ref = JSON.parse(readFileSync(REF, "utf8"));
  const problemas = [];
  for (const [ruta, ms] of Object.entries(ref)) {
    const ahora = inventario[ruta];
    if (!ahora) {
      problemas.push("\u2717 DESAPARECIO el endpoint " + ruta + " (tenia " + ms.join(",") + ")");
      continue;
    }
    const faltan = ms.filter((m) => !ahora.includes(m));
    if (faltan.length) {
      problemas.push("\u2717 " + ruta + ": falta " + faltan.join(",") + " (tenia " + ms.join(",") + ", ahora " + (ahora.join(",") || "ninguno") + ")");
    }
  }
  for (const n of Object.keys(inventario).filter((r) => !ref[r])) {
    console.log("+ endpoint nuevo: " + n + " (" + inventario[n].join(",") + ")");
  }
  if (problemas.length) {
    problemas.forEach((p) => console.error(p));
    console.error("\nSi la eliminacion fue intencional, correr --save para actualizar la referencia.");
    process.exit(1);
  }
  console.log("\u2713 Sin perdidas. " + Object.keys(inventario).length + " endpoints verificados.");
} else {
  for (const [ruta, ms] of Object.entries(inventario)) {
    console.log(ruta.padEnd(46) + " " + (ms.join(",") || "NINGUNO"));
  }
  const vacios = Object.entries(inventario).filter(([, m]) => m.length === 0);
  console.log("\n" + Object.keys(inventario).length + " endpoints \u00b7 sin handlers: " + vacios.length);
}
