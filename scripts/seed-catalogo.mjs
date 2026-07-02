/**
 * seed-catalogo — reinserta el CATÁLOGO fijo de productos demo (21 productos con sus
 * fotos ya curadas) desde `scripts/catalogo-productos.json`. Idempotente: salta los que
 * ya existen (por SKU; por nombre si el SKU es null). No descarga imágenes: usa las URLs
 * ya guardadas (Storage de Supabase + URLs de retailers), así restaurar el catálogo es
 * instantáneo y no depende de fuentes externas de imágenes.
 *
 * Flujo típico tras un reset de datos ficticios:
 *   npm run reset:test -- --confirm   # limpia clientes/créditos/caja (NO toca productos)
 *   npm run seed:productos            # repone el catálogo si faltara (idempotente)
 *   npm run seed:reportes             # repone créditos/pagos demo para Reportes
 *
 * Uso (dentro del contenedor):  docker compose exec app node scripts/seed-catalogo.mjs
 * Para regenerar el JSON desde la DB actual: ver el bloque comentado al pie.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const __dir = dirname(fileURLToPath(import.meta.url));
const catalogo = JSON.parse(readFileSync(join(__dir, "catalogo-productos.json"), "utf8"));

let creados = 0, saltados = 0;
for (const p of catalogo) {
  const where = p.sku ? { tenant_id: TENANT_ID, sku: p.sku } : { tenant_id: TENANT_ID, nombre: p.nombre };
  const existe = await prisma.productos.findFirst({ where, select: { id: true } });
  if (existe) { saltados++; continue; }
  await prisma.productos.create({
    data: {
      tenant_id: TENANT_ID,
      nombre: p.nombre,
      categoria: p.categoria ?? null,
      sku: p.sku ?? null,
      precio: p.precio,
      stock: p.stock ?? 0,
      stock_minimo: p.stock_minimo ?? null,
      descripcion: p.descripcion ?? null,
      imagen_url: p.imagen_url ?? null,
      imagenes: Array.isArray(p.imagenes) ? p.imagenes : [],
      activo: p.activo ?? true,
    },
  });
  creados++;
  console.log(`✓ ${p.nombre}`);
}

console.log(`\nListo. Creados: ${creados} · Ya existían (saltados): ${saltados}.`);
await prisma.$disconnect();

/*
 * Para REGENERAR scripts/catalogo-productos.json desde la DB actual (si editás productos
 * a mano y querés congelar el nuevo estado), corré dentro del contenedor:
 *
 *   docker compose exec app node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.productos.findMany({where:{tenant_id:'00000000-0000-0000-0000-000000000001'},orderBy:{created_at:'asc'},select:{nombre:true,categoria:true,sku:true,precio:true,stock:true,stock_minimo:true,descripcion:true,imagen_url:true,imagenes:true,activo:true}}).then(x=>{require('fs').writeFileSync('/tmp/catalogo.json',JSON.stringify(x,null,0));console.log('ok',x.length);}).finally(()=>p.\$disconnect());"
 *   docker compose cp app:/tmp/catalogo.json scripts/catalogo-productos.json
 */
