/**
 * VERIFICA QUE LAS LISTAS QUE CRECEN CON LA OPERACIÓN FILTREN Y PAGINEN EN LA BASE.
 *
 * Fernando (23/09/2026): "¿de qué vale entregarlo sabiendo que hay fallas?". Estas son las
 * pantallas que se quedaban cortas al crecer, medidas una por una.
 *
 * 🔴 EL DEFECTO QUE BUSCA. Una lista topeada que se filtra en el navegador no falla: MIENTE.
 * "Pagos anulados" mostraba los anulados que hubiera entre los últimos 500 cobros y se
 * presentaba como el historial completo. Y `pagos` crece un renglón por cobro —unos 2.400 al
 * año en una financiera chica—, así que el tope se pasa en dos o tres meses de uso real.
 *
 * La prueba no se conforma con "responde": compara lo que devuelve el endpoint filtrado
 * contra una cuenta hecha directamente en la base, y comprueba que paginar no pierda ni
 * repita a nadie.
 *
 *   QA_PASSWORD="$(cat qa.pass)" node --env-file=.env.local scripts/verificar-listas-servidor.mjs
 */
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

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
const H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
const get = async (ruta) => (await (await fetch(`${BASE}${ruta}`, { headers: H })).json());

/** Una lista paginada no puede perder ni repetir: dos medias páginas = una entera. */
async function paginaBien(ruta, clave, etiqueta) {
  const juntas = await get(`${ruta}limit=4&offset=0`);
  const segunda = await get(`${ruta}limit=4&offset=4`);
  const a = juntas.data?.[clave] ?? [];
  const b = segunda.data?.[clave] ?? [];
  if (a.length + b.length === 0) { console.log(`     (${etiqueta}: sin datos suficientes, se saltea)`); return; }
  const ids = new Set([...a, ...b].map((x) => x.id));
  ok(ids.size === a.length + b.length, `${etiqueta}: dos páginas seguidas no repiten`, `${a.length} + ${b.length} = ${ids.size}`);
  const ocho = (await get(`${ruta}limit=8&offset=0`)).data?.[clave] ?? [];
  ok(
    ocho.length === ids.size && ocho.every((x) => ids.has(x.id)),
    `${etiqueta}: y juntas dan lo mismo que pedirlas de una`,
  );
}

try {
  H1("LAS LISTAS QUE CRECEN CON LA OPERACION");

  // ── PAGOS ────────────────────────────────────────────────────────────────
  H2("Pagos: el historial se filtra y se pagina en la base");
  const totalPagos = await db.pagos.count();
  const anuladosBase = await db.pagos.count({ where: { anulado: true } });
  const r1 = await get("/api/pagos?limit=500");
  ok(r1.ok, "el historial responde", `${r1.data?.pagos?.length ?? 0} de ${r1.data?.total}`);
  ok(r1.data?.total === totalPagos, "el total es el de la tabla, no el de la página", `${r1.data?.total} · base ${totalPagos}`);

  const rAnu = await get("/api/pagos?limit=500&anulado=1");
  const anuladosApi = rAnu.data?.pagos ?? [];
  ok(rAnu.data?.total === anuladosBase, "anulado=1 cuenta TODOS los anulados", `api ${rAnu.data?.total} · base ${anuladosBase}`);
  ok(anuladosApi.every((p) => p.anulado), "y todos los que devuelve lo están");

  const rVivos = await get("/api/pagos?limit=500&anulado=0");
  ok(
    (rVivos.data?.total ?? 0) + (rAnu.data?.total ?? 0) === totalPagos,
    "anulados + vivos = el historial entero",
    `${rAnu.data?.total} + ${rVivos.data?.total} = ${totalPagos}`,
  );

  const unPago = await db.pagos.findFirst({ select: { fecha: true }, orderBy: { fecha: "desc" } });
  if (unPago) {
    const dia = unPago.fecha.toISOString().slice(0, 10);
    const delDia = await db.pagos.count({ where: { fecha: new Date(`${dia}T00:00:00.000Z`), anulado: false } });
    const rDia = await get(`/api/pagos?limit=500&anulado=0&fecha=${dia}`);
    ok(rDia.data?.total === delDia, `los cobros de un día (${dia})`, `api ${rDia.data?.total} · base ${delDia}`);
  }

  /* El resumen (cobrado hoy/ayer) SIEMPRE lo agregó el servidor: se comprueba que no dependa
     del filtro ni de la página, que es lo que lo haría mentir. */
  const resumenSinFiltro = (await get("/api/pagos?limit=1")).data?.resumen;
  const resumenConFiltro = (await get("/api/pagos?limit=1&anulado=1")).data?.resumen;
  ok(
    JSON.stringify(resumenSinFiltro) === JSON.stringify(resumenConFiltro),
    "el resumen de la terminal no cambia con el filtro ni con la página",
  );

  await paginaBien("/api/pagos?", "pagos", "Pagos");

  // ── ACUERDOS ─────────────────────────────────────────────────────────────
  H2("Acuerdos: los importes los suma la base, no la pagina");
  {
    const r = await get("/api/cobranza/acuerdos?limit=1");
    ok(r.ok, "responde", r.error ?? "");
    if (r.ok) {
      const acordadoBase = (await db.acuerdos_pago.aggregate({ _sum: { monto_acordado: true } }))._sum.monto_acordado ?? 0;
      const cobradoBase = (await db.acuerdo_cuota.aggregate({ _sum: { pagado: true } }))._sum.pagado ?? 0;
      const totalBase = await db.acuerdos_pago.count();
      ok(r.data.total === totalBase, "el total es el de la tabla", `api ${r.data.total} · base ${totalBase}`);
      ok(Math.abs(r.data.total_acordado - acordadoBase) <= 0.02, "total acordado", `api ${r.data.total_acordado} · base ${acordadoBase}`);
      ok(Math.abs(r.data.total_cobrado - cobradoBase) <= 0.02, "total cobrado", `api ${r.data.total_cobrado} · base ${cobradoBase}`);
      /* Y que NO dependa de cuantos se pidan: es el defecto que se esta cerrando. */
      const r2 = await get("/api/cobranza/acuerdos?limit=200");
      ok(
        r2.data?.total_acordado === r.data.total_acordado && r2.data?.total_cobrado === r.data.total_cobrado,
        "los importes no cambian con el tamano de la pagina",
      );
    }
  }

  // ── INCOBRABLES ──────────────────────────────────────────────────────────
  H2("Incobrables: la pantalla pide solo los castigados");
  {
    const castigadosBase = await db.creditos.count({ where: { estado: "incobrable" } });
    const r = await get("/api/creditos?limit=1000&estado=incobrable");
    const filas = r.data?.creditos ?? [];
    ok(r.ok, "el filtro por estado responde", r.error ?? "");
    ok(filas.length === castigadosBase, "trae TODOS los castigados y solo esos", `api ${filas.length} · base ${castigadosBase}`);
    ok(filas.every((c) => c.estado === "incobrable"), "ninguno que no lo sea");
  }

  // ── VENCIMIENTOS ─────────────────────────────────────────────────────────
  H2("Vencimientos: el rango lo filtra la base, con la cuota pactada adentro");
  {
    const hoyISO = new Date().toISOString().slice(0, 10);
    const en30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const r = await get(`/api/creditos?limit=1000&estado=vivos&vence_desde=${hoyISO}&vence_hasta=${en30}`);
    const ids = new Set((r.data?.creditos ?? []).map((c) => c.id));
    ok(r.ok, "el rango responde", `${ids.size} créditos entre ${hoyISO} y ${en30}`);

    /* Quiénes DEBERÍAN estar, contado desde la base por los dos caminos. */
    const porPlan = await db.creditos.findMany({
      where: {
        estado: { in: ["activo", "vencido"] },
        proximo_pago: { gte: new Date(`${hoyISO}T00:00:00.000Z`), lte: new Date(`${en30}T00:00:00.000Z`) },
      },
      select: { id: true },
    });
    const porPactada = await db.acuerdo_cuota.findMany({
      where: {
        vencimiento: { gte: new Date(`${hoyISO}T00:00:00.000Z`), lte: new Date(`${en30}T00:00:00.000Z`) },
        estado: { not: "pagada" },
        acuerdo: { estado: "vigente", credito: { estado: { in: ["activo", "vencido"] } } },
      },
      select: { acuerdo: { select: { credito_id: true } } },
    });
    const esperados = new Set([...porPlan.map((c) => c.id), ...porPactada.map((q) => q.acuerdo.credito_id)]);
    ok(
      ids.size === esperados.size && [...esperados].every((id) => ids.has(id)),
      "trae exactamente los que vencen por el plan O por su cuota pactada",
      `api ${ids.size} · base ${esperados.size}`,
    );
    if (porPactada.length > 0) {
      const porAcuerdo = porPactada[0].acuerdo.credito_id;
      ok(ids.has(porAcuerdo), "incluye el que vence SOLO por su acuerdo (el caso que fallaba)");
    }
  }

  // ── CLIENTES (el buscador de la terminal) ────────────────────────────────
  H2("Clientes: el buscador de la terminal pregunta a la base");
  const cli = await db.clientes.findFirst({ where: { apellido: { not: null } }, select: { nombre: true, apellido: true, documento: true } });
  if (cli) {
    const porApellido = (await get(`/api/clientes?limit=1000&q=${encodeURIComponent(cli.apellido)}`)).data?.clientes ?? [];
    ok(porApellido.some((c) => c.apellido === cli.apellido), "encuentra por apellido", `"${cli.apellido}" → ${porApellido.length}`);
    if (cli.documento) {
      const porDoc = (await get(`/api/clientes?limit=1000&q=${cli.documento}`)).data?.clientes ?? [];
      ok(porDoc.some((c) => c.documento === cli.documento), "y por documento", cli.documento);
    }
    const nada = (await get(`/api/clientes?limit=1000&q=zzzz-no-existe`)).data;
    ok((nada?.clientes?.length ?? 0) === 0, "lo que no existe devuelve vacío, no todo");
  }
} finally {
  await db.$disconnect();
}

H1(fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
