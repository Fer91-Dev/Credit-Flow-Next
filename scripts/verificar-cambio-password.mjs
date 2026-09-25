/**
 * VERIFICA EL CAMBIO DE CONTRASEÑA POR EL SERVIDOR (auditoría 25/09/2026, H-A3).
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-cambio-password.mjs
 *
 * Usa el vendedor descartable (`qa-usuario-temporal.mjs crear-vendedor`) y le DEVUELVE su clave
 * al terminar, pase lo que pase: el resto de la batería entra con ella.
 *
 * 🔴 LO QUE SE PRUEBA SON LOS ATAQUES, no solo el camino feliz. El defecto era que con una
 * sesión robada se cambiaba la clave sin conocer la actual. Así que se intenta exactamente eso
 * —sin clave actual, con una equivocada, con una marca de recuperación falsa o ya usada— y
 * se exige que el servidor lo rechace. Y que al cambiarla, la OTRA sesión quede afuera.
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = "qa-vendedor@creditflow.local";
const QA = process.env.QA_PASSWORD;
if (!QA) { console.error("Falta QA_PASSWORD"); process.exit(1); }

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let pruebas = 0, fallos = 0;
const ok = (c, t, d = "") => { pruebas++; if (!c) fallos++; console.log(`  ${c ? "OK   " : "FALLA"} ${t}${d ? "  ·  " + d : ""}`); };
const H2 = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

const cookiesDe = (res) => res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("="));
async function login(password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier: EMAIL, password }),
  });
  const j = await r.json().catch(() => ({}));
  return j.ok ? cookiesDe(r).join("; ") : null;
}
async function cambiar(cookie, body, origin = BASE) {
  const r = await fetch(`${BASE}/api/perfil/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
/* SIN seguir redirecciones: una sesión muerta recibe 307 a /auth, y si `fetch` la sigue, la
   página de login contesta 200 y la sesión "parece" viva. Así falló esta prueba la primera vez.
   `/api/me/vendedor` tiene GET y el vendedor de prueba lo puede leer. */
const sesionViva = async (cookie) =>
  (await fetch(`${BASE}/api/me/vendedor`, { headers: { Cookie: cookie }, redirect: "manual" })).status === 200;

/* ¿La clave entra? Directo contra Supabase y no por el login de la app: el login tiene un
   límite de 10 por IP cada 5 minutos, y este verificador lo agotaba solo — dejando sin login
   al verificador que venía atrás. Lo que se prueba es el estado de la cuenta, no la pantalla. */
const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function claveEntra(password) {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: EMAIL, password });
  if (!error) await c.auth.signOut({ scope: "local" }).catch(() => {});
  return !error;
}

const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
const usuario = lista?.users?.find((u) => u.email === EMAIL);
if (!usuario) { console.error(`falta ${EMAIL}: corré qa-usuario-temporal.mjs crear-vendedor`); process.exit(1); }
const nueva = () => "Qa-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16) + "!x";

try {
  console.log("\n  CAMBIO DE CONTRASEÑA POR EL SERVIDOR");

  H2("con clave actual");
  const s1 = await login(QA);
  const s2 = await login(QA); // otra sesión de la misma persona, "en otro equipo"
  ok(!!s1 && !!s2, "dos sesiones abiertas de la misma persona");

  let r = await cambiar(s1, { nueva: nueva() });
  ok(r.status === 400, "🔴 sin la clave actual y sin link de recuperación se RECHAZA", `${r.status} ${r.error ?? ""}`);
  r = await cambiar(s1, { actual: "no-es-esta-1234", nueva: nueva() });
  ok(r.status === 401, "con la clave actual equivocada se rechaza", `${r.status} ${r.error ?? ""}`);
  r = await cambiar(s1, { actual: QA, nueva: "password1" });
  ok(r.status === 400 && r.code === "PASSWORD_DEBIL", "una clave débil se rechaza con la política del sistema", r.error ?? "");
  r = await cambiar(s1, { actual: QA, nueva: nueva() }, "https://atacante.example");
  ok(r.status === 403, "desde otro origen se rechaza (CSRF)", `${r.status}`);

  const clave1 = nueva();
  r = await cambiar(s1, { actual: QA, nueva: clave1 });
  ok(r.status === 200 && r.ok, "con la clave actual correcta, se cambia", `${r.status} ${r.error ?? ""}`);
  ok(!(await claveEntra(QA)), "la clave vieja ya no entra");
  ok(await claveEntra(clave1), "la nueva sí");
  /* Cambiar la clave cierra TODAS las sesiones en el acto, incluida la que hizo el cambio (lo
     hace Supabase). Es lo que conviene: si alguien más tenía la cuenta abierta, queda afuera ya. */
  ok(!(await sesionViva(s2)), "🔴 la OTRA sesión quedó afuera en el acto");
  ok(!(await sesionViva(s1)), "y la propia también: se vuelve a entrar con la clave nueva");

  H2("por link de recuperación");
  const { data: link, error: errLink } = await admin.auth.admin.generateLink({ type: "recovery", email: EMAIL });
  ok(!errLink && !!link?.properties?.hashed_token, "link de recuperación generado", errLink?.message ?? "");
  const conf = await fetch(`${BASE}/auth/confirm?token_hash=${link.properties.hashed_token}&type=recovery`, { redirect: "manual" });
  const cr = cookiesDe(conf);
  const marca = cr.find((c) => c.startsWith("cf_recuperacion="));
  ok(!!marca, "al validar el link queda la marca de recuperación", `${conf.status}`);
  const sesionRec = cr.join("; ");
  ok(await sesionViva(sesionRec), "el link deja una sesión abierta para elegir la clave nueva");

  r = await cambiar(sesionRec.replace(/cf_recuperacion=[^;]+/, "cf_recuperacion=falsa.123.abc"), { nueva: nueva() });
  ok(r.status === 400, "🔴 una marca FALSA no sirve", `${r.status}`);
  const clave2 = nueva();
  r = await cambiar(sesionRec, { nueva: clave2 });
  ok(r.status === 200 && r.ok, "con la marca verdadera se cambia sin la clave actual", `${r.status} ${r.error ?? ""}`);
  ok(await claveEntra(clave2), "y la clave nueva entra");
  /* El reenvío tiene que llegar a la ruta con una sesión VIVA —la del link murió con el
     cambio—, así que se entra de nuevo y se le pega la marca vieja. Sin eso la prueba mediría
     el middleware y no la marca. */
  const s4 = await login(clave2);
  r = await cambiar(`${s4}; ${marca}`, { nueva: nueva() });
  /* Exactamente 400 ("falta la clave actual"), no "cualquier cosa menos 200": un 429 del límite
     también es distinto de 200, y así fue como esta prueba pasó una vez sin probar nada. */
  ok(r.status === 400, "🔴 la marca es de UN SOLO USO: reenviarla no sirve", `${r.status} ${r.error ?? ""}`);

  /* Va ÚLTIMO a propósito: deja a la persona bloqueada 15 minutos en esta ruta. */
  H2("adivinar la clave actual");
  const s3 = await login(clave2);
  const intentos = [];
  for (let i = 0; i < 6; i++) intentos.push((await cambiar(s3, { actual: `adivino-${i}-xyz`, nueva: nueva() })).status);
  /* Ya hubo UN fallo en esta ventana ("clave actual equivocada", arriba): el corte llega al
     quinto fallo en total, o sea al cuarto de este bucle. */
  ok(intentos.slice(0, 4).every((x) => x === 401) && intentos.slice(4).every((x) => x === 429),
    "🔴 al quinto fallo se corta, aunque siga probando", intentos.join(" "));
  r = await cambiar(s3, { actual: clave2, nueva: nueva() });
  ok(r.status === 429, "y bloqueado, ni la clave correcta pasa hasta que venza la ventana", `${r.status}`);
} finally {
  const { error } = await admin.auth.admin.updateUserById(usuario.id, { password: QA });
  ok(!error && (await claveEntra(QA)), "el vendedor de prueba recuperó su clave para el resto de la batería");
}

console.log(`\n  ${fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
