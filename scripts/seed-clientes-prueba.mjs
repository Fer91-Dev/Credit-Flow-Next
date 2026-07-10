/**
 * SEED — 6 clientes de prueba para ejercitar el motor financiero (sueldos, capacidad de
 * pago, monto sugerido, otorgamientos). Perfiles variados: sueldo alto/medio/bajo, con y
 * sin otros ingresos. Idempotente (upsert por [tenant_id, cuit_cuil], que es único).
 *
 * Uso:  docker compose exec app node scripts/seed-clientes-prueba.mjs
 * (No borra nada; para limpiar usar `npm run reset:test -- --confirm`.)
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const TENANT = "00000000-0000-0000-0000-000000000001";

// cuit_cuil se guarda SOLO dígitos (11), igual que la app (normalizarCuit).
const CLIENTES = [
  {
    nombre: "Ricardo", apellido: "Gómez", documento: "25123456", cuit_cuil: "20251234563",
    fecha_nacimiento: "1980-03-15", telefono: "3814100001", email: "ricardo.gomez@example.com",
    provincia: "Tucumán", localidad: "San Miguel de Tucumán", codigo_postal: "4000",
    tipo_domicilio: "casa", situacion_laboral: "relacion_dependencia", ocupacion: "Ingeniero",
    empleador: "Constructora del Norte S.A.", ingreso_mensual: 1500000, otros_ingresos: 0,
    consentimiento_bureau: true, nota: "Sueldo alto → aprobado, monto sugerido alto",
  },
  {
    nombre: "Mariana", apellido: "López", documento: "30987654", cuit_cuil: "27309876545",
    fecha_nacimiento: "1984-07-22", telefono: "2214100002", email: "mariana.lopez@example.com",
    provincia: "Buenos Aires", localidad: "La Plata", codigo_postal: "1900",
    tipo_domicilio: "departamento", piso: "3", depto: "B", situacion_laboral: "autonomo",
    ocupacion: "Comerciante", ingreso_mensual: 450000, otros_ingresos: 0,
    consentimiento_bureau: false, nota: "Sueldo medio → aprobado moderado",
  },
  {
    nombre: "Jorge", apellido: "Sosa", documento: "33456789", cuit_cuil: "20334567899",
    fecha_nacimiento: "1988-11-05", telefono: "3514100003", email: "jorge.sosa@example.com",
    provincia: "Córdoba", localidad: "Córdoba", codigo_postal: "5000",
    tipo_domicilio: "casa", situacion_laboral: "relacion_dependencia", ocupacion: "Empleado de comercio",
    empleador: "Supermercados Sur", ingreso_mensual: 180000, otros_ingresos: 0,
    consentimiento_bureau: false, nota: "Sueldo bajo → capacidad baja, rechaza montos altos",
  },
  {
    nombre: "Carla", apellido: "Fernández", documento: "28765432", cuit_cuil: "27287654321",
    fecha_nacimiento: "1982-01-30", telefono: "3414100004", email: "carla.fernandez@example.com",
    provincia: "Santa Fe", localidad: "Rosario", codigo_postal: "2000",
    tipo_domicilio: "departamento", piso: "8", depto: "A", situacion_laboral: "monotributista",
    ocupacion: "Contadora", ingreso_mensual: 600000, otros_ingresos: 200000,
    consentimiento_bureau: true, nota: "Medio-alto + otros ingresos ($800k total)",
  },
  {
    nombre: "Diego", apellido: "Ramírez", documento: "35111222", cuit_cuil: "20351112227",
    fecha_nacimiento: "1990-09-12", telefono: "2614100005", email: "diego.ramirez@example.com",
    provincia: "Mendoza", localidad: "Mendoza", codigo_postal: "5500",
    tipo_domicilio: "casa", situacion_laboral: "relacion_dependencia", ocupacion: "Técnico",
    empleador: "Bodega Los Andes", ingreso_mensual: 300000, otros_ingresos: 0,
    consentimiento_bureau: false, nota: "Sueldo justo → caso borde",
  },
  {
    nombre: "Lucía", apellido: "Martínez", documento: "32444555", cuit_cuil: "27324445554",
    fecha_nacimiento: "1986-05-18", telefono: "3814100006", email: "lucia.martinez@example.com",
    provincia: "Tucumán", localidad: "Yerba Buena", codigo_postal: "4107",
    tipo_domicilio: "casa", situacion_laboral: "relacion_dependencia", ocupacion: "Docente",
    empleador: "Ministerio de Educación", ingreso_mensual: 250000, otros_ingresos: 50000,
    consentimiento_bureau: false, nota: "Bajo-medio ($300k total)",
  },
];

async function main() {
  console.log(`Sembrando ${CLIENTES.length} clientes de prueba…\n`);
  for (const c of CLIENTES) {
    const { nota, fecha_nacimiento, ...rest } = c;
    const data = {
      ...rest,
      fecha_nacimiento: new Date(`${fecha_nacimiento}T00:00:00.000Z`),
      estado: "activo",
      tipo_credito: "personal",
      nacionalidad: "Argentina",
      ingreso_ediciones: 0,
    };
    await p.clientes.upsert({
      where: { tenant_id_cuit_cuil: { tenant_id: TENANT, cuit_cuil: c.cuit_cuil } },
      update: data,
      create: { ...data, tenant_id: TENANT },
    });
    console.log(`  ✔ ${c.nombre} ${c.apellido} — ingreso $${(c.ingreso_mensual + c.otros_ingresos).toLocaleString("es-AR")}  (${nota})`);
  }
  const total = await p.clientes.count({ where: { tenant_id: TENANT } });
  console.log(`\n✅ Listo. Clientes en el tenant: ${total}.`);
  console.log("Probá: Créditos → Nuevo → elegí un cliente y mirá capacidad de pago + monto sugerido.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
