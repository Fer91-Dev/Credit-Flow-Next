/**
 * auditar-api — barrido estático de los 92 Route Handlers contra las invariantes del proyecto.
 *
 * ── POR QUÉ EXISTE ──
 *
 * Las reglas que sostienen la seguridad de este SaaS no las hace cumplir ningún tipo: son
 * convenciones que hay que RECORDAR escribir en cada endpoint nuevo. `withTenant` olvidado en
 * una sola query rompe el aislamiento entre financieras y `tsc` no dice nada, porque un
 * `where` sin `tenant_id` compila perfecto. Este script busca exactamente eso.
 *
 * NO reemplaza leer el código: marca CANDIDATOS. Cada hallazgo se confirma a mano antes de
 * reportarlo — hay excepciones legítimas (rutas públicas, endpoints que no tocan la base) y
 * están anotadas acá abajo con su motivo.
 *
 *   node scripts/auditar-api.mjs           → informe completo
 *   node scripts/auditar-api.mjs --check   → sale con 1 si hay hallazgos (para CI)
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = "app/api";
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MUTACIONES = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Excepciones legítimas, con el motivo. Si una ruta está acá y el motivo ya no aplica, hay que
 * SACARLA, no ampliarla: esta lista es la única forma de que el barrido siga sirviendo.
 */
const EXCEPCIONES = {
  "auth/login/route.ts":        "pública por diseño (PUBLIC_PATHS): no hay sesión todavía",
  "auth/recuperar/route.ts":    "pública por diseño: recuperación de contraseña pre-login",
  "cron/cobranza-notificaciones/route.ts": "job externo sin sesión; se protege con Bearer CRON_SECRET",
  "georef/route.ts":            "proxy a la API pública de georef AR; no toca la base",
  "cotizacion/route.ts":        "proxy a dolarapi.com; no toca la base",
};

/**
 * Excepciones POR REGLA, verificadas a mano el 2026-09-02. Distinto de `EXCEPCIONES`, que
 * exime a la ruta entera: acá se apaga UNA regla y el resto se le sigue aplicando.
 *
 * 🔴 Cada entrada dice POR QUÉ. Si el motivo deja de ser cierto hay que BORRAR la línea, no
 * ampliarla. Una lista de excepciones sin motivo se convierte en el lugar donde se esconden
 * los bugs, y entonces el auditor deja de servir para lo único que sirve: que un hallazgo
 * nuevo se vea.
 */
const EXCEPCIONES_POR_REGLA = {
  "admin/financieras/route.ts":  { "queries de Prisma sin withTenant": "el owner del SaaS opera cross-tenant a propósito; barrera = requireOwner en cada handler (verificado)" },
  "admin/planes/route.ts":       { "queries de Prisma sin withTenant": "ídem", "findUnique sin chequeo de tenant": "ídem" },
  "admin/tenants/route.ts":      { "queries de Prisma sin withTenant": "ídem" },
  "admin/tenants/[id]/route.ts": { "queries de Prisma sin withTenant": "ídem", "findUnique sin chequeo de tenant": "ídem" },
  "branding/route.ts":           { "sin requireAuth/requireRole": "branding público pre-login (solo nombre + logo); excluye el tenant de plataforma" },
  "cron/suscripciones/route.ts": { "sin requireAuth/requireRole": "job externo; Bearer CRON_SECRET fail-closed en producción", "queries de Prisma sin withTenant": "degrada suscripciones vencidas de TODOS los tenants: es su trabajo", "handler que escribe SIN assertSameOrigin": "no lo llama un navegador" },
  "usuarios/check-username/route.ts": { "queries de Prisma sin withTenant": "el username es único GLOBAL, por eso no se filtra por tenant; requireRole(admin)", "findUnique sin chequeo de tenant": "ídem" },
  "clientes/route.ts":           { "toca créditos con rol vendedor y sin scoping": "DECISIÓN DOCUMENTADA (CLAUDE.md): estado_cuenta y score salen de TODOS los créditos del cliente; acotarlos mostraría deuda $0 de un moroso y el vendedor prestaría a ciegas" },
};

function archivos(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) archivos(p, acc);
    else if (e === "route.ts") acc.push(p);
  }
  return acc;
}

/** Quita comentarios y strings para que un `withTenant` mencionado en una nota no cuente. */
function codigoDesnudo(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

const hallazgos = [];
const add = (nivel, ruta, regla, detalle) => {
  if (EXCEPCIONES_POR_REGLA[ruta]?.[regla]) return; // verificado a mano; el motivo está arriba
  hallazgos.push({ nivel, ruta, regla, detalle });
};

const rutas = archivos(RAIZ).sort();
let conAuth = 0, mutaciones = 0;

for (const f of rutas) {
  const rel = relative(RAIZ, f).replace(/\\/g, "/");
  const src = readFileSync(f, "utf8");
  const code = codigoDesnudo(src);
  const exportados = METODOS.filter((m) => new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`).test(code));
  if (exportados.length === 0) continue;

  const exento = EXCEPCIONES[rel];
  const tieneAuth = /require(Auth|Role|Owner)\s*\(/.test(code);
  const usaPrisma = /prisma\.\w+\.\w+/.test(code);
  const lasMutaciones = exportados.filter((m) => MUTACIONES.includes(m));
  if (tieneAuth) conAuth++;
  mutaciones += lasMutaciones.length;

  // ── 1 · Autenticación ──
  if (!tieneAuth && !exento) {
    add("ALTO", rel, "sin requireAuth/requireRole", `exporta ${exportados.join(",")}`);
  }

  // ── 2 · Aislamiento multi-tenant ──
  if (usaPrisma && !exento) {
    // Cuenta queries de Prisma sobre tablas del negocio contra los usos de withTenant.
    const queries = (code.match(/prisma\.\w+\.(findMany|findFirst|findUnique|count|aggregate|groupBy|update|updateMany|delete|deleteMany|create|createMany|upsert)/g) ?? []);
    const conTenant = (code.match(/withTenant(And)?\s*\(/g) ?? []).length;
    const rawSql = /\$queryRaw|\$executeRaw/.test(code);
    if (queries.length > 0 && conTenant === 0 && !rawSql) {
      add("ALTO", rel, "queries de Prisma sin withTenant", `${queries.length} queries, 0 withTenant`);
    }
    // `findUnique` por id NO puede filtrar por tenant (el where solo admite la clave única):
    // si no se verifica el tenant después, un id de otra financiera entra igual.
    const findUnique = (code.match(/prisma\.\w+\.findUnique/g) ?? []).length;
    if (findUnique > 0 && !/findFirst/.test(code) && conTenant === 0) {
      add("MEDIO", rel, "findUnique sin chequeo de tenant", `${findUnique} findUnique y ningún withTenant`);
    }
  }

  /*
    ── 4 · Auditoría, POR HANDLER ──

    🔴 Mirar el archivo entero no alcanza y da los dos errores a la vez. Falsos POSITIVOS
    cuando la ruta audita desde su helper (`lib/arqueo.ts`, `lib/acuerdos.ts`,
    `lib/caja-vendedor.ts`), y —peor— falsos NEGATIVOS cuando UN handler audita y los otros
    no: así se pasó por alto que en metas el POST auditaba y el PATCH y el DELETE no.
    Se parte el archivo por handler y se sigue a los helpers que importa.
  */
  /*
    Un helper "audita" solo si LLAMA a registrarAuditoria, no si la declara.

    🔴 La primera versión de esto se autoengañaba: seguía los imports y leía `lib/audit.ts`,
    que contiene la palabra porque es donde la función ESTÁ DEFINIDA. Resultado: todo archivo
    que importara el helper quedaba marcado como auditado y el chequeo entero no encontraba
    nada nunca. Un detector que siempre dice "limpio" es peor que no tenerlo, porque se le
    cree. Por eso se excluye el módulo que la define y se exige la forma de LLAMADA.
  */
  const auditaEnHelper = (() => {
    const imports = [...src.matchAll(/from\s+"@\/(lib\/[\w./-]+)"/g)].map((m) => m[1]);
    for (const imp of imports) {
      if (imp === "lib/audit" || imp === "lib/stock") continue; // los que la DEFINEN
      for (const ext of [".ts", "/index.ts"]) {
        try {
          const t = readFileSync(imp + ext, "utf8");
          if (/await\s+registrarAuditoria\s*\(|await\s+registrarMovimientoStock\s*\(/.test(t)) return true;
        } catch { /* no existe con esa extensión */ }
      }
    }
    return false;
  })();

  // Corta el archivo en handlers para poder mirar cada uno por separado.
  const handlers = (() => {
    const re = /export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)/g;
    const cortes = [...code.matchAll(re)].map((m) => ({ metodo: m[1], i: m.index }));
    return cortes.map((c, k) => ({
      metodo: c.metodo,
      cuerpo: code.slice(c.i, k + 1 < cortes.length ? cortes[k + 1].i : code.length),
    }));
  })();

  for (const h of handlers) {
    if (!MUTACIONES.includes(h.metodo)) continue;
    const escribe = /prisma\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)|\$transaction|\$executeRaw/.test(h.cuerpo);
    if (!escribe) continue; // un POST que solo calcula (evaluar-riesgo) no muta nada

    if (!exento && !/assertSameOrigin/.test(h.cuerpo)) {
      add("MEDIO", rel, "handler que escribe SIN assertSameOrigin", h.metodo);
    }
    if (!exento && !auditaEnHelper && !/registrarAuditoria|registrarMovimientoStock/.test(h.cuerpo)) {
      add("MEDIO", rel, "handler que escribe SIN registrarAuditoria", h.metodo);
    }
  }

  /*
    ── ANTI-IDOR DEL VENDEDOR ──

    Un vendedor ve y opera SOLO sus créditos. La barrera es `scopeCreditosVendedor` combinado
    en el `where`. Si una ruta toca `creditos` y admite el rol vendedor sin combinarlo, ese
    vendedor ve la cartera de sus compañeros — que es el agujero más caro de este sistema y
    el que ya apareció una vez por la ficha del cliente.
  */
  const tocaCreditos = /prisma\.(creditos|cuotas|pagos|acciones_cobranza|acuerdos_pago)\./.test(code);
  const admiteVendedor = /requireRole\(\s*\[[^\]]*"vendedor"/.test(code) || /requireAuth\s*\(/.test(code);
  if (tocaCreditos && admiteVendedor && !exento && !/scopeCreditosVendedor|scopePlanillasPropias|vendedorPuedeEditar|vendedorId/.test(code)) {
    add("ALTO", rel, "toca créditos con rol vendedor y sin scoping", "falta scopeCreditosVendedor");
  }

  /*
    ── 5 · Escrituras multi-paso fuera de transacción, POR HANDLER ──

    🔴 Contarlas por ARCHIVO no sirve: sumaba las de PATCH con las de DELETE, que nunca corren
    juntas, y marcaba media API. Lo que importa es que UN handler haga varias escrituras
    encadenadas sin transacción — ahí un fallo a mitad deja datos huérfanos.
  */
  for (const h of handlers) {
    if (!MUTACIONES.includes(h.metodo)) continue;
    const escrituras = (h.cuerpo.match(/prisma\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)/g) ?? []).length;
    if (escrituras >= 3 && !/\$transaction/.test(h.cuerpo)) {
      add("MEDIO", rel, "handler con 3+ escrituras sin $transaction", `${h.metodo}: ${escrituras} escrituras`);
    }
  }

  // ── 6 · Día comercial argentino ──
  // `new Date()` para un INSTANTE está bien; el problema es usarlo como el DÍA de hoy.
  if (/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)|setUTCHours\(0/.test(code) && !/hoyComercial/.test(code)) {
    add("MEDIO", rel, "día calculado en UTC, no comercial AR", "usar hoyComercial()");
  }

  // ── 7 · Manejo de errores uniforme ──
  if (!/withErrorHandler/.test(code) && !exento) {
    add("BAJO", rel, "sin withErrorHandler", "el actor de auditoría sale null y los 500 no llegan a Sentry");
  }
}

// ── Informe ──
const ORDEN = { ALTO: 0, MEDIO: 1, BAJO: 2 };
hallazgos.sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel] || a.ruta.localeCompare(b.ruta));

console.log("=".repeat(78));
console.log("  AUDITORÍA ESTÁTICA DE LA API");
console.log("=".repeat(78));
console.log(`  ${rutas.length} archivos de ruta · ${conAuth} con barrera de auth · ${mutaciones} mutaciones`);

for (const nivel of ["ALTO", "MEDIO", "BAJO"]) {
  const g = hallazgos.filter((h) => h.nivel === nivel);
  if (g.length === 0) continue;
  console.log(`\n${"─".repeat(78)}\n${nivel} — ${g.length}\n${"─".repeat(78)}`);
  let regla = "";
  for (const h of g) {
    if (h.regla !== regla) { regla = h.regla; console.log(`\n  ▸ ${regla}`); }
    console.log(`      ${h.ruta.padEnd(52)} ${h.detalle}`);
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log(hallazgos.length === 0 ? "  SIN HALLAZGOS" : `  ${hallazgos.length} candidatos — confirmar a mano antes de reportar`);
console.log("=".repeat(78));

if (process.argv.includes("--check") && hallazgos.some((h) => h.nivel === "ALTO")) process.exit(1);
