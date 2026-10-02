/**
 * CLIENTES PARA PRUEBAS MANUALES (Fernando, 01/10/2026) — SOLO DESARROLLO.
 *
 *   node --env-file=.env.local scripts/clientes-para-pruebas-manuales.mjs
 *
 * Dos cosas, las dos idempotentes (correrlo de nuevo no duplica ni vuelve a renombrar):
 *
 *  1. RENOMBRA a los clientes que dejaron las baterías de verificación con nombres de prueba
 *     ("Acuerdo Rompe 393934", "Cobranza Incumple 766290"…) y los saca de las zonas
 *     `PRUEBA-*` / `CARTERA-PRUEBA`. Conservan sus créditos, pagos y estados: siguen sirviendo
 *     para probar mora, acuerdos y refinanciaciones, pero ahora se leen como clientes reales.
 *     Al salir de las zonas `PRUEBA-*`, las baterías ya no los consideran suyos ni los borran.
 *
 *  2. SIEMBRA 8 clientes nuevos, SIN créditos, con la ficha completa y casos distintos para
 *     probar el otorgamiento a mano (ingresos altos y bajos, sin sueldo, sin email, jubilado).
 *
 * Datos de contacto FICTICIOS a propósito: teléfonos 381-555-xxxx y mails @example.com (dominio
 * reservado, no entrega a nadie). Así se puede apretar "Contactar" sin escribirle a una persona.
 */
import "./solo-dev.mjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const T = "00000000-0000-0000-0000-000000000001";

const ZONAS = ["Centro", "Barrio Norte", "Barrio Sur", "Villa Luján", "Yerba Buena", "Barrio Jardín", "Villa Mariano Moreno", "El Bosque"];

const NOMBRES = [
  ["Laura", "Benítez"], ["Sergio", "Galván"], ["Mónica", "Ríos"], ["Pablo", "Quiroga"], ["Graciela", "Toledo"],
  ["Andrés", "Villalba"], ["Patricia", "Lobo"], ["Fernando", "Cáceres"], ["Silvana", "Moreno"], ["Javier", "Albornoz"],
  ["Claudia", "Figueroa"], ["Ricardo", "Luna"], ["Alejandra", "Paz"], ["Marcelo", "Coronel"], ["Verónica", "Díaz"],
  ["Hugo", "Leguizamón"], ["Natalia", "Romano"], ["Cristian", "Aráoz"], ["Gabriela", "Soria"], ["Eduardo", "Maldonado"],
  ["Romina", "Gómez"], ["Walter", "Frías"], ["Mariela", "Avellaneda"], ["Raúl", "Cisneros"], ["Daniela", "Chávez"],
  ["Gustavo", "Herrera"], ["Lorena", "Brito"], ["Miguel", "Santillán"], ["Paola", "Núñez"], ["Jorge", "Medina"],
  ["Cecilia", "Ojeda"], ["Ramón", "Palavecino"], ["Analía", "Vera"],
];

const NUEVOS = [
  { nombre: "Valentina", apellido: "Ruiz", documento: "38412650", ingreso: 850000, situacion: "relacion_dependencia", ocupacion: "Administrativa", empleador: "Clínica del Norte", antig: 36, email: true, zona: "Centro", direccion: "San Martín 845", nac: "1994-03-12", civil: "soltero" },
  { nombre: "Gustavo", apellido: "Paz", documento: "29873114", ingreso: 1200000, situacion: "relacion_dependencia", ocupacion: "Supervisor de depósito", empleador: "Distribuidora Andina", antig: 84, email: true, zona: "Barrio Norte", direccion: "Avenida Mate de Luna 2310", nac: "1982-07-25", civil: "casado" },
  { nombre: "Florencia", apellido: "Medina", documento: "35990218", ingreso: 650000, situacion: "monotributista", ocupacion: "Peluquera", empleador: null, antig: 48, email: true, zona: "Villa Luján", direccion: "Lamadrid 1532", nac: "1990-11-03", civil: "soltero" },
  { nombre: "Ramiro", apellido: "Acosta", documento: "41237809", ingreso: 420000, situacion: "relacion_dependencia", ocupacion: "Repositor", empleador: "Supermercado Tucumán", antig: 10, email: true, zona: "Barrio Sur", direccion: "Crisóstomo Álvarez 1290", nac: "1998-05-19", civil: "soltero" },
  { nombre: "Carolina", apellido: "Sosa", documento: "33658402", ingreso: null, situacion: null, ocupacion: null, empleador: null, antig: null, email: true, zona: "Barrio Jardín", direccion: "Junín 455", nac: "1988-01-30", civil: "divorciado" },
  { nombre: "Martín", apellido: "Herrera", documento: "14562387", ingreso: 380000, situacion: "jubilado", ocupacion: "Jubilado", empleador: "ANSES", antig: null, email: true, zona: "Villa Mariano Moreno", direccion: "Avenida Roca 3120", nac: "1958-09-14", civil: "viudo" },
  { nombre: "Luciana", apellido: "Vega", documento: "32109876", ingreso: 2000000, situacion: "relacion_dependencia", ocupacion: "Contadora", empleador: "Estudio Vega & Asoc.", antig: 120, email: true, zona: "Yerba Buena", direccion: "Avenida Aconquija 1850", nac: "1986-04-08", civil: "casado" },
  { nombre: "Diego", apellido: "Correa", documento: "36741295", ingreso: 900000, situacion: "relacion_dependencia", ocupacion: "Chofer", empleador: "Transporte El Bosque", antig: 60, email: false, zona: "El Bosque", direccion: "Avenida Belgrano 2765", nac: "1991-12-22", civil: "casado" },
];

const sinAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ── 1. Renombrar los de las baterías ─────────────────────────────────────────
const deBateria = await db.clientes.findMany({
  where: { tenant_id: T, OR: [{ zona: { startsWith: "PRUEBA-" } }, { zona: "CARTERA-PRUEBA" }] },
  select: { id: true, nombre: true, apellido: true, zona: true },
  orderBy: { created_at: "asc" },
});
const conNombreDePrueba = (c) => /\d{5,}/.test(`${c.nombre} ${c.apellido ?? ""}`);
let iNombre = 0, renombrados = 0, rezonados = 0;
for (const [k, c] of deBateria.entries()) {
  const data = { zona: ZONAS[k % ZONAS.length], barrio: ZONAS[k % ZONAS.length], localidad: "San Miguel de Tucumán", provincia: "Tucumán" };
  if (conNombreDePrueba(c) && iNombre < NOMBRES.length) {
    const [nombre, apellido] = NOMBRES[iNombre++];
    Object.assign(data, { nombre, apellido });
    renombrados++;
  }
  await db.clientes.update({ where: { id: c.id }, data });
  rezonados++;
}
console.log(`1. Clientes de las baterías: ${renombrados} renombrados, ${rezonados} pasados a barrios reales.`);

// ── 2. Clientes nuevos sin créditos ──────────────────────────────────────────
let creados = 0;
for (const [k, n] of NUEVOS.entries()) {
  const ya = await db.clientes.findFirst({ where: { tenant_id: T, documento: n.documento }, select: { id: true } });
  if (ya) continue;
  await db.clientes.create({
    data: {
      tenant_id: T,
      nombre: n.nombre,
      apellido: n.apellido,
      documento: n.documento,
      email: n.email ? `${sinAcentos(n.nombre)}.${sinAcentos(n.apellido)}@example.com` : null,
      telefono: `381555${String(1001 + k).padStart(4, "0")}`,
      direccion: n.direccion,
      localidad: n.zona === "Yerba Buena" ? "Yerba Buena" : "San Miguel de Tucumán",
      provincia: "Tucumán",
      codigo_postal: n.zona === "Yerba Buena" ? "4107" : "4000",
      zona: n.zona,
      barrio: n.zona,
      fecha_nacimiento: new Date(`${n.nac}T00:00:00Z`),
      estado_civil: n.civil,
      nacionalidad: "argentina",
      situacion_laboral: n.situacion,
      ocupacion: n.ocupacion,
      empleador: n.empleador,
      antiguedad_laboral_meses: n.antig,
      ingreso_mensual: n.ingreso,
      estado: "activo",
      tipo_credito: "personal",
      monto_total: 0,
    },
  });
  creados++;
}
console.log(`2. Clientes nuevos para pruebas manuales: ${creados} creados (${NUEVOS.length - creados} ya existían).`);
await db.$disconnect();
