// Preflight READ-ONLY: verifica el estado previo a la migración Modelo Org.
// No modifica nada. Usa $queryRawUnsafe (raw, agnóstico al schema Prisma).
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const q = (sql) => p.$queryRawUnsafe(sql);

try {
  // 1. ¿La columna user_id todavía existe? (confirmar estado PRE-migración)
  const cols = await q(`
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'user_id' AND table_schema = 'public'
    ORDER BY table_name`);
  console.log(`\n[1] Tablas con columna user_id (esperado ~15): ${cols.length}`);
  console.log("    " + cols.map((c) => c.table_name).join(", "));

  // 2. ¿Ya existe tenants / Role? (debe ser NO en pre-migración)
  const tenantsExists = await q(`SELECT to_regclass('public.tenants') IS NOT NULL AS x`);
  const roleExists = await q(`SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') AS x`);
  console.log(`\n[2] tenants existe?: ${tenantsExists[0].x}  |  enum Role existe?: ${roleExists[0].x}`);

  // 3. Universo de tenants (distinct user_id) que el seed crearía.
  const distinct = await q(`
    SELECT count(*)::int AS n FROM (
      SELECT user_id AS uid FROM clientes
      UNION SELECT user_id FROM creditos
      UNION SELECT user_id FROM vendedores
      UNION SELECT user_id FROM campanas_cobranza
      UNION SELECT user_id FROM campana_objetivo
      UNION SELECT user_id FROM movimientos_caja
      UNION SELECT user_id FROM cuotas
      UNION SELECT user_id FROM pago_cuota
      UNION SELECT user_id FROM pagos
      UNION SELECT user_id FROM solicitudes
      UNION SELECT user_id FROM acciones_cobranza
      UNION SELECT user_id FROM auditoria
      UNION SELECT user_id FROM proveedores
      UNION SELECT user_id FROM movimientos_proveedor
      UNION SELECT user_id FROM configuraciones
      UNION SELECT id FROM profiles
    ) t WHERE uid IS NOT NULL`);
  console.log(`\n[3] Tenants únicos que se crearían: ${distinct[0].n}`);

  // 4. INVARIANTE CRÍTICA: ¿todo user_id dueño de datos existe en auth.users?
  const huerfanos = await q(`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT user_id AS uid FROM clientes
      UNION SELECT user_id FROM creditos
      UNION SELECT user_id FROM configuraciones
    ) t
    WHERE uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.uid)`);
  console.log(`\n[4] user_id SIN match en auth.users (debe ser 0): ${huerfanos[0].n}`);

  // 5. Profiles actuales.
  const profs = await q(`SELECT count(*)::int AS n FROM profiles`);
  console.log(`\n[5] Filas en profiles hoy: ${profs[0].n}`);

  console.log("\n✅ Preflight OK (solo lectura, no se modificó nada).\n");
} catch (e) {
  console.error("\n❌ Error en preflight:", e.message, "\n");
  process.exitCode = 1;
} finally {
  await p.$disconnect();
}
