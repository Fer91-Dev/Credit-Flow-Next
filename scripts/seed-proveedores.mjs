/**
 * seed-proveedores — siembra 3 proveedores de prueba con datos variados para ver la
 * tabla migrada a DataTable: uno con deuda (saldo ámbar), uno con saldo a favor (verde),
 * y uno inactivo en cero (atenuado). Idempotente: salta los que ya existen por nombre.
 *
 * Uso (dentro del contenedor):
 *   docker compose exec app node scripts/seed-proveedores.mjs
 * Limpieza luego: borralos desde la UI o con prisma.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const PROVEEDORES = [
  {
    nombre: "Distribuidora Andina S.A.", cuit: "30-71234567-9", rubro: "Insumos",
    email: "ventas@andina.com.ar", telefono: "11-4567-8900", direccion: "Av. Mitre 1200, Avellaneda",
    notas: "Proveedor principal de insumos.", activo: true,
    movimientos: [{ tipo: "cargo", monto: 350000, concepto: "Factura A-0012 — insumos", comprobante: "A-0012", metodo: "transferencia" }],
  },
  {
    nombre: "Logística del Sur", cuit: "30-70987654-3", rubro: "Servicios",
    email: "info@logisur.com", telefono: "11-2233-4455", direccion: "Calle 50 N° 340, La Plata",
    notas: "Fletes y distribución.", activo: true,
    movimientos: [
      { tipo: "cargo", monto: 120000, concepto: "Servicio de flete mensual", comprobante: "B-0044", metodo: "efectivo" },
      { tipo: "pago", monto: -200000, concepto: "Adelanto a cuenta", comprobante: "REC-009", metodo: "transferencia" },
    ],
  },
  {
    nombre: "Ferretería Industrial Norte", cuit: "27-65432109-1", rubro: "Insumos",
    email: null, telefono: "11-6677-8899", direccion: "Ruta 8 km 45, Pilar",
    notas: "Dado de baja temporalmente.", activo: false,
    movimientos: [],
  },
];

let creados = 0, saltados = 0;
for (const p of PROVEEDORES) {
  const existe = await prisma.proveedores.findFirst({ where: { tenant_id: TENANT_ID, nombre: p.nombre }, select: { id: true } });
  if (existe) { console.log(`• ${p.nombre} — ya existe, salto`); saltados++; continue; }

  const { movimientos, ...datos } = p;
  const prov = await prisma.proveedores.create({ data: { ...datos, tenant_id: TENANT_ID } });
  for (const m of movimientos) {
    await prisma.movimientos_proveedor.create({ data: { ...m, proveedor_id: prov.id, tenant_id: TENANT_ID } });
  }
  const saldo = movimientos.reduce((s, m) => s + m.monto, 0);
  creados++;
  console.log(`✓ ${p.nombre}  (${p.activo ? "activo" : "INACTIVO"} · saldo $${saldo.toLocaleString("es-AR")})`);
}

console.log(`\nListo. Creados: ${creados} · Saltados: ${saltados}.`);
await prisma.$disconnect();
