/**
 * fix-productos-fotos — reemplaza la foto de los productos DEL SEED por una imagen
 * relevante al TIPO de producto (curada de Unsplash), re-alojada en el bucket `productos`.
 *
 * Respeta los productos editados a mano: si el `nombre` actual difiere del nombre
 * original del seed (por SKU), se SALTA (asumimos que le pusiste una foto real). Los
 * productos que no son del seed (sin SKU coincidente) también se saltan.
 *
 * Las imágenes son fotos GENÉRICAS del tipo de producto (no de la marca/modelo exacto),
 * verificadas y re-alojadas. Si un candidato no baja, prueba el siguiente; si ninguno
 * funciona, deja el producto como está y lo reporta (nunca pone una foto aleatoria).
 *
 * Uso (dentro del contenedor):  docker compose exec app node scripts/fix-productos-fotos.mjs
 * Tras correrlo: Ctrl+Shift+R en el navegador.
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }

// SKU → nombre ORIGINAL del seed + IDs de foto de Unsplash (fotos del TIPO de producto).
// Si el nombre en la DB difiere del original, se considera editado a mano y se salta.
const SEED = [
  { sku: "TEC-TV50",   nombre: 'Smart TV 50" 4K UHD',       ids: ["1593305841991-05c297ba4575", "1461151304267-38535e780c79"] },
  { sku: "TEC-NB15",   nombre: 'Notebook 15.6" Core i5',    ids: ["1496181133206-80ce9b88a853", "1517336714731-489689fd1ca8"] },
  { sku: "TEC-SP128",  nombre: "Smartphone 128GB",          ids: ["1511707171634-5f897ff02aa9", "1512499617640-c74ae3a79d37"] },
  { sku: "TEC-AUR",    nombre: "Auriculares Inalámbricos",  ids: ["1505740420928-5e560c06d30e", "1583394838336-acd977736f90"] },
  { sku: "TEC-MON24",  nombre: 'Monitor 24" Full HD',       ids: ["1527443224154-c4a3942d3acf", "1587831990711-23ca6441447b"] },
  { sku: "ELE-HEL360", nombre: "Heladera No Frost 360L",    ids: ["1571175443880-49e1d25b2bc5", "1536353284924-9220c464e262"] },
  { sku: "ELE-LAV8",   nombre: "Lavarropas Automático 8kg", ids: ["1626806787461-102c1bfaaea1", "1610557892470-55d9e80c0bce"] },
  { sku: "ELE-MIC28",  nombre: "Microondas 28L Digital",    ids: ["1585659722983-3a675dabf23d", "1574269909862-7e1d70bb8078"] },
  { sku: "ELE-COC4",   nombre: "Cocina 4 Hornallas",        ids: ["1556909114-f6e7ad7d3136", "1565538810643-b5bdb714032a"] },
  { sku: "HOG-LIC15",  nombre: "Licuadora 1.5L",            ids: ["1570222094114-d054a817e56b", "1585515320310-259814833e62"] },
  { sku: "HOG-ASP",    nombre: "Aspiradora Ciclónica",      ids: ["1558317374-067fb5f30001", "1600166898405-da9535204843"] },
  { sku: "HOG-VEN20",  nombre: 'Ventilador de Pie 20"',     ids: ["1558002038-1055907df827", "1571068316344-75bc76f77890", "1616627988744-e8f8b2f0b3a4", "1524438418049-ab2fc3b74b6a"] },
  { sku: "HOG-CAF",    nombre: "Cafetera Express",          ids: ["1610889556528-9a770e32642f", "1495474472287-4d71bcdd2085"] },
  { sku: "HOG-SAB",    nombre: "Juego de Sábanas Queen",    ids: ["1522771739844-6a9f6d5f14af", "1616486338812-3dadae4b4ace"] },
  { sku: "MUE-SOF3",   nombre: "Sofá 3 Cuerpos",            ids: ["1555041469-a586c61ea9bc", "1493663284031-b7e3aefcae8e"] },
  { sku: "MUE-COL",    nombre: "Colchón Queen Resortes",    ids: ["1631049307264-da0ec9d70304", "1505693416388-ac5ce068fe85"] },
  { sku: "MUE-ESC",    nombre: "Escritorio de Oficina",     ids: ["1518455027359-f3f8164ba6bd", "1524758631624-e2822e304c36"] },
  { sku: "HER-TAL13",  nombre: "Taladro Percutor 13mm",     ids: ["1504148455328-c376907d081c", "1572981779307-38b8cabb2407"] },
  { sku: "DEP-BIKR29", nombre: "Bicicleta Mountain Bike R29", ids: ["1576435728678-68d0fbf94e91", "1485965120184-e220f721d03e"] },
];

/** Baja el primer candidato de Unsplash que devuelva una imagen válida. null si ninguno. */
async function bajarImagen(ids) {
  for (const id of ids) {
    try {
      const r = await fetch(`https://images.unsplash.com/photo-${id}?w=800&q=80&fit=crop`, { redirect: "follow" });
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") || "";
      const buf = Buffer.from(await r.arrayBuffer());
      const esImagen = ct.startsWith("image/") || (buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50);
      if (esImagen && buf.length > 4000) return buf;
    } catch { /* siguiente candidato */ }
  }
  return null;
}

/** Sube los bytes al bucket `productos` y devuelve la URL pública. */
async function subirFoto(buf) {
  const path = `${TENANT_ID}/${randomUUID()}.jpg`;
  const res = await fetch(`${SUPA_URL}/storage/v1/object/productos/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPA_KEY}`, apikey: SUPA_KEY, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: buf,
  });
  if (!res.ok) { console.warn("  ⚠ no se pudo subir:", res.status); return null; }
  return `${SUPA_URL}/storage/v1/object/public/productos/${path}`;
}

const norm = (s) => (s ?? "").trim();
let reemplazados = 0, editados = 0, faltantes = 0, fallidos = 0;

for (const s of SEED) {
  const prod = await prisma.productos.findFirst({ where: { tenant_id: TENANT_ID, sku: s.sku }, select: { id: true, nombre: true } });
  if (!prod) { console.log(`· ${s.sku} — no existe, salto`); faltantes++; continue; }
  if (norm(prod.nombre) !== norm(s.nombre)) { console.log(`✋ ${s.sku} — editado a mano ("${prod.nombre}"), lo respeto`); editados++; continue; }

  const bytes = await bajarImagen(s.ids);
  if (!bytes) { console.log(`⚠ ${s.sku} — no se pudo bajar foto, queda como está`); fallidos++; continue; }
  const url = await subirFoto(bytes);
  if (!url) { fallidos++; continue; }

  await prisma.productos.update({ where: { id: prod.id }, data: { imagen_url: url, imagenes: [url] } });
  console.log(`✓ ${s.sku} — ${prod.nombre}`);
  reemplazados++;
}

console.log(`\nListo. Reemplazadas: ${reemplazados} · Editadas (respetadas): ${editados} · No encontradas: ${faltantes} · Fallidas: ${fallidos}.`);
await prisma.$disconnect();
