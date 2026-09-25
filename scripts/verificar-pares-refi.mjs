/**
 * VERIFICA QUE LA PESTAÑA REFINANCIADOS NO SE QUEDE CORTA NI MIENTA.
 *
 * Fernando (24/09/2026): "no entregar el sistema si sabés que tiene defectos".
 *
 * 🔴 EL DEFECTO QUE BUSCA. Esa pestaña muestra pares "origen → crédito nuevo" y los armaba
 * cruzando en el navegador la lista de créditos consigo misma. Esa lista viene topeada y
 * ordenada por fecha de alta descendente, o sea que trae los créditos MÁS NUEVOS. Las
 * refinanciaciones son nuevas; sus orígenes son viejos. Conclusión: pasado el tope, los
 * orígenes eran exactamente los que se caían, y se veían pares a medias.
 *
 * Y peor que la tabla: los KPI —"tasa de recupero", "capital consolidado"— se calculaban
 * sobre esa misma ventana y se presentaban como el historial completo. El aviso de lista
 * recortada hablaba de la TABLA; de los números no decía nada.
 *
 * Se comprueban las tres cosas que tienen que valer para siempre:
 *   1. cada refinanciación viaja CON su origen;
 *   2. paginar por operación no pierde ni repite;
 *   3. los KPI salen del historial entero, no de la página.
 *
 *   QA_PASSWORD="$(cat qa.pass)" node --env-file=.env.local scripts/verificar-pares-refi.mjs
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(2);
}
const BASE = process.env.BASE ?? "http://localhost:3000";
const db = new PrismaClient();

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
  H1("LA PESTANA REFINANCIADOS, CONTRA LA BASE");

  const totalRefiBase = await db.creditos.count({ where: { es_refinanciacion: true } });
  console.log(`\n  refinanciaciones en la base: ${totalRefiBase}`);
  if (totalRefiBase === 0) {
    console.log("  (no hay ninguna: nada que verificar)");
    process.exit(0);
  }

  // ── 1. El par llega ENTERO ────────────────────────────────────────────────
  H2("Cada refinanciacion viaja CON su origen");
  {
    const r = await get("/api/creditos?refi=pares&limit=100");
    ok(r.ok, "el modo pares responde", r.error ?? "");
    const filas = r.data?.creditos ?? [];
    const porId = new Set(filas.map((c) => c.id));
    const nuevos = filas.filter((c) => c.es_refinanciacion);

    ok(r.data?.total === totalRefiBase, "el total son OPERACIONES, no filas", `api ${r.data?.total} · base ${totalRefiBase}`);
    ok(nuevos.length === totalRefiBase, "vienen todas las refinanciaciones", `${nuevos.length}`);

    /* El corazon del asunto: el origen de cada una tiene que estar en la MISMA respuesta.
       Es lo que fallaba, y fallaba en silencio. */
    const sinOrigen = nuevos.filter((c) => c.refinancia_a && !porId.has(c.refinancia_a));
    ok(sinOrigen.length === 0, "🔴 ninguna quedo sin su origen en la respuesta",
      sinOrigen.length ? `${sinOrigen.length} sin origen` : `${nuevos.length} pares completos`);

    /* Y el origen tiene que venir ENRIQUECIDO como cualquier fila: el comparador lo abre
       entero. Si llegara pelado, la pantalla rompe recien al hacer click. */
    const unOrigen = filas.find((c) => !c.es_refinanciacion);
    if (unOrigen) {
      ok(
        unOrigen.cliente != null && unOrigen.numero != null && unOrigen.monto_original != null,
        "y el origen llega completo, no pelado",
        `CRD-${String(unOrigen.numero).padStart(6, "0")}`,
      );
    }
  }

  // ── 2. Paginar por operacion no pierde ni repite ──────────────────────────
  H2("Paginar por operacion: dos medias paginas = una entera");
  {
    const mitad = Math.max(1, Math.floor(totalRefiBase / 2));
    const p1 = await get(`/api/creditos?refi=pares&limit=${mitad}&offset=0`);
    const p2 = await get(`/api/creditos?refi=pares&limit=${mitad}&offset=${mitad}`);
    const ops = (r) => (r.data?.creditos ?? []).filter((c) => c.es_refinanciacion).map((c) => c.id);
    const a = ops(p1), b = ops(p2);

    ok(a.length === mitad, `la pagina 1 trae ${mitad} operacion(es)`, `${a.length}`);
    const juntas = new Set([...a, ...b]);
    ok(juntas.size === a.length + b.length, "las dos paginas no repiten ninguna",
      `${a.length} + ${b.length} = ${juntas.size}`);

    const enteras = ops(await get(`/api/creditos?refi=pares&limit=${mitad * 2}&offset=0`));
    ok(
      enteras.length === juntas.size && enteras.every((id) => juntas.has(id)),
      "y pedidas de una dan exactamente lo mismo",
      `${enteras.length} vs ${juntas.size}`,
    );

    /* Cada pagina tiene que seguir trayendo los origenes de SUS operaciones. */
    for (const [nro, r] of [[1, p1], [2, p2]]) {
      const filas = r.data?.creditos ?? [];
      const ids = new Set(filas.map((c) => c.id));
      const huerfanos = filas.filter((c) => c.es_refinanciacion && c.refinancia_a && !ids.has(c.refinancia_a));
      ok(huerfanos.length === 0, `la pagina ${nro} trae los origenes de sus propias operaciones`);
    }
  }

  // ── 3. El recorte por recupero lo hace la BASE ────────────────────────────
  H2("Al dia / volvieron a mora: lo recorta la base");
  {
    const alDia = await get("/api/creditos?refi=pares&limit=100&mora=al_dia");
    const enMora = await get("/api/creditos?refi=pares&limit=100&mora=en_mora");
    ok(
      (alDia.data?.total ?? 0) + (enMora.data?.total ?? 0) === totalRefiBase,
      "al dia + en mora = todas las operaciones",
      `${alDia.data?.total} + ${enMora.data?.total} = ${totalRefiBase}`,
    );
    const idsAlDia = new Set((alDia.data?.creditos ?? []).filter((c) => c.es_refinanciacion).map((c) => c.id));
    const idsEnMora = (enMora.data?.creditos ?? []).filter((c) => c.es_refinanciacion).map((c) => c.id);
    ok(idsEnMora.every((id) => !idsAlDia.has(id)), "y ninguna esta en los dos lados");
  }

  // ── 4. Los KPI, del historial ENTERO ──────────────────────────────────────
  H2("Los numeros de arriba salen de TODO el historial");
  {
    const k = (await get("/api/creditos/kpis")).data?.refi;
    ok(k != null, "el endpoint manda los KPI de refinanciacion");
    if (k) {
      const todas = await db.creditos.findMany({
        where: { es_refinanciacion: true },
        select: { monto_original: true, saldo_pendiente: true, proximo_pago: true },
      });
      const consolidadoBase = todas.reduce((s, c) => s + c.monto_original, 0);
      ok(k.total === totalRefiBase, "cuenta todas las operaciones", `api ${k.total} · base ${totalRefiBase}`);
      ok(Math.abs(k.consolidado - consolidadoBase) <= 0.02, "capital consolidado",
        `api ${f(k.consolidado)} · base ${f(consolidadoBase)}`);
      ok(k.alDia + k.enMora === k.total, "al dia + en mora cierra contra el total",
        `${k.alDia} + ${k.enMora} = ${k.total}`);
      ok(
        k.tasaRecupero === (k.total > 0 ? Math.round((k.alDia / k.total) * 100) : 0),
        "la tasa de recupero es la cuenta que dice ser", `${k.tasaRecupero}%`,
      );

      /* 🔴 Y LO QUE IMPORTA: que NO se muevan con la pagina ni con el filtro. Un KPI que
         cambia segun lo que se este mirando no es un KPI, es el pie de la tabla. */
      await get("/api/creditos?refi=pares&limit=1&offset=0");
      const k2 = (await get("/api/creditos/kpis")).data?.refi;
      ok(JSON.stringify(k) === JSON.stringify(k2), "no cambian al pasar de pagina");
    }
  }

  // ── 5. Clientes: el orden alfabetico lo hace la base ──────────────────────
  H2("Clientes: la lista completa (F3) viene de verdad en orden alfabetico");
  {
    const r = await get("/api/clientes?limit=5&orden=alfabetico");
    const nombres = (r.data?.clientes ?? []).map((c) => `${c.nombre} ${c.apellido ?? ""}`.trim());
    ok(r.ok && nombres.length > 0, "responde", nombres[0] ?? "");

    /* Contra la base: los 5 primeros por nombre tienen que ser ESOS cinco. Si el servidor
       mandara los mas nuevos y la pantalla los ordenara, el conjunto seria otro. */
    const esperados = (await db.clientes.findMany({
      orderBy: [{ nombre: "asc" }, { apellido: "asc" }, { id: "asc" }],
      take: 5,
      select: { id: true },
    })).map((c) => c.id);
    const traidos = (r.data?.clientes ?? []).map((c) => c.id);
    ok(
      traidos.length === esperados.length && traidos.every((id, i) => id === esperados[i]),
      "🔴 son los primeros del abecedario, no los mas nuevos ordenados entre si",
      nombres.join(" · "),
    );

    /* Y el total tiene que seguir siendo el padron entero, no la pagina. */
    ok(r.data?.total === (await db.clientes.count()), "el total sigue siendo el padron entero",
      `api ${r.data?.total}`);
  }
} finally {
  await db.$disconnect();
}

H1(fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
