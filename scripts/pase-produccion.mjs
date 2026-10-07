/**
 * PASE A PRODUCCIÓN EN UN SOLO COMANDO (07/10/2026 — ahorro de tokens).
 *
 *   npm run pase:produccion
 *   npm run pase:produccion -- --prueba     (hace 1 a 5 y NO pasa nada: para probar el script)
 *
 * Hace el procedimiento de siempre, en orden, y se FRENA en el primer paso que falle:
 *   1. El árbol local limpio y igual a origin/preview; hay commits para pasar.
 *   2. Ningún dev server de creditflow-next vivo (el build con un dev vivo corrompe `.next`).
 *   3. Respaldo de producción (`backup.yml`) y espera a que termine en success.
 *   4. `prisma migrate diff` contra producción: tiene que dar "No difference detected".
 *      (Si hay diferencia, el pase lleva migración: se hace a mano, ver REFERENCIA-SISTEMA.md.)
 *   5. `npm run build`.
 *   6. `git push origin origin/preview:main`.
 *   7. Espera el deploy de Production en GitHub y prueba que /auth responda 200.
 *
 * No toca datos de producción: solo lee el esquema y empuja código.
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROD = "https://credit-flow-next.vercel.app";
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const git = (...a) => execFileSync("git", a, { cwd: RAIZ, encoding: "utf8" }).trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const paso = (n, t) => console.log(`\n[${n}/7] ${t}`);
const frenar = (msg) => { console.error(`\n🔴 PASE FRENADO: ${msg}`); process.exit(1); };

// 1) Git
paso(1, "Código");
git("fetch", "-q", "origin");
if (git("status", "--porcelain")) frenar("hay cambios sin commitear.");
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/preview")) frenar("la copia local no es igual a origin/preview (¿falta push o pull?).");
const n = Number(git("rev-list", "--count", "origin/main..origin/preview"));
if (!n) { console.log("  Nada para pasar: main ya está igual a preview."); process.exit(0); }
console.log(`  ${n} commit(s) para pasar:\n  ` + git("log", "--oneline", "origin/main..origin/preview").split("\n").join("\n  "));

// 2) Dev server vivo
paso(2, "Servidor de desarrollo");
try {
  const ps = sh(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*creditflow-next*start-server*' } | Select-Object -ExpandProperty ProcessId"`);
  if (ps) frenar(`hay un dev server de creditflow-next vivo (PID ${ps.replace(/\s+/g, ", ")}). Cerralo antes del build.`);
} catch { /* sin PowerShell: se sigue */ }
console.log("  Ninguno vivo.");

// 3) Respaldo
paso(3, "Respaldo de producción");
const antes = new Date(Date.now() - 60_000).toISOString(); // margen por reloj de GitHub
sh("gh workflow run backup.yml");
let run = null;
for (let i = 0; i < 90; i++) {
  await dormir(10_000);
  const lista = JSON.parse(sh("gh run list --workflow=backup.yml --limit 3 --json databaseId,status,conclusion,createdAt"));
  run = lista.find((r) => r.createdAt >= antes.slice(0, 19)) ?? null;
  if (run && run.status === "completed") break;
  if (i % 3 === 0) process.stdout.write(`  ${run ? run.status : "esperando que arranque"}…\n`);
}
if (!run || run.status !== "completed") frenar("el respaldo no terminó en 15 minutos.");
if (run.conclusion !== "success") frenar(`el respaldo terminó en "${run.conclusion}".`);
console.log(`  ✔ Respaldo ${run.databaseId} OK.`);

// 4) Esquema
paso(4, "Esquema de producción vs código");
const env = readFileSync(join(RAIZ, ".env.production.local"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] ?? "").replace(/^"|"$/g, "");
if (!url) frenar("no encontré DATABASE_URL en .env.production.local.");
let diff = "";
try {
  diff = execFileSync("node", [join(RAIZ, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma"], { cwd: RAIZ, encoding: "utf8" });
} catch (e) { frenar("falló el migrate diff: " + String(e.message).slice(0, 200)); }
if (!/No difference detected/i.test(diff)) frenar("el esquema de producción NO coincide: este pase lleva migración (hacerla a mano).");
console.log("  ✔ Idéntico.");

// 5) Build
paso(5, "Build de producción");
rmSync(join(RAIZ, ".next"), { recursive: true, force: true });
try { execSync("npm run build", { cwd: RAIZ, stdio: ["ignore", "ignore", "pipe"] }); }
catch (e) { frenar("el build falló:\n" + String(e.stderr ?? e.message).slice(-1500)); }
console.log("  ✔ Compiló.");

if (process.argv.includes("--prueba")) { console.log("\n🧪 PRUEBA: pasos 1 a 5 OK. No se pasó nada a producción."); process.exit(0); }

// 6) Push
paso(6, "Pasar preview a main");
const sha = git("rev-parse", "origin/preview");
execFileSync("git", ["push", "-q", "origin", "origin/preview:main"], { cwd: RAIZ, stdio: "inherit" });
console.log(`  ✔ main = ${sha.slice(0, 7)}`);

// 7) Deploy
paso(7, "Deploy de Vercel");
let estado = null;
for (let i = 0; i < 60; i++) {
  await dormir(15_000);
  try {
    const id = sh(`gh api "repos/:owner/:repo/deployments?environment=Production&sha=${sha}" --jq ".[0].id"`);
    if (id) estado = sh(`gh api "repos/:owner/:repo/deployments/${id}/statuses" --jq ".[0].state"`);
  } catch { /* todavía no aparece */ }
  if (["success", "failure", "error"].includes(estado)) break;
}
if (estado !== "success") frenar(`el deploy terminó en "${estado ?? "sin respuesta en 15 minutos"}".`);
const http = (await fetch(`${PROD}/auth`)).status;
if (http !== 200) frenar(`el deploy salió bien pero /auth responde ${http}.`);
rmSync(join(RAIZ, ".next"), { recursive: true, force: true }); // el dev arranca limpio
console.log(`\n✅ EN PRODUCCIÓN: ${sha.slice(0, 7)} (${n} commit(s)) · deploy success · /auth 200`);
