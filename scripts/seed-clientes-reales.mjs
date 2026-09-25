import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
/**
 * SIEMBRA 10 CLIENTES QUE PARECEN REALES — por la API, no escribiendo en la base.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/seed-clientes-reales.mjs
 *
 * 🔴 QUÉ LO DISTINGUE DE `seed-clientes-prueba`
 *
 * Los seeds de prueba se delatan solos: "Cliente Prueba 3", DNI 40000001, teléfono
 * 3815550000, zona CARTERA-PRUEBA. Sirven para verificar el motor y son ilegibles para
 * cualquiera que mire la pantalla como la mira un operador.
 *
 * Esto es lo contrario: la ficha tiene que aguantar que alguien la abra y no se dé cuenta.
 * Nombres del noroeste argentino, DNI coherente con la edad, celulares de Tucumán con su
 * característica real, domicilios en calles que existen, barrios que se usan como zona de
 * cobranza, y oficios con un ingreso que se corresponda.
 *
 * 🔴 SON PERSONAS INVENTADAS. Los nombres se armaron combinando apellidos y nombres de pila
 * comunes; los documentos están en los rangos que corresponden a cada edad pero no pertenecen
 * a nadie; los teléfonos usan el prefijo real 381 con numeración que no está asignada. No se
 * copió ningún dato de los 86 clientes migrados — de esos se miró la FORMA, nunca el
 * contenido.
 *
 * 🔴 Y LA COHERENCIA IMPORTA MÁS QUE EL NOMBRE. Un albañil con ingreso de gerente, o un
 * jubilado de 30 años, se leen como datos inventados aunque el nombre sea creíble. Cada ficha
 * cierra: edad → DNI, oficio → ingreso → situación laboral, barrio → zona de cobranza.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN. Este seeder es para desarrollo.");
  process.exit(1);
}

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let H;
async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/clientes` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...json };
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: process.env.QA_IDENT ?? "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };

/*
  Las diez fichas.

  `edad` no se guarda —el modelo no tiene fecha de nacimiento— pero está acá porque es lo que
  hace coherente al DNI: en Argentina el número sube con el año de nacimiento. Un DNI de 11
  millones en alguien de 28 años es el detalle que delata una tabla inventada.
*/
const CLIENTES = [
  {
    nombre: "María Laura", apellido: "Quiroga", edad: 41, documento: "27431890",
    telefono: "3815214778", email: "marialaura.quiroga@gmail.com",
    direccion: "Ayacucho 1245", zona: "Centro",
    ocupacion: "Comerciante — kiosco propio", situacion_laboral: "monotributista",
    ingreso_mensual: 780_000, tipo_credito: "personal",
  },
  {
    nombre: "Ramón Alberto", apellido: "Villagra", edad: 57, documento: "14682037",
    telefono: "3814470912", email: null,
    direccion: "Av. Sarmiento 3480", zona: "Sur",
    ocupacion: "Albañil", situacion_laboral: "otro",
    ingreso_mensual: 620_000, tipo_credito: "personal",
  },
  {
    nombre: "Silvina Beatriz", apellido: "Toledo", edad: 34, documento: "31205664",
    telefono: "3815538104", email: "sil.toledo34@hotmail.com",
    direccion: "Bolívar 876", zona: "Centro",
    ocupacion: "Docente primaria", situacion_laboral: "relacion_dependencia",
    ingreso_mensual: 910_000, tipo_credito: "personal",
  },
  {
    nombre: "Jorge Daniel", apellido: "Medina", edad: 46, documento: "23918475",
    telefono: "3816602351", email: "jdmedina.remis@gmail.com",
    direccion: "Pasaje Los Nogales 214", zona: "Yerba Buena",
    ocupacion: "Remisero", situacion_laboral: "autonomo",
    ingreso_mensual: 850_000, tipo_credito: "personal",
  },
  {
    nombre: "Norma Cristina", apellido: "Agüero", edad: 68, documento: "10547823",
    telefono: "3814118926", email: null,
    direccion: "Lavalle 2190", zona: "Norte",
    ocupacion: "Jubilada", situacion_laboral: "jubilado",
    ingreso_mensual: 480_000, tipo_credito: "personal",
  },
  {
    nombre: "Emanuel Ezequiel", apellido: "Coronel", edad: 29, documento: "36074912",
    telefono: "3815847230", email: "ema.coronel29@gmail.com",
    direccion: "Barrio Juan XXIII, Manzana D Casa 14", zona: "Banda del Río Salí",
    ocupacion: "Operario de planta", situacion_laboral: "relacion_dependencia",
    ingreso_mensual: 740_000, tipo_credito: "personal",
  },
  {
    nombre: "Patricia Noemí", apellido: "Juárez", edad: 52, documento: "17893406",
    telefono: "3814729518", email: "pat.juarez@yahoo.com.ar",
    direccion: "Chacabuco 1502", zona: "Centro",
    ocupacion: "Peluquera — local propio", situacion_laboral: "monotributista",
    ingreso_mensual: 690_000, tipo_credito: "personal",
  },
  {
    nombre: "Carlos Fabián", apellido: "Nieva", edad: 38, documento: "29346071",
    telefono: "3815093642", email: null,
    direccion: "Av. Roca 4120", zona: "Sur",
    ocupacion: "Camionero", situacion_laboral: "relacion_dependencia",
    ingreso_mensual: 1_150_000, tipo_credito: "personal",
  },
  {
    nombre: "Rosana Elizabeth", apellido: "Paz", edad: 44, documento: "25617039",
    telefono: "3814365287", email: "rosanapaz44@gmail.com",
    direccion: "San Lorenzo 738", zona: "Tafí Viejo",
    ocupacion: "Enfermera", situacion_laboral: "relacion_dependencia",
    ingreso_mensual: 980_000, tipo_credito: "personal",
  },
  {
    nombre: "Luis Orlando", apellido: "Barrionuevo", edad: 61, documento: "12406853",
    telefono: "3816158740", email: null,
    direccion: "Ruta 9 Km 1294, Los Pocitos", zona: "Alderetes",
    ocupacion: "Verdulero — puesto en la feria", situacion_laboral: "otro",
    ingreso_mensual: 560_000, tipo_credito: "personal",
  },
];

console.log(`base: ${BASE}`);
console.log(`sembrando ${CLIENTES.length} clientes\n`);

let creados = 0, fallos = 0;
for (const c of CLIENTES) {
  const { edad, ...ficha } = c;
  const r = await api("POST", "/api/clientes", ficha);
  if (r.ok) {
    creados++;
    console.log(
      `  ✓ ${(c.nombre + " " + c.apellido).padEnd(28)} DNI ${c.documento} · ${String(edad).padStart(2)} años · ` +
      `${c.zona.padEnd(20)} ${c.ocupacion.padEnd(32)} ${f(c.ingreso_mensual)}`,
    );
  } else {
    fallos++;
    console.log(`  ✗ ${c.nombre} ${c.apellido}: ${r.error}`);
  }
}

console.log(`\n${"═".repeat(78)}`);
console.log(`  ${creados} cliente(s) creados${fallos ? ` · ${fallos} con problemas` : ""}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
