/**
 * RESPALDO DE LA DOCUMENTACIÓN — TRAER (Fernando, 03/10/2026: trabaja desde PC y notebook).
 *
 *   npm run docs:traer           (al EMPEZAR a trabajar, en cualquier máquina)
 *
 * Baja lo último del repo privado `Fer91-Dev/creditflow-docs` y pone cada cosa en su lugar en
 * ESTA máquina: la memoria de Claude, las skills, los .md del proyecto, los manuales, los logos
 * y los .bat de arranque. Es el inverso exacto de `respaldo-docs.mjs`.
 *
 * Si el clon no existe (máquina nueva), lo crea. Antes de reemplazar algo que difiere, guarda lo
 * que había en `ProyectoSilvio/.sync-previo/<fecha>/`: si en esta máquina quedó algo sin subir,
 * no se pierde.
 *
 * Los .md de la raíz del proyecto se AGREGAN o ACTUALIZAN, nunca se borran (puede haber uno
 * recién escrito acá); la memoria y las skills sí se reemplazan enteras, igual que al subir.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { PROYECTO, RAIZ, DESTINO, REPO_DOCS, carpetaMemoria, registrarSync } from "./docs-comun.mjs";

const MEMORIA = carpetaMemoria();
const git = (...a) => execFileSync("git", ["-C", DESTINO, ...a], { encoding: "utf8" }).trim();

if (!existsSync(join(DESTINO, ".git"))) {
  console.log(`Clonando el respaldo en ${DESTINO}…`);
  execFileSync("git", ["clone", "-q", REPO_DOCS, DESTINO], { stdio: "inherit" });
}
const rama = git("rev-parse", "--abbrev-ref", "HEAD");
git("fetch", "-q", "origin");
git("reset", "-q", "--hard", `origin/${rama}`);
const sha = git("rev-parse", "HEAD");

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const PREVIO = join(RAIZ, ".sync-previo", stamp);
let guardados = 0;

/** Lista de archivos (rutas relativas) de un directorio, recursiva. */
function archivos(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? archivos(p, base) : [relative(base, p)];
  });
}
const igual = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));

/** ¿El destino local tiene algo distinto de lo que viene? Entonces se guarda una copia antes. */
function resguardar(local, nombre) {
  if (!existsSync(local)) return;
  cpSync(local, join(PREVIO, nombre), { recursive: true });
  guardados++;
}

/** Reemplaza `local` entero por `origen` del respaldo (si difiere, guarda antes lo local). */
function reemplazar(origen, local, nombre) {
  if (!existsSync(origen)) return;
  const a = archivos(origen), b = archivos(local);
  const distinto = a.length !== b.length || a.some((f) => !igual(join(origen, f), join(local, f)));
  if (!distinto) return;
  resguardar(local, nombre);
  rmSync(local, { recursive: true, force: true });
  mkdirSync(dirname(local), { recursive: true });
  cpSync(origen, local, { recursive: true });
  console.log(`  ✔ ${nombre}`);
}

/** Copia archivo por archivo sin borrar lo que haya de más en `local`. */
function actualizar(origen, local, nombre) {
  if (!existsSync(origen)) return;
  let n = 0;
  for (const f of archivos(origen)) {
    const de = join(origen, f), a = join(local, f);
    if (igual(de, a)) continue;
    if (existsSync(a)) { mkdirSync(dirname(join(PREVIO, nombre, f)), { recursive: true }); cpSync(a, join(PREVIO, nombre, f)); guardados++; }
    mkdirSync(dirname(a), { recursive: true });
    cpSync(de, a);
    n++;
  }
  if (n) console.log(`  ✔ ${nombre} (${n} archivo${n === 1 ? "" : "s"})`);
}

console.log(`Trayendo ${sha.slice(0, 7)} de github.com/Fer91-Dev/creditflow-docs…`);
reemplazar(join(DESTINO, "memoria"), MEMORIA, "memoria de Claude");
reemplazar(join(DESTINO, "skills"), join(RAIZ, ".claude", "skills"), "skills");
actualizar(join(DESTINO, "sistema"), PROYECTO, "documentación del proyecto (.md)");
actualizar(join(DESTINO, "entrega"), join(RAIZ, "entrega"), "manuales");
actualizar(join(DESTINO, "logos"), join(RAIZ, "logos"), "logos");
actualizar(join(DESTINO, "fer-server"), join(RAIZ, "fer-server"), "scripts de Fer-Server");
actualizar(join(DESTINO, "raiz"), RAIZ, ".bat de arranque");

registrarSync(sha);
console.log(`✅ Al día con ${sha.slice(0, 7)}. Memoria en: ${MEMORIA}`);
if (guardados) console.log(`   Lo que había antes en esta máquina quedó copiado en: ${PREVIO}`);
