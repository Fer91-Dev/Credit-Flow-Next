/**
 * seed-productos — siembra 20 productos ficticios con TODOS los campos llenos,
 * incluida la FOTO subida al bucket `productos` de Supabase Storage (auto-hosteada,
 * igual que se cargó la bicicleta a mano).
 *
 * Para cada producto baja una imagen relevante por keyword (loremflickr; fallback a
 * picsum) y la sube al bucket vía la REST API de Storage (service role). Idempotente:
 * salta los productos cuyo `sku` ya existe (no duplica si se corre dos veces).
 *
 * Uso (dentro del contenedor, donde viven Prisma + las env vars de Supabase):
 *   docker compose exec app node scripts/seed-productos.mjs
 *
 * Tras correrlo: Ctrl+Shift+R en el navegador (no hace falta restart).
 * Requiere el bucket creado (scripts/setup-storage.mjs) y
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en el entorno.
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

/** Catálogo ficticio (precios en ARS). `kw` = keyword para la foto. */
const PRODUCTOS = [
  { nombre: "Smart TV 50\" 4K UHD",          categoria: "Tecnología",        sku: "TEC-TV50",   precio: 749999,  stock: 12, stock_minimo: 3, kw: "television",      descripcion: "Televisor LED 50 pulgadas, resolución 4K, HDR10 y sistema operativo smart." },
  { nombre: "Notebook 15.6\" Core i5",        categoria: "Tecnología",        sku: "TEC-NB15",   precio: 1199000, stock: 8,  stock_minimo: 2, kw: "laptop",          descripcion: "Notebook 15.6\", procesador Core i5, 16GB RAM, SSD 512GB." },
  { nombre: "Smartphone 128GB",               categoria: "Tecnología",        sku: "TEC-SP128",  precio: 689000,  stock: 20, stock_minimo: 5, kw: "smartphone",      descripcion: "Teléfono 128GB, pantalla 6.5\", cámara triple y batería 5000mAh." },
  { nombre: "Auriculares Inalámbricos",       categoria: "Tecnología",        sku: "TEC-AUR",    precio: 159999,  stock: 30, stock_minimo: 6, kw: "headphones",      descripcion: "Auriculares Bluetooth con cancelación de ruido y 30h de autonomía." },
  { nombre: "Monitor 24\" Full HD",           categoria: "Tecnología",        sku: "TEC-MON24",  precio: 289000,  stock: 10, stock_minimo: 3, kw: "computer-monitor", descripcion: "Monitor 24 pulgadas, 75Hz, panel IPS, HDMI + VGA." },
  { nombre: "Heladera No Frost 360L",         categoria: "Electrodomésticos", sku: "ELE-HEL360", precio: 1349000, stock: 6,  stock_minimo: 2, kw: "refrigerator",    descripcion: "Heladera con freezer, tecnología No Frost, 360 litros, eficiencia A." },
  { nombre: "Lavarropas Automático 8kg",      categoria: "Electrodomésticos", sku: "ELE-LAV8",   precio: 899000,  stock: 7,  stock_minimo: 2, kw: "washing-machine",  descripcion: "Lavarropas carga frontal 8kg, 1200rpm, 15 programas de lavado." },
  { nombre: "Microondas 28L Digital",         categoria: "Electrodomésticos", sku: "ELE-MIC28",  precio: 219000,  stock: 15, stock_minimo: 4, kw: "microwave",       descripcion: "Microondas con grill, 28 litros, panel digital y 10 niveles de potencia." },
  { nombre: "Aire Acondicionado 3000F",       categoria: "Electrodomésticos", sku: "ELE-AA3000", precio: 1099000, stock: 5,  stock_minimo: 2, kw: "air-conditioner", descripcion: "Split frío/calor 3000 frigorías, inverter, bajo consumo." },
  { nombre: "Cocina 4 Hornallas",             categoria: "Electrodomésticos", sku: "ELE-COC4",   precio: 659000,  stock: 9,  stock_minimo: 2, kw: "kitchen-stove",   descripcion: "Cocina a gas 4 hornallas con horno con encendido automático." },
  { nombre: "Licuadora 1.5L",                 categoria: "Hogar",             sku: "HOG-LIC15",  precio: 89999,   stock: 25, stock_minimo: 5, kw: "blender",         descripcion: "Licuadora de vaso 1.5 litros, 600W, 3 velocidades + pulso." },
  { nombre: "Aspiradora Ciclónica",           categoria: "Hogar",             sku: "HOG-ASP",    precio: 174999,  stock: 11, stock_minimo: 3, kw: "vacuum-cleaner",  descripcion: "Aspiradora sin bolsa, 2000W, filtro HEPA, tanque 2L." },
  { nombre: "Ventilador de Pie 20\"",         categoria: "Hogar",             sku: "HOG-VEN20",  precio: 69999,   stock: 22, stock_minimo: 5, kw: "fan",             descripcion: "Ventilador de pie 20 pulgadas, 3 velocidades, altura regulable." },
  { nombre: "Cafetera Express",               categoria: "Hogar",             sku: "HOG-CAF",    precio: 239000,  stock: 14, stock_minimo: 3, kw: "coffee-machine",  descripcion: "Cafetera express 15 bares, espumador de leche, depósito 1.2L." },
  { nombre: "Juego de Sábanas Queen",         categoria: "Hogar",             sku: "HOG-SAB",    precio: 54999,   stock: 40, stock_minimo: 8, kw: "bedsheet",        descripcion: "Juego de sábanas 100% algodón, 2 plazas y media, varios colores." },
  { nombre: "Sofá 3 Cuerpos",                 categoria: "Muebles",           sku: "MUE-SOF3",   precio: 949000,  stock: 4,  stock_minimo: 1, kw: "sofa",            descripcion: "Sillón sofá de 3 cuerpos, tapizado en chenille, estructura de madera." },
  { nombre: "Colchón Queen Resortes",         categoria: "Muebles",           sku: "MUE-COL",    precio: 549000,  stock: 6,  stock_minimo: 2, kw: "mattress",        descripcion: "Colchón 2x2 de resortes pocket, pillow top y tela antiácaros." },
  { nombre: "Escritorio de Oficina",          categoria: "Muebles",           sku: "MUE-ESC",    precio: 199000,  stock: 10, stock_minimo: 2, kw: "desk",            descripcion: "Escritorio de melamina con cajonera, 120x60cm, color nogal." },
  { nombre: "Taladro Percutor 13mm",          categoria: "Herramientas",      sku: "HER-TAL13",  precio: 129999,  stock: 18, stock_minimo: 4, kw: "power-drill",     descripcion: "Taladro percutor 13mm, 750W, velocidad variable y reversa." },
  { nombre: "Bicicleta Mountain Bike R29",    categoria: "Deportes",          sku: "DEP-BIKR29", precio: 489000,  stock: 9,  stock_minimo: 2, kw: "mountain-bike",   descripcion: "Bicicleta MTB rodado 29, 21 velocidades, frenos a disco." },
];

/** Baja los bytes de una imagen relevante (loremflickr; fallback picsum). */
async function bajarImagen(kw, idx) {
  const fuentes = [
    `https://loremflickr.com/600/450/${encodeURIComponent(kw)}?lock=${idx + 1}`,
    `https://picsum.photos/seed/prod-${idx + 1}/600/450`,
  ];
  for (const src of fuentes) {
    try {
      const r = await fetch(src, { redirect: "follow" });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 1000) return buf; // descarta respuestas vacías/errores
    } catch {
      /* probar siguiente fuente */
    }
  }
  return null;
}

/** Sube los bytes al bucket `productos` y devuelve la URL pública. */
async function subirFoto(buf) {
  const path = `${TENANT_ID}/${randomUUID()}.jpg`;
  const res = await fetch(`${SUPA_URL}/storage/v1/object/productos/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPA_KEY}`,
      apikey: SUPA_KEY,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!res.ok) {
    console.warn("  ⚠ no se pudo subir la foto:", res.status, await res.text().catch(() => ""));
    return null;
  }
  return `${SUPA_URL}/storage/v1/object/public/productos/${path}`;
}

let creados = 0, saltados = 0;
for (let i = 0; i < PRODUCTOS.length; i++) {
  const p = PRODUCTOS[i];
  const existe = await prisma.productos.findFirst({ where: { tenant_id: TENANT_ID, sku: p.sku }, select: { id: true } });
  if (existe) { console.log(`• ${p.nombre} — ya existe (sku ${p.sku}), salto`); saltados++; continue; }

  let imagen_url = null;
  const bytes = await bajarImagen(p.kw, i);
  if (bytes) imagen_url = await subirFoto(bytes);
  if (!imagen_url) imagen_url = `https://loremflickr.com/600/450/${encodeURIComponent(p.kw)}?lock=${i + 1}`; // fallback: URL externa directa

  await prisma.productos.create({
    data: {
      tenant_id: TENANT_ID,
      nombre: p.nombre,
      categoria: p.categoria,
      descripcion: p.descripcion,
      sku: p.sku,
      precio: p.precio,
      stock: p.stock,
      stock_minimo: p.stock_minimo,
      imagen_url,
      activo: true,
    },
  });
  creados++;
  console.log(`✓ ${p.nombre}  ($${p.precio.toLocaleString("es-AR")} · stock ${p.stock})`);
}

console.log(`\nListo. Creados: ${creados} · Saltados (ya existían): ${saltados}.`);
await prisma.$disconnect();
