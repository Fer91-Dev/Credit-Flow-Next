/**
 * RESPALDO DE LA DOCUMENTACIÓN (Fernando, 01/10/2026).
 *
 * Los `.md` del proyecto NO se suben al repo del sistema (es público: no se le da el mapa a un
 * atacante), y la memoria de Claude vive en `C:\Users\Fernando\.claude\`. Las dos cosas
 * existían SOLO en esta PC: si el disco se rompía, el código se salvaba y se perdía todo el
 * porqué. Este script las copia a un repo PRIVADO aparte (`Fer91-Dev/creditflow-docs`),
 * clonado en `F:\ProyectoSilvio\respaldo-docs`, y sube los cambios con historial.
 *
 *   npm run respaldo:docs
 *
 * Qué copia (cada carpeta del respaldo se reemplaza entera, así lo borrado también se borra):
 *   sistema/          ← creditflow-next/*.md  (CLAUDE.md, PENDIENTES.md, auditorías, guías)
 *   sistema/.claude/  ← creditflow-next/.claude/**\/*.md  (napkin, agentes)
 *   skills/           ← F:\ProyectoSilvio\.claude\skills
 *   memoria/          ← la memoria de Claude de este proyecto
 *   entrega/          ← F:\ProyectoSilvio\entrega (manual PDF + su fuente HTML)
 *   logos/            ← F:\ProyectoSilvio\logos
 *
 * NUNCA copia `.env*` ni `settings*.json`. Antes de subir busca claves con forma real (URL de
 * base con contraseña, claves de age, tokens de GitHub/Resend/Meta, JWT) y, si encuentra una,
 * NO sube nada y dice dónde está.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROYECTO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = resolve(PROYECTO, "..");
const DESTINO = process.env.RESPALDO_DOCS_DIR ?? join(RAIZ, "respaldo-docs");
const MEMORIA = process.env.MEMORIA_DIR ?? join(homedir(), ".claude", "projects", "f--ProyectoSilvio", "memory");

if (!existsSync(join(DESTINO, ".git"))) {
  console.error(`No está el clon del respaldo en ${DESTINO}.\nCrealo con:  git clone https://github.com/Fer91-Dev/creditflow-docs.git "${DESTINO}"`);
  process.exit(1);
}

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

writeFileSync(join(DESTINO, "LEEME.md"), `# Respaldo de la documentación de CreditFlow

Copia PRIVADA de lo que no está en el repo del sistema. Se actualiza con \`npm run respaldo:docs\`
desde \`creditflow-next\`. Cada corrida es un commit: el historial permite volver a cualquier versión.

## Cómo restaurar en una PC nueva

| Carpeta del respaldo | Va en |
|---|---|
| \`sistema/*.md\` | la raíz de \`creditflow-next/\` |
| \`sistema/.claude/\` | \`creditflow-next/.claude/\` |
| \`skills/\` | \`ProyectoSilvio/.claude/skills/\` |
| \`memoria/\` | \`C:\\Users\\<usuario>\\.claude\\projects\\<carpeta-del-proyecto>\\memory\\\` |
| \`entrega/\`, \`logos/\` | \`ProyectoSilvio/entrega/\` y \`ProyectoSilvio/logos/\` |

El nombre de \`<carpeta-del-proyecto>\` sale de la ruta donde se abra el proyecto (para
\`F:\\ProyectoSilvio\` es \`f--ProyectoSilvio\`). Con el código (repo \`Credit-Flow-Next\`) más esto,
el sistema se retoma entero.
`);

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
    if (!/\.(md|html|json|txt)$/i.test(f)) continue;
    const texto = readFileSync(p, "utf8");
    for (const re of PATRONES) if (re.test(texto)) hallazgos.push(`${relative(DESTINO, p)}  (${re.source.slice(0, 30)}…)`);
  }
};
revisar(DESTINO);
if (hallazgos.length) {
  console.error("🔴 NO SE SUBIÓ NADA: hay algo con forma de clave real en:\n  " + hallazgos.join("\n  "));
  process.exit(2);
}

const git = (...a) => execFileSync("git", ["-C", DESTINO, ...a], { encoding: "utf8" }).trim();
git("add", "-A");
const cambios = git("status", "--porcelain");
if (!cambios) { console.log("Sin cambios: el respaldo ya estaba al día."); process.exit(0); }
const n = cambios.split("\n").length;
const fecha = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }).format(new Date());
git("commit", "-q", "-m", `respaldo ${fecha} (${n} archivos)`);
const rama = git("rev-parse", "--abbrev-ref", "HEAD");
execFileSync("git", ["-C", DESTINO, "push", "-q", "-u", "origin", rama], { stdio: "inherit" });
console.log(`✅ Respaldo subido: ${n} archivos cambiados · ${git("rev-parse", "--short", "HEAD")} → github.com/Fer91-Dev/creditflow-docs (privado)`);
