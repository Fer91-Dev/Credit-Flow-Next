// DEV-ONLY seed (idempotente): garantiza que el DEV_USER_ID sintético
// (usado con DEV_BYPASS_AUTH=true) tenga su tenant y un profile admin activo,
// para que el sistema siga usable en desarrollo tras la migración Modelo Org.
// En producción NO se corre: los dueños reales ya viven en auth.users (paso 4b).
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

try {
  await p.$executeRawUnsafe(`
    INSERT INTO tenants (id, nombre, activo)
    VALUES ($1::uuid, 'Financiera Demo (dev)', true)
    ON CONFLICT (id) DO NOTHING`, DEV_USER_ID);

  await p.$executeRawUnsafe(`
    INSERT INTO profiles (id, tenant_id, role, activo, full_name, email)
    VALUES ($1::uuid, $1::uuid, 'admin', true, 'Dev Admin', 'dev@creditflow.local')
    ON CONFLICT (id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          role      = 'admin',
          activo    = true`, DEV_USER_ID);

  // Verificación post-estado
  const t = await p.$queryRawUnsafe(`SELECT count(*)::int n FROM tenants`);
  const pr = await p.$queryRawUnsafe(`SELECT id, tenant_id, role::text, activo FROM profiles`);
  const cols = await p.$queryRawUnsafe(`
    SELECT count(*)::int n FROM information_schema.columns
    WHERE column_name = 'tenant_id' AND table_schema = 'public'`);
  const oldCols = await p.$queryRawUnsafe(`
    SELECT count(*)::int n FROM information_schema.columns
    WHERE column_name = 'user_id' AND table_schema = 'public'`);

  console.log(`\n[post] tenants: ${t[0].n}`);
  console.log(`[post] tablas con tenant_id: ${cols[0].n}  |  con user_id (debe ser 0): ${oldCols[0].n}`);
  console.log(`[post] profiles:`, pr);
  console.log("\n✅ Dev-seed OK.\n");
} catch (e) {
  console.error("\n❌ Error en dev-seed:", e.message, "\n");
  process.exitCode = 1;
} finally {
  await p.$disconnect();
}
