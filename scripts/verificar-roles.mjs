/**
 * VERIFICADOR DE ROLES Y MULTI-TENANT — con DOS sesiones reales, por la API.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-roles.mjs
 *
 * Requiere los dos usuarios descartables:
 *   QA_PASSWORD=... node --env-file=.env.local scripts/qa-usuario-temporal.mjs crear-vendedor
 *
 * 🔴 POR QUÉ NO ALCANZA CON EL AUDITOR ESTÁTICO
 *
 * `auditar-api.mjs` comprueba que cada ruta LLAME a `requireAuth`/`requireRole` y que sus
 * queries lleven `withTenant`. Eso descarta el olvido, que es el error más común, pero no
 * prueba que la barrera haga lo que dice: una ruta puede llamar a `requireRole(["admin"])`
 * y devolver igual datos ajenos si el scope del vendedor se arma mal más abajo, o si el
 * filtro se aplica a la entrada y no a la salida — que es exactamente lo que pasó con las
 * planillas de cobranza y con la ficha del cliente.
 *
 * Así que acá se abren DOS sesiones de verdad, admin y vendedor, y se le pide al sistema lo
 * que no debería dar. Lo que se verifica no es el código: es la respuesta.
 *
 * 🔴 Y SE VERIFICA LO QUE SÍ SE PUEDE, NO SOLO LO QUE NO
 *
 * La financiera tiene `cobranza_abierta` en true: cualquier agente puede COBRARLE al cliente
 * que tiene enfrente, aunque el crédito sea de otro. Es una decisión tomada, no un agujero —
 * con el scope aplicado por igual, el compañero abría la ficha y veía CERO créditos, el
 * sistema le decía al cliente que no debía nada y se iba con la plata. Un test que asumiera
 * "el vendedor no toca lo ajeno" reclamaría que arreglemos eso.
 *
 * Lo que sigue prohibido es LISTAR la cartera ajena: es información de comisiones y de
 * competencia interna.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}
const db = new PrismaClient();

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cent = (n) => Math.round(Number(n) * 100);
const igual = (a, b, tol = 1) => Math.abs(cent(a) - cent(b)) <= tol;

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => {
  pruebas++; if (!cond) fallos++;
  console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`);
};
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);
const H2 = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

async function sesion(identifier) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier, password: process.env.QA_PASSWORD }),
  });
  const j = await res.json();
  if (!j.ok) { console.error(`login ${identifier}:`, j.error); process.exit(1); }
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return async (metodo, ruta, body) => {
    const r = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/creditos` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    return { status: r.status, ...json };
  };
}

const admin = await sesion("qa-temporal@creditflow.local");
const vend = await sesion("qa-vendedor@creditflow.local");
console.log(`base: ${BASE}\ndos sesiones abiertas: admin y vendedor`);

const yo = await admin("GET", "/api/configuracion");
const COBRANZA_ABIERTA = yo.data?.cobranzaConfig?.cobranza_abierta === true;
console.log(`cobranza_abierta: ${COBRANZA_ABIERTA}`);

const fichaQA = await db.vendedores.findFirst({ where: { nombre: "QA Vendedor (temporal)" }, select: { id: true, tenant_id: true } });
if (!fichaQA) { console.error("falta el vendedor temporal: corré `qa-usuario-temporal.mjs crear-vendedor`"); process.exit(1); }
const TENANT = fichaQA.tenant_id;
const rot = (n) => `CRD-${String(n).padStart(6, "0")}`;
const sello = Date.now().toString().slice(-6);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE A — LO QUE EL VENDEDOR VE: su cartera, no la de al lado");
// ════════════════════════════════════════════════════════════════════════════

/*
  Un crédito que NO es suyo.

  🔴 `NOT: { vendedor_id: x }` no alcanza: en SQL, `vendedor_id <> x` es NULL para las filas
  sin dueño, así que las descarta en silencio — y los créditos que otorga un admin tienen
  `vendedor_id` nulo, que son casi todos los de esta base. Con ese filtro el script no
  encontraba ninguno y se caía.

  Para el scoping los dos casos son lo mismo: `scopeCreditosVendedor` filtra por SU id, así
  que ni el de otro agente ni el de la casa entran en su lista. Se prefiere uno con dueño
  distinto si existe, porque es el caso que además prueba que no se robe el mérito.
*/
const ajeno =
  (await db.creditos.findFirst({
    where: {
      tenant_id: TENANT, estado: { in: ["activo", "vencido"] },
      vendedor_id: { not: null, notIn: [fichaQA.id] },
    },
    orderBy: { numero: "asc" },
    select: { id: true, numero: true, vendedor_id: true, cliente_id: true },
  })) ??
  (await db.creditos.findFirst({
    where: { tenant_id: TENANT, estado: { in: ["activo", "vencido"] }, vendedor_id: null },
    orderBy: { numero: "asc" },
    select: { id: true, numero: true, vendedor_id: true, cliente_id: true },
  }));
ok(!!ajeno, "hay un crédito que no es suyo para probar",
  ajeno ? `${rot(ajeno.numero)} · ${ajeno.vendedor_id ? "de otro agente" : "de la casa (lo otorgó un admin)"}` : "ninguno");
if (!ajeno) { console.error("sin un crédito ajeno no se puede seguir"); process.exit(1); }

const listaVend = await vend("GET", "/api/creditos?limit=1000");
ok(listaVend.ok, "el vendedor puede listar SU cartera", listaVend.error ?? "");
const idsVend = (listaVend.data?.creditos ?? []).map((c) => c.id);
const propios = await db.creditos.count({ where: { tenant_id: TENANT, vendedor_id: fichaQA.id } });
ok(idsVend.length === propios, "y la lista trae exactamente sus créditos", `${idsVend.length} vs ${propios} propios`);
ok(!idsVend.includes(ajeno?.id), "🔴 el crédito ajeno NO aparece en su lista",
  idsVend.includes(ajeno?.id) ? "LO VE" : "no lo ve");

H2("cobranza abierta: puede atender al cliente que tiene enfrente");
const detalleAjeno = await vend("GET", `/api/creditos/${ajeno.id}`);
if (COBRANZA_ABIERTA) {
  ok(detalleAjeno.ok, "SÍ puede abrir el crédito ajeno para cobrarlo (cobranza abierta)",
    detalleAjeno.error ?? "");
  const cuotasAjenas = await vend("GET", `/api/creditos/${ajeno.id}/cuotas`);
  ok(cuotasAjenas.ok && (cuotasAjenas.data?.cuotas?.length ?? 0) > 0,
    "y ve su plan de cuotas, que es lo que necesita para cobrar",
    `${cuotasAjenas.data?.cuotas?.length ?? 0} cuotas`);
} else {
  ok(!detalleAjeno.ok && detalleAjeno.status === 404, "no puede abrir el crédito ajeno", `${detalleAjeno.status}`);
}

H2("un id que no existe");
const fantasma = await vend("GET", "/api/creditos/00000000-0000-0000-0000-000000000000");
ok(!fantasma.ok && fantasma.status === 404, "da 404, no 500", `${fantasma.status} ${fantasma.code ?? ""}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE B — LO QUE EL VENDEDOR NO PUEDE HACER");
// ════════════════════════════════════════════════════════════════════════════

H2("🔴 atribuirse un crédito a nombre de otro");
/*
  Es la puerta más silenciosa de todas: no rompe nada, no da error, y le mueve la comisión y
  la meta a otra persona. Por eso el server IGNORA el `vendedor_id` del body cuando quien
  otorga es vendedor, y lo fuerza al suyo.
*/
const otroVendedor = await db.vendedores.findFirst({
  where: { tenant_id: TENANT, NOT: { id: fichaQA.id } }, select: { id: true, nombre: true },
});
const cliV = await vend("POST", "/api/clientes", {
  nombre: "Rol", apellido: `Atribucion ${sello}`, documento: String(73_000_000 + Number(sello.slice(-5))),
  telefono: "3815554444", zona: "PRUEBA-ROLES", tipo_credito: "personal",
  ingreso_mensual: 2_000_000, situacion_laboral: "relacion_dependencia",
});
ok(cliV.ok, "el vendedor puede dar de alta un cliente", cliV.error ?? "");

/*
  Primero hay que fondear SU caja: la suya arranca en cero y el control de fondos es real.

  Se hace por la via del sistema — `POST /api/vendedores/[id]/caja` con accion "entrega" —,
  que ademas VERIFICA esa ruta: es la que el mensaje de "no hay saldo" le recomienda al
  vendedor ("Pedi una entrega al administrador"). Escribir el movimiento a mano habria dejado
  sin probar justamente eso, y la caja principal sin su egreso.
*/
const ENTREGA = 400_000;
const casaAntes = Number((await admin("GET", "/api/caja")).data?.saldos_por_cuenta?.efectivo ?? 0);
if (casaAntes < ENTREGA) {
  await admin("POST", "/api/caja", {
    concepto: "aporte_capital", monto: 1_000_000, cuenta: "efectivo", metodo: "efectivo",
    descripcion: "Verificador de roles: capital para la entrega",
  });
}
const entrega = await admin("POST", `/api/vendedores/${fichaQA.id}/caja`, {
  accion: "entrega", monto: ENTREGA, cuenta: "efectivo",
  descripcion: "Verificador de roles: entrega para operar",
});
ok(entrega.ok, `el admin le entrega ${f(ENTREGA)} a su caja`, entrega.error ?? "");
const suSaldo = await db.movimientos_caja.aggregate({
  where: { tenant_id: TENANT, vendedor_id: fichaQA.id }, _sum: { monto: true },
});
ok((suSaldo._sum.monto ?? 0) >= ENTREGA, "y le entra a la caja del agente, no a la principal",
  f(suSaldo._sum.monto ?? 0));

const intento = await vend("POST", "/api/creditos", {
  cliente_id: cliV.data.id, tipo_credito: "personal", monto_original: 100_000,
  tasa: 360, plazo_meses: 3, frecuencia: "mensual", cuenta_desembolso: "efectivo",
  vendedor_id: otroVendedor?.id, // ← el intento
});
ok(intento.ok, "el crédito se otorga", intento.error ?? "");
const idNuevo = intento.data?.credito?.id ?? intento.data?.id;
const guardado = idNuevo ? await db.creditos.findUnique({ where: { id: idNuevo }, select: { vendedor_id: true, numero: true } }) : null;
ok(guardado?.vendedor_id === fichaQA.id,
  "🔴 pero queda a nombre de QUIEN LO OTORGÓ, no del que pidió el body",
  `pidió ${otroVendedor?.nombre ?? "otro"} · quedó ${guardado?.vendedor_id === fichaQA.id ? "el suyo" : "EL AJENO"}`);

H2("las rutas que son del administrador");
const prohibidas = [
  ["GET", "/api/caja", undefined, "ver la caja de la financiera"],
  ["POST", "/api/caja", { concepto: "aporte_capital", monto: 1000, descripcion: "x" }, "mover la caja a mano"],
  ["POST", "/api/caja/transferencia", { origen: "efectivo", destino: "banco", monto: 1000 }, "transferir entre cuentas"],
  ["POST", "/api/caja/arqueo", { cuenta: "efectivo", monto_fisico: 0 }, "arquear la caja principal"],
  ["GET", "/api/usuarios", undefined, "listar los usuarios"],
  ["PUT", "/api/configuracion", { tasaMoraDiaria: 0.99 }, "cambiar la configuración del motor"],
  ["GET", "/api/auditoria", undefined, "leer la auditoría"],
];
for (const [metodo, ruta, body, que] of prohibidas) {
  const r = await vend(metodo, ruta, body);
  ok(!r.ok && (r.status === 403 || r.status === 401), `no puede ${que}`, `${metodo} ${ruta} → ${r.status}`);
}

H2("deshacer operaciones: es del administrador");
const anularAjeno = await vend("POST", `/api/creditos/${ajeno.id}/anular`, { motivo: "prueba" });
ok(!anularAjeno.ok && anularAjeno.status === 403, "no puede anular un crédito", `${anularAjeno.status}`);
const borrarAjeno = await vend("DELETE", `/api/creditos/${ajeno.id}`);
ok(!borrarAjeno.ok && borrarAjeno.status === 403, "ni eliminarlo", `${borrarAjeno.status}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE C — COBRANZA ABIERTA: la plata a su caja, el mérito al dueño");
// ════════════════════════════════════════════════════════════════════════════

if (COBRANZA_ABIERTA) {
  const cuotas = (await vend("GET", `/api/creditos/${ajeno.id}/cuotas`)).data?.cuotas ?? [];
  const pendiente = cuotas.find((c) => (c.total_cobrar ?? 0) > 0 && c.estado !== "pagada");
  if (!pendiente) {
    ok(false, "el crédito ajeno tiene una cuota por cobrar", "ninguna");
  } else {
    const cajaVendAntes = await db.movimientos_caja.aggregate({
      where: { tenant_id: TENANT, vendedor_id: fichaQA.id }, _sum: { monto: true },
    });
    const cobro = await vend("POST", "/api/pagos", {
      credito_id: ajeno.id, monto: pendiente.total_cobrar, metodo: "efectivo",
      notas: "Verificador de roles: le cobra un compañero",
    });
    ok(cobro.ok, `🔴 el vendedor SÍ puede cobrarle al cliente de otro (${f(pendiente.total_cobrar)})`, cobro.error ?? "");

    if (cobro.ok) {
      const pagoId = cobro.data?.pago?.id ?? cobro.data?.id;
      const mov = await db.movimientos_caja.findFirst({
        where: { pago_id: pagoId, tipo: "cobro" }, select: { vendedor_id: true, monto: true },
      });
      ok(mov?.vendedor_id === fichaQA.id,
        "la plata entra a SU caja — es el que tiene los billetes en la mano",
        mov?.vendedor_id === fichaQA.id ? "su caja" : "la de otro");
      const cajaVendPost = await db.movimientos_caja.aggregate({
        where: { tenant_id: TENANT, vendedor_id: fichaQA.id }, _sum: { monto: true },
      });
      ok(igual((cajaVendPost._sum.monto ?? 0) - (cajaVendAntes._sum.monto ?? 0), pendiente.total_cobrar),
        "y su caja sube exactamente lo cobrado", f(pendiente.total_cobrar));

      const dueño = await db.creditos.findUnique({ where: { id: ajeno.id }, select: { vendedor_id: true } });
      ok(dueño?.vendedor_id === ajeno.vendedor_id,
        "el crédito NO cambia de dueño: el mérito queda en quien lo otorgó",
        dueño?.vendedor_id === ajeno.vendedor_id ? "intacto" : "SE LO ROBÓ");

      // El crédito ajeno sigue sin aparecer en su lista, aunque le haya cobrado.
      const listaPost = (await vend("GET", "/api/creditos?limit=1000")).data?.creditos ?? [];
      ok(!listaPost.some((c) => c.id === ajeno.id),
        "y aun habiéndole cobrado, sigue sin verlo en su cartera", `${listaPost.length} créditos`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE D — SU CAJA ES SUYA");
// ════════════════════════════════════════════════════════════════════════════

const miCaja = await vend("GET", "/api/me/caja");
ok(miCaja.ok, "el vendedor ve su propia caja", miCaja.error ?? "");
const misMovs = await db.movimientos_caja.findMany({ where: { tenant_id: TENANT, vendedor_id: fichaQA.id }, select: { monto: true } });
const miSaldo = Math.round(misMovs.reduce((s, m) => s + m.monto, 0) * 100) / 100;
const saldoInformado = miCaja.data?.saldo_total ?? miCaja.data?.saldo ?? miCaja.data?.saldos_por_cuenta?.efectivo;
ok(igual(saldoInformado ?? 0, miSaldo), "y su saldo = la suma de SUS movimientos, no los de la principal",
  `${f(saldoInformado)} vs mío ${f(miSaldo)}`);

/*
  🔴 El caso que una vez falló: un vendedor SIN ficha veía la caja principal. Se comprueba que
  lo que informa /me/caja no sea el saldo de la tesorería.
*/
const principal = await db.movimientos_caja.aggregate({ where: { tenant_id: TENANT, vendedor_id: null }, _sum: { monto: true } });
ok(!igual(saldoInformado ?? 0, principal._sum.monto ?? 0) || igual(miSaldo, principal._sum.monto ?? 0),
  "no está mostrando la caja principal disfrazada de la suya",
  `suya ${f(miSaldo)} · principal ${f(principal._sum.monto)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE E — MULTI-TENANT: nada cruza de una financiera a otra");
// ════════════════════════════════════════════════════════════════════════════

/*
  Se fabrica una financiera vecina con un cliente y un crédito, y se le pide al admin de ESTA
  que los lea. El auditor estático ya comprueba que cada query lleve `withTenant`; esto
  comprueba que eso alcance. Se borra al terminar.
*/
const otroTenant = await db.tenants.create({
  data: { nombre: `QA Financiera Vecina ${sello}` },
  select: { id: true },
});
const cliOtro = await db.clientes.create({
  data: {
    tenant_id: otroTenant.id, nombre: "Vecino", apellido: "Ajeno",
    documento: String(72_000_000 + Number(sello.slice(-5))), zona: "OTRO-TENANT",
  },
  select: { id: true },
});
const crOtro = await db.creditos.create({
  data: {
    tenant_id: otroTenant.id, cliente_id: cliOtro.id, tipo_credito: "personal",
    monto_original: 999_999, tasa: 100, plazo_meses: 3, frecuencia: "mensual",
    fecha_inicio: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"),
    saldo_pendiente: 999_999, estado: "activo",
  },
  select: { id: true, numero: true },
});

for (const [quien, call] of [["el admin", admin], ["el vendedor", vend]]) {
  const c = await call("GET", `/api/creditos/${crOtro.id}`);
  ok(!c.ok && c.status === 404, `${quien} no puede abrir un crédito de otra financiera`, `${c.status}`);
  const cl = await call("GET", `/api/clientes/${cliOtro.id}`);
  ok(!cl.ok && cl.status === 404, `${quien} no puede abrir su cliente`, `${cl.status}`);
}
const listaAdmin = (await admin("GET", "/api/creditos?limit=1000")).data?.creditos ?? [];
ok(!listaAdmin.some((c) => c.id === crOtro.id), "y no aparece en ninguna lista", `${listaAdmin.length} créditos propios`);

const pagoCruzado = await admin("POST", "/api/pagos", { credito_id: crOtro.id, monto: 1000, metodo: "efectivo" });
ok(!pagoCruzado.ok, "ni se le puede cobrar desde otra financiera", `${pagoCruzado.status} ${pagoCruzado.code ?? ""}`);

await db.creditos.delete({ where: { id: crOtro.id } });
await db.clientes.delete({ where: { id: cliOtro.id } });
await db.tenants.delete({ where: { id: otroTenant.id } });
ok(true, "la financiera vecina de prueba se borró", `era ${otroTenant.id.slice(0, 8)}`);

// ════════════════════════════════════════════════════════════════════════════
await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  LAS BARRERAS AGUANTAN"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
