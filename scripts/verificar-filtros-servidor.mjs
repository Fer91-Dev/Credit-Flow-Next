/**
 * VERIFICA QUE FILTRAR EN EL SERVIDOR DEVUELVA LO MISMO QUE FILTRABA EL NAVEGADOR.
 *
 * Las pantallas de Cobranzas y Créditos se traían la cartera entera y filtraban en el
 * navegador. Al pasar eso al servidor hay una traducción peligrosa en el medio: la severidad
 * de la mora se decide por DÍAS de atraso (`severidadMora`) y la base solo entiende de FECHAS
 * de vencimiento (`rangoDeSeveridad`). Es la misma regla mirada del otro lado, y si las dos
 * no coinciden exactamente, un crédito de 30 días aparece "crítico" en un lado y "alto" en el
 * otro — que es un error que este sistema ya tuvo, documentado en `verificar-reportes.mjs`.
 *
 * 🔴 CÓMO SE PRUEBA LO QUE IMPORTA. No alcanza con mirar la cartera que haya: con 19 créditos
 * los BORDES de los tramos (el día 15, el 16, el 30, el 31) probablemente no estén. Así que se
 * toma UN crédito y se le mueve el `proximo_pago` a cada día de borde, se le pregunta al
 * servidor en qué tramo cae, y se compara contra lo que dice la regla de los días. Al terminar
 * —pase lo que pase— se le devuelve su fecha original.
 *
 *   QA_PASSWORD="$(cat qa.pass)" node --env-file=.env.local scripts/verificar-filtros-servidor.mjs
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
const lista = async (qs) => (await get(`/api/creditos?limit=1000&${qs}`)).data?.creditos ?? [];

/** La regla de siempre, por DÍAS. Es contra esto que se compara el filtro del servidor. */
const severidadPorDias = (dias, t) =>
  dias <= 0 ? "al_dia" : dias <= t.media_hasta ? "media" : dias <= t.alta_hasta ? "alta" : "critica";

let restaurar = null;

try {
  H1("FILTRAR EN EL SERVIDOR");

  const cfgRes = await get("/api/configuracion");
  if (!cfgRes.data) {
    console.error("ABORTADO: no se pudo leer la configuracion del motor:", cfgRes.error ?? ("HTTP " + cfgRes.status));
    process.exit(1);
  }
  const cfg = cfgRes.data;
  const tramos = cfg.cobranzaConfig?.tramos_mora ?? { media_hasta: 15, alta_hasta: 30 };
  console.log(`\n  tramos de la financiera: media hasta ${tramos.media_hasta} días · alta hasta ${tramos.alta_hasta}`);

  // ── 1. Sin parámetros nuevos, nada cambió ────────────────────────────────
  H2("Sin los parametros nuevos, la respuesta es la de siempre");
  const todos = await lista("");
  const r = await get("/api/creditos?limit=1000");
  ok(Array.isArray(r.data?.creditos), "la lista responde", `${todos.length} créditos`);
  ok(typeof r.data?.total === "number" && r.data.total === todos.length, "el total sigue viajando", `${r.data?.total}`);
  const ordenados = todos.map((c) => c.numero);
  ok(ordenados.length > 1, "hay créditos suficientes para comparar", `${ordenados.length}`);

  // ── 2. La búsqueda ───────────────────────────────────────────────────────
  H2("La busqueda encuentra lo mismo que el buscador del navegador");
  const uno = todos.find((c) => c.cliente?.apellido && c.numero);
  if (uno) {
    const porApellido = await lista(`q=${encodeURIComponent(uno.cliente.apellido)}`);
    ok(porApellido.some((c) => c.id === uno.id), "por apellido", `"${uno.cliente.apellido}" → ${porApellido.length}`);

    const minuscula = uno.cliente.apellido.toLowerCase();
    const porMinuscula = await lista(`q=${encodeURIComponent(minuscula)}`);
    ok(porMinuscula.some((c) => c.id === uno.id), "sin importar mayusculas", `"${minuscula}"`);

    const porNumero = await lista(`q=${uno.numero}`);
    ok(porNumero.some((c) => c.id === uno.id), "por numero suelto", `"${uno.numero}"`);

    const etiqueta = `CRD-${String(uno.numero).padStart(6, "0")}`;
    const porEtiqueta = await lista(`q=${encodeURIComponent(etiqueta)}`);
    ok(porEtiqueta.some((c) => c.id === uno.id), "por la etiqueta completa", etiqueta);

    if (uno.cliente.documento) {
      const porDoc = await lista(`q=${uno.cliente.documento}`);
      ok(porDoc.some((c) => c.id === uno.id), "por documento", uno.cliente.documento);
    }
    /* 🔴 EL CASO QUE ROMPE UNA BUSQUEDA MUDADA AL SERVIDOR: el nombre COMPLETO. El buscador
       del navegador comparaba contra "nombre apellido" junto; la base los tiene en dos
       columnas, asi que "Juan Perez" no matchea ninguna de las dos por separado. */
    const completo = `${uno.cliente.nombre} ${uno.cliente.apellido}`;
    const porCompleto = await lista(`q=${encodeURIComponent(completo)}`);
    ok(porCompleto.some((c) => c.id === uno.id), "por nombre COMPLETO (nombre + apellido)", `"${completo}"`);

    const alReves = `${uno.cliente.apellido} ${uno.cliente.nombre}`;
    const porReves = await lista(`q=${encodeURIComponent(alReves)}`);
    ok(porReves.some((c) => c.id === uno.id), "y tambien al reves", `"${alReves}"`);

    const parcial = `${uno.cliente.nombre.slice(0, 3)} ${uno.cliente.apellido.slice(0, 3)}`;
    const porParcial = await lista(`q=${encodeURIComponent(parcial)}`);
    ok(porParcial.some((c) => c.id === uno.id), "con las dos palabras cortadas", `"${parcial}"`);

    const vacio = await lista(`q=${encodeURIComponent("zzz-no-existe-zzz")}`);
    ok(vacio.length === 0, "algo que no existe devuelve vacio, no todo", `${vacio.length}`);

    /* Y que NO devuelva de mas: dos palabras que existen pero en clientes DISTINTOS no
       pueden traer a ninguno de los dos.

       🔴 EL CRUCE TIENE QUE SER IMPOSIBLE DE VERDAD. Antes se tomaba el nombre de uno y el
       apellido de otro con solo pedir que el APELLIDO fuera distinto, dando por sentado que
       esa combinacion no le corresponde a nadie. Es falso en cuanto dos clientes comparten
       el nombre: la base tiene decenas sembrados que se llaman todos "Comision Refi …", asi
       que el cruce armaba el nombre completo de un cliente real y la busqueda —que funciona
       bien— lo encontraba. Ahora se exige que las dos palabras difieran Y que ningun cliente
       de la base las tenga juntas; si no hay un par asi, la comprobacion se saltea. */
    const distintoNombre = todos.find(
      (c) =>
        c.cliente?.apellido &&
        c.cliente.apellido !== uno.cliente.apellido &&
        c.cliente.nombre !== uno.cliente.nombre,
    );
    if (distintoNombre) {
      const cruzado = `${uno.cliente.nombre} ${distintoNombre.cliente.apellido}`;
      const a = uno.cliente.nombre.toLowerCase();
      const b = distintoNombre.cliente.apellido.toLowerCase();
      const alguienLoTiene = todos.some((c) => {
        const completo = `${c.cliente?.nombre ?? ""} ${c.cliente?.apellido ?? ""}`.toLowerCase();
        return completo.includes(a) && completo.includes(b);
      });
      if (alguienLoTiene) {
        console.log(`     (el cruce "${cruzado}" le corresponde a un cliente real: se saltea)`);
      } else {
        const porCruzado = await lista(`q=${encodeURIComponent(cruzado)}`);
        ok(
          porCruzado.length === 0,
          "palabras de dos clientes distintos no traen a ninguno",
          `"${cruzado}" → ${porCruzado.length}`,
        );
      }
    }
  }

  // ── 3. Los tramos de mora, contra la regla de los días ───────────────────
  H2("Los tramos: el filtro del servidor contra la regla de los dias");
  for (const sev of ["al_dia", "media", "alta", "critica"]) {
    const esperados = new Set(todos.filter((c) => severidadPorDias(c.dias_mora ?? 0, tramos) === sev).map((c) => c.id));
    const devueltos = new Set((await lista(`mora=${sev}`)).map((c) => c.id));
    const iguales = esperados.size === devueltos.size && [...esperados].every((id) => devueltos.has(id));
    ok(iguales, `mora=${sev}`, `servidor ${devueltos.size} · regla ${esperados.size}`);
  }
  const enMoraEsperados = new Set(todos.filter((c) => (c.dias_mora ?? 0) > 0).map((c) => c.id));
  const enMoraDevueltos = new Set((await lista("mora=en_mora")).map((c) => c.id));
  ok(
    enMoraEsperados.size === enMoraDevueltos.size && [...enMoraEsperados].every((id) => enMoraDevueltos.has(id)),
    "mora=en_mora", `servidor ${enMoraDevueltos.size} · regla ${enMoraEsperados.size}`,
  );

  // ── 4. LOS BORDES, que es donde se rompe ─────────────────────────────────
  H2("Los bordes de cada tramo, movidos a proposito");
  const cobaya = todos.find((c) => c.proximo_pago && ["activo", "vencido"].includes(c.estado));
  if (!cobaya) {
    console.log("     (no hay un crédito con próximo pago para usar de prueba: se saltea)");
  } else {
    const original = (await db.creditos.findUnique({ where: { id: cobaya.id }, select: { proximo_pago: true } })).proximo_pago;
    restaurar = { id: cobaya.id, proximo_pago: original };
    const M = tramos.media_hasta, A = tramos.alta_hasta;
    const bordes = [...new Set([0, 1, M - 1, M, M + 1, A - 1, A, A + 1])].filter((d) => d >= 0).sort((a, b) => a - b);
    /**
     * 🔴 EL DÍA COMERCIAL ARGENTINO, no el UTC.
     *
     * Esta prueba calculaba su "hoy" con `Date.UTC(...)` y el sistema usa `hoyComercial()`,
     * que es el día en Buenos Aires. Entre las 21:00 y la medianoche de Argentina los dos no
     * son el mismo día, y las ocho comprobaciones de los bordes se corrían 24 horas: el
     * verificador acusaba un defecto que no existía (y, peor, podría tapar uno real el resto
     * del día). Se calcula igual que en el resto del sistema.
     */
    const hoyAR = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const base = new Date(`${hoyAR}T00:00:00.000Z`).getTime();

    for (const d of bordes) {
      await db.creditos.update({
        where: { id: cobaya.id },
        data: { proximo_pago: new Date(base - d * 86400000) },
      });
      const esperado = severidadPorDias(d, tramos);
      // En qué tramo lo pone el SERVIDOR: se le pregunta por cada uno y se ve en cuál cae.
      const caeEn = [];
      for (const sev of ["al_dia", "media", "alta", "critica"]) {
        const ids = (await lista(`mora=${sev}`)).map((c) => c.id);
        if (ids.includes(cobaya.id)) caeEn.push(sev);
      }
      ok(
        caeEn.length === 1 && caeEn[0] === esperado,
        `con ${d} día${d === 1 ? "" : "s"} de atraso → ${esperado}`,
        caeEn.length === 1 ? `servidor dice ${caeEn[0]}` : `servidor lo pone en ${caeEn.length} tramos: ${caeEn.join(", ") || "ninguno"}`,
      );
    }
    await db.creditos.update({ where: { id: cobaya.id }, data: { proximo_pago: original } });
    restaurar = null;
  }

  // ── 5. El orden y los ids ────────────────────────────────────────────────
  H2("El orden por mora y la lista de ids");
  const porMora = await lista("orden=mora&mora=en_mora");
  const dias = porMora.map((c) => c.dias_mora ?? 0);
  ok(
    dias.every((d, i) => i === 0 || dias[i - 1] >= d),
    "orden=mora pone al mas atrasado primero",
    dias.slice(0, 5).join(" ≥ ") || "(sin morosos)",
  );

  const soloIds = (await get("/api/creditos?solo_ids=1&mora=en_mora")).data;
  const idsLista = new Set(porMora.map((c) => c.id));
  ok(
    soloIds?.ids?.length === idsLista.size && soloIds.ids.every((id) => idsLista.has(id)),
    "solo_ids devuelve exactamente los mismos ids que la lista",
    `ids ${soloIds?.ids?.length} · lista ${idsLista.size}`,
  );

  // ── 6. La paginación no pierde ni repite ─────────────────────────────────
  H2("Paginar no pierde ni repite a nadie");
  const p1 = (await get("/api/creditos?limit=5&offset=0")).data?.creditos ?? [];
  const p2 = (await get("/api/creditos?limit=5&offset=5")).data?.creditos ?? [];
  const juntas = new Set([...p1, ...p2].map((c) => c.id));
  ok(juntas.size === p1.length + p2.length, "dos paginas seguidas no repiten", `${p1.length} + ${p2.length} = ${juntas.size}`);
  const primeros10 = (await get("/api/creditos?limit=10&offset=0")).data?.creditos ?? [];
  ok(
    primeros10.length === juntas.size && primeros10.every((c) => juntas.has(c.id)),
    "y juntas dan lo mismo que pedir las 10 de una",
  );
} finally {
  if (restaurar) {
    await db.creditos.update({ where: { id: restaurar.id }, data: { proximo_pago: restaurar.proximo_pago } });
    console.log("\n  (se devolvió el crédito de prueba a su fecha original)");
  }
  await db.$disconnect();
}

H1(fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
