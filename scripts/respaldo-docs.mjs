/**
 * RESPALDO DE LA DOCUMENTACIÓN — SUBIR (Fernando, 01/10/2026).
 *
 * Los `.md` del proyecto NO se suben al repo del sistema (es público: no se le da el mapa a un
 * atacante), y la memoria de Claude vive en `C:\Users\<usuario>\.claude\`. Las dos cosas
 * existían SOLO en esta PC: si el disco se rompía, el código se salvaba y se perdía todo el
 * porqué. Este script las copia a un repo PRIVADO aparte (`Fer91-Dev/creditflow-docs`),
 * clonado en `ProyectoSilvio\respaldo-docs`, y sube los cambios con historial.
 *
 *   npm run respaldo:docs        (al TERMINAR de trabajar)
 *   npm run docs:traer           (al EMPEZAR, en cualquier máquina — ver traer-docs.mjs)
 *
 * Qué copia (cada carpeta del respaldo se reemplaza entera, así lo borrado también se borra):
 *   sistema/          ← creditflow-next/*.md  (CLAUDE.md, PENDIENTES.md, auditorías, guías)
 *   sistema/.claude/  ← creditflow-next/.claude/**\/*.md  (napkin, agentes)
 *   skills/           ← ProyectoSilvio\.claude\skills
 *   memoria/          ← la memoria de Claude de este proyecto
 *   entrega/          ← ProyectoSilvio\entrega (manuales PDF + su fuente HTML)
 *   logos/            ← ProyectoSilvio\logos
 *   fer-server/       ← ProyectoSilvioer-server (scripts y Caddyfile del servidor Oracle)
 *   raiz/             ← los .bat de arranque de ProyectoSilvio\
 *
 * 🔴 DOS MÁQUINAS (03/10/2026): si la otra máquina subió algo que esta todavía no trajo, NO sube
 * nada y pide `docs:traer` primero. Sin esa guarda, subir desde una máquina desactualizada
 * reemplazaba la memoria nueva de la otra por la vieja.
 *
 * NUNCA copia `.env*` ni `settings*.json`. Antes de subir busca claves con forma real (URL de
 * base con contraseña, claves de age, tokens de GitHub/Resend/Meta, JWT) y, si encuentra una,
 * NO sube nada y dice dónde está.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { PROYECTO, RAIZ, DESTINO, REPO_DOCS, carpetaMemoria, ultimoSync, registrarSync, GUIA_PC_NUEVA } from "./docs-comun.mjs";

const MEMORIA = carpetaMemoria();

if (!existsSync(join(DESTINO, ".git"))) {
  console.error(`No está el clon del respaldo en ${DESTINO}.\nCorré primero:  npm run docs:traer   (o  git clone ${REPO_DOCS} "${DESTINO}")`);
  process.exit(1);
}

const git = (...a) => execFileSync("git", ["-C", DESTINO, ...a], { encoding: "utf8" }).trim();

// ── Guarda de dos máquinas: ¿la otra subió algo que acá no se trajo? ──
const rama = git("rev-parse", "--abbrev-ref", "HEAD");
git("fetch", "-q", "origin");
const remoto = git("rev-parse", `origin/${rama}`);
const conocido = ultimoSync() ?? git("rev-parse", "HEAD");
if (remoto !== conocido) {
  console.error(
    "🔴 NO SE SUBIÓ NADA: la otra máquina subió cambios que esta todavía no trajo.\n" +
    "   Corré primero  npm run docs:traer  y después volvé a correr  npm run respaldo:docs.",
  );
  process.exit(3);
}
// Deja el clon exactamente en lo que hay en GitHub antes de espejar encima.
git("reset", "-q", "--hard", remoto);

const excluir = (ruta) => /(^|[\\/])\.env|settings[^\\/]*\.json$|\.lock$|[\\/]\.git([\\/]|$)/i.test(ruta);

/** Reemplaza `dest` por una copia fresca de `origen` (opcionalmente solo los archivos que pasan `filtro`). */
function espejar(origen, dest, filtro = () => true) {
  rmSync(dest, { recursive: true, force: true });
  if (!existsSync(origen)) { console.warn(`  (no existe ${origen}, se omite)`); return; }
  mkdirSync(dest, { recursive: true });
  cpSync(origen, dest, {
    recursive: true,
    filter: (src) => !excluir(src) && (statSync(src).isDirectory() || filtro(src)),
  });
}

// sistema/: solo los .md de la raíz del proyecto, y los .md de su .claude/
rmSync(join(DESTINO, "sistema"), { recursive: true, force: true });
mkdirSync(join(DESTINO, "sistema"), { recursive: true });
for (const f of readdirSync(PROYECTO)) {
  if (f.toLowerCase().endsWith(".md")) cpSync(join(PROYECTO, f), join(DESTINO, "sistema", f));
}
espejar(join(PROYECTO, ".claude"), join(DESTINO, "sistema", ".claude"), (src) => src.toLowerCase().endsWith(".md"));
espejar(join(RAIZ, ".claude", "skills"), join(DESTINO, "skills"));
espejar(MEMORIA, join(DESTINO, "memoria"));
espejar(join(RAIZ, "entrega"), join(DESTINO, "entrega"));
espejar(join(RAIZ, "logos"), join(DESTINO, "logos"));
if (existsSync(join(RAIZ, "fer-server"))) espejar(join(RAIZ, "fer-server"), join(DESTINO, "fer-server"));
// raiz/: los .bat de arranque (los datos de clientes que hay en la raíz NO viajan).
rmSync(join(DESTINO, "raiz"), { recursive: true, force: true });
mkdirSync(join(DESTINO, "raiz"), { recursive: true });
for (const f of readdirSync(RAIZ)) {
  if (f.toLowerCase().endsWith(".bat")) cpSync(join(RAIZ, f), join(DESTINO, "raiz", f));
}

writeFileSync(join(DESTINO, "LEEME.md"), GUIA_PC_NUEVA);

// Barrera: nada con forma de clave real sale de esta PC.
const PATRONES = [
  /postgres(?:ql)?:\/\/[^\s:@<>]+:(?!PASSWORD|CLAVE|<)[^\s@<>]{6,}@/i,
  /AGE-SECRET-KEY-1[0-9A-Z]{20,}/,
  /\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bre_[A-Za-z0-9]{24,}/,
  /\bEAA[A-Za-z0-9]{60,}/,
  /\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/,
];
const hallazgos = [];
const revisar = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === ".git") continue;
    if (statSync(p).isDirectory()) { revisar(p); continue; }
    if (!/\.(md|html|json|txt|bat)$/i.test(f)) continue;
    const texto = readFileSync(p, "utf8");
    for (const re of PATRONES) if (re.test(texto)) hallazgos.push(`${relative(DESTINO, p)}  (${re.source.slice(0, 30)}…)`);
  }
};
revisar(DESTINO);
if (hallazgos.length) {
  git("reset", "-q", "--hard", remoto);
  console.error("🔴 NO SE SUBIÓ NADA: hay algo con forma de clave real en:\n  " + hallazgos.join("\n  "));
  process.exit(2);
}

git("add", "-A");
const cambios = git("status", "--porcelain");
if (!cambios) { registrarSync(remoto); console.log("Sin cambios: el respaldo ya estaba al día."); process.exit(0); }
const n = cambios.split("\n").length;
const fecha = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }).format(new Date());
git("commit", "-q", "-m", `respaldo ${fecha} (${n} archivos)`);
execFileSync("git", ["-C", DESTINO, "push", "-q", "-u", "origin", rama], { stdio: "inherit" });
const nuevo = git("rev-parse", "HEAD");
registrarSync(nuevo);
console.log(`✅ Respaldo subido: ${n} archivos cambiados · ${nuevo.slice(0, 7)} → github.com/Fer91-Dev/creditflow-docs (privado)`);
