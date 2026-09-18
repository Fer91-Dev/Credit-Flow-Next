-- 013 · Ubicación del domicilio del cliente y memoria barrio → zona (18/09/2026).
-- Aditivo. En prod se aplica con scripts/migrar-prod-013.mjs (el SQL sale de `migrate diff`).
ALTER TABLE "clientes" ADD COLUMN "latitud" DOUBLE PRECISION, ADD COLUMN "longitud" DOUBLE PRECISION, ADD COLUMN "barrio" TEXT, ADD COLUMN "geo_estado" TEXT, ADD COLUMN "geocodificado_en" TIMESTAMPTZ(6);
CREATE TABLE "barrio_zona" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" UUID NOT NULL,
  "barrio" TEXT NOT NULL,
  "zona" TEXT NOT NULL,
  CONSTRAINT "barrio_zona_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "barrio_zona_tenant_id_barrio_key" ON "barrio_zona"("tenant_id", "barrio");
ALTER TABLE "barrio_zona" ENABLE ROW LEVEL SECURITY;
