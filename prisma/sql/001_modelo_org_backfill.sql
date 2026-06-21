-- ============================================================================
-- Migración manual — Fase 1: Modelo Org (desacople user_id → tenant_id)
-- ============================================================================
-- Estrategia: IDENTITY-PRESERVING. Sembramos `tenants` con id = el user_id
-- existente, de modo que toda fila operativa (que hoy tiene user_id = X) ya
-- apunta a un tenant válido X. Luego solo RENOMBRAMOS la columna. Cero
-- movimiento de datos de negocio. Reversible.
--
-- ⚠️ NO EJECUTAR todavía. Revisión previa. Correr SIEMPRE dentro de transacción
--    y con backup/snapshot de la base de producción tomado.
--
-- Orden: (0) backup → (1) enum+tabla → (2) seed tenants → (3) rename columnas
--        → (4) profiles → (5) FKs → (6) verificación.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) Tipo enum de roles + tabla de tenants
-- ----------------------------------------------------------------------------
CREATE TYPE "Role" AS ENUM ('admin', 'vendedor', 'cobrador');

CREATE TABLE "tenants" (
  "id"         uuid        NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "nombre"     text        NOT NULL,
  "activo"     boolean     NOT NULL DEFAULT true,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------------------
-- (2) Seed de tenants: un tenant por cada user_id que hoy posee datos.
--     Unimos los user_id de TODAS las tablas operativas para no dejar afuera
--     ningún tenant (p. ej. uno con configuración pero sin clientes).
--     El id del tenant = el user_id existente (identity-preserving).
-- ----------------------------------------------------------------------------
INSERT INTO "tenants" ("id", "nombre")
SELECT DISTINCT uid, 'Financiera ' || left(uid::text, 8)
FROM (
  SELECT user_id AS uid FROM "clientes"
  UNION SELECT user_id FROM "creditos"
  UNION SELECT user_id FROM "vendedores"
  UNION SELECT user_id FROM "campanas_cobranza"
  UNION SELECT user_id FROM "campana_objetivo"
  UNION SELECT user_id FROM "movimientos_caja"
  UNION SELECT user_id FROM "cuotas"
  UNION SELECT user_id FROM "pago_cuota"
  UNION SELECT user_id FROM "pagos"
  UNION SELECT user_id FROM "solicitudes"
  UNION SELECT user_id FROM "acciones_cobranza"
  UNION SELECT user_id FROM "auditoria"
  UNION SELECT user_id FROM "proveedores"
  UNION SELECT user_id FROM "movimientos_proveedor"
  UNION SELECT user_id FROM "configuraciones"
  UNION SELECT id      FROM "profiles"   -- usuarios ya existentes (admins)
) AS todos_los_user_ids
WHERE uid IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- ----------------------------------------------------------------------------
-- (3) Renombrar user_id → tenant_id en las 15 tablas operativas.
--     RENAME COLUMN preserva datos e índices (Postgres reapunta los índices
--     automáticamente; conservan su nombre interno, lo cual es cosmético).
-- ----------------------------------------------------------------------------
ALTER TABLE "clientes"              RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "creditos"              RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "vendedores"            RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "campanas_cobranza"     RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "campana_objetivo"      RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "movimientos_caja"      RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "cuotas"                RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "pago_cuota"            RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "pagos"                 RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "solicitudes"           RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "acciones_cobranza"     RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "auditoria"             RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "proveedores"           RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "movimientos_proveedor" RENAME COLUMN "user_id" TO "tenant_id";
ALTER TABLE "configuraciones"       RENAME COLUMN "user_id" TO "tenant_id";

-- ----------------------------------------------------------------------------
-- (4) Ampliar `profiles`: tenant_id, role, email, activo, vendedor_id.
--     Backfill: los usuarios ya existentes son los dueños → admin, activos,
--     tenant_id = su propio id. Además garantizamos un profile admin por cada
--     tenant sembrado (si algún tenant no tenía fila en profiles).
-- ----------------------------------------------------------------------------
ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "email"       text,
  ADD COLUMN IF NOT EXISTS "tenant_id"   uuid,
  ADD COLUMN IF NOT EXISTS "role"        "Role",
  ADD COLUMN IF NOT EXISTS "activo"      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "vendedor_id" uuid;

-- 4a. Profiles existentes → admin del propio tenant, activos.
UPDATE "profiles"
SET "tenant_id" = "id",
    "role"      = 'admin',
    "activo"    = true
WHERE "tenant_id" IS NULL;

-- 4b. Garantizar un profile admin por cada tenant (los que tienen auth.users
--     pero aún no tenían fila en profiles).
INSERT INTO "profiles" ("id", "tenant_id", "role", "activo")
SELECT t."id", t."id", 'admin', true
FROM "tenants" t
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t."id")
ON CONFLICT ("id") DO NOTHING;

-- ----------------------------------------------------------------------------
-- (5) Integridad referencial de profiles (las tablas operativas se aíslan por
--     app-layer `withTenant` + RLS, sin FK pesada a tenants — decisión Fase 1).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "profiles_tenant_id_idx" ON "profiles" ("tenant_id");

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE;

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_vendedor_id_fkey"
  FOREIGN KEY ("vendedor_id") REFERENCES "vendedores" ("id") ON DELETE SET NULL;

-- profiles.id ya debería referenciar auth.users(id). Si no existe la FK aún:
-- ALTER TABLE "profiles"
--   ADD CONSTRAINT "profiles_id_fkey"
--   FOREIGN KEY ("id") REFERENCES auth.users ("id") ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- (6) Verificación (debe dar 0 filas huérfanas antes del COMMIT).
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS clientes_sin_tenant FROM "clientes"
--   WHERE "tenant_id" NOT IN (SELECT "id" FROM "tenants");
-- SELECT count(*) AS profiles_sin_rol FROM "profiles"
--   WHERE "role" IS NULL AND "activo" = true;

COMMIT;

-- ============================================================================
-- ROLLBACK (si algo falla, antes del COMMIT, basta con ROLLBACK;).
-- Para revertir POST-COMMIT, el inverso sería:
--   ALTER TABLE ... RENAME COLUMN "tenant_id" TO "user_id";  (x15)
--   ALTER TABLE "profiles" DROP COLUMN ...;
--   DROP TABLE "tenants"; DROP TYPE "Role";
-- ============================================================================
