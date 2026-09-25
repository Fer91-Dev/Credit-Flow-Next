/**
 * Completa `creado_por` / `creado_por_nombre` de las campañas que existían antes de la
 * migración 018, a partir de la AUDITORÍA del alta (entidad "campana", acción "crear"), que
 * guarda quién la hizo. Idempotente: solo toca campañas sin autor.
 *
 *   node --env-file=.env.local scripts/backfill-creador-campanas.mjs                 (dev)
 *   node --env-file=.env.production.local scripts/backfill-creador-campanas.mjs      (prod)
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const sinAutor = await db.campanas_cobranza.findMany({ where: { creado_por_nombre: null }, select: { id: true, tenant_id: true, nombre: true } });
let completadas = 0;
for (const c of sinAutor) {
  const a = await db.auditoria.findFirst({
    where: { tenant_id: c.tenant_id, entidad: "campana", entidad_id: c.id, accion: "crear" },
    orderBy: { created_at: "asc" },
    select: { usuario_id: true, usuario_nombre: true, usuario_email: true },
  });
  const nombre = a?.usuario_nombre || a?.usuario_email || null;
  if (!nombre) { console.log(`  sin rastro en la auditoría: ${c.nombre}`); continue; }
  await db.campanas_cobranza.update({ where: { id: c.id }, data: { creado_por: a.usuario_id, creado_por_nombre: nombre } });
  completadas++;
}
console.log(`campañas sin autor: ${sinAutor.length} · completadas desde la auditoría: ${completadas}`);
await db.$disconnect();
