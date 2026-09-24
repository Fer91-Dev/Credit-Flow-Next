/**
 * VERIFICA QUE LA DEUDA DE UN CASTIGADO SEA UNA SOLA EN TODO EL SISTEMA.
 *
 * 🔴 EL DEFECTO QUE BUSCA. Declarar un crédito INCOBRABLE frena el reloj de los punitorios,
 * y eso está bien. Pero la lista pasaba la fecha del castigo como "hoy", y ese parámetro
 * decide DOS cosas: hasta cuándo devenga la mora y QUÉ CUOTAS YA VENCIERON. Resultado: a un
 * castigado se le borraban las cuotas que vencieron DESPUÉS del castigo.
 *
 * Medido el 24/09/2026 sobre la demo: la lista decía $607.597,34 y $735.976,92 donde la ficha
 * —que sí separa los dos conceptos— decía $1.175.188,78 y $1.303.568,36. Tres cuotas de menos
 * en cada uno, $567.591,44. Y ese `vencido` es el que alimenta las campañas de recupero: se le
 * habría ofrecido al cliente cancelar por bastante menos de lo que debe.
 *
 * Un castigo no borra deuda: frena el reloj.
 *
 *   QA_PASSWORD="$(cat qa.pass)" node --env-file=.env.local scripts/verificar-castigados.mjs
 */
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(2);
}
const BASE = process.env.BASE ?? "http://localhost:3000";
const db = new PrismaClient();

/* Copia de ESTADOS_CUOTA_CERRADA: este script no compila TypeScript. Si algún día se agrega
   un estado nuevo allá y acá no, el verificador empieza a fallar — que es lo que corresponde. */
const CERRADAS = ["condonada", "trasladada", "anulada"];
const viva = (q) => q.estado !== "pagada" && !CERRADAS.includes(q.estado ?? "");

let pruebas = 0, fallos = 0;
const ok = (cond, texto, detalle = "") => {
  pruebas++; if (!cond) fallos++;
  console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`);
};
const H1 = (t) => console.log(`\n${"=".repeat(78)}\n  ${t}\n${"=".repeat(78)}`);
const H2 = (t) => console.log(`\n-- ${t} ${"-".repeat(Math.max(0, 74 - t.length))}`);
const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
const H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
const get = async (ruta) => (await (await fetch(`${BASE}${ruta}`, { headers: H })).json());

try {
  H1("LA DEUDA DE UN CASTIGADO");

  const castigados = (await get("/api/creditos?limit=100&estado=incobrable")).data?.creditos ?? [];
  console.log(`\n  castigados en la base: ${castigados.length}`);
  if (castigados.length === 0) {
    console.log("  (ninguno: nada que verificar)");
    process.exit(0);
  }

  for (const c of castigados) {
    const rot = `CRD-${String(c.numero).padStart(6, "0")}`;
    H2(`${rot} · ${c.cliente?.nombre ?? ""} ${c.cliente?.apellido ?? ""}`.trim());

    const cuotas = (await get(`/api/creditos/${c.id}/cuotas`)).data?.cuotas ?? [];
    ok(cuotas.length > 0, "el plan responde", `${cuotas.length} cuotas`);

    const ahora = Date.now();
    const vencidas = cuotas.filter((q) => viva(q) && new Date(q.fecha_vencimiento).getTime() < ahora);

    /* La misma cuenta que arma la ficha: lo impago de las cuotas vencidas más su mora. */
    const impago = vencidas.reduce((a, q) => {
      const pagado = q.pagado_capital + (q.pagado_interes ?? 0) + (q.pagado_cargos ?? 0);
      return a + Math.max(0, q.cuota_total - pagado);
    }, 0);
    const mora = vencidas.reduce((a, q) => a + (q.mora ?? 0), 0);
    const aCobrarFicha = Math.round((impago + mora) * 100) / 100;

    ok(
      Math.abs((c.vencido ?? 0) - aCobrarFicha) <= 0.02,
      "🔴 el `vencido` de la LISTA es el mismo que muestra la FICHA",
      `lista ${f(c.vencido)} · ficha ${f(aCobrarFicha)}`,
    );

    /* Y que las cuotas posteriores al castigo SIGAN contando. Es el corazón del defecto: se
       las tragaba enteras, capital incluido. */
    const cred = await db.creditos.findUnique({
      where: { id: c.id },
      select: { incobrable_at: true },
    });
    if (cred?.incobrable_at) {
      const corte = cred.incobrable_at.getTime();
      const posteriores = vencidas.filter((q) => new Date(q.fecha_vencimiento).getTime() > corte);
      if (posteriores.length > 0) {
        const suyo = posteriores.reduce((a, q) => {
          const pagado = q.pagado_capital + (q.pagado_interes ?? 0) + (q.pagado_cargos ?? 0);
          return a + Math.max(0, q.cuota_total - pagado);
        }, 0);
        ok(
          (c.vencido ?? 0) >= suyo,
          `las ${posteriores.length} cuota(s) vencidas DESPUÉS del castigo siguen contando`,
          `valen ${f(suyo)} y el vencido es ${f(c.vencido)}`,
        );
      } else {
        console.log("     (no hay cuotas vencidas después del castigo: se saltea)");
      }

      /* La MORA sí tiene que estar frenada: ninguna cuota puede devengar más allá del castigo. */
      const devengaDeMas = cuotas.filter((q) => {
        const venc = new Date(q.fecha_vencimiento).getTime();
        if (venc >= corte) return (q.mora ?? 0) > 0.02; // vencida después: no devenga nada
        return false;
      });
      ok(
        devengaDeMas.length === 0,
        "y la mora está FRENADA en la fecha del castigo",
        devengaDeMas.length ? `${devengaDeMas.length} cuota(s) devengan de más` : `castigado el ${cred.incobrable_at.toISOString().slice(0, 10)}`,
      );
    }
  }
} finally {
  await db.$disconnect();
}

H1(fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
