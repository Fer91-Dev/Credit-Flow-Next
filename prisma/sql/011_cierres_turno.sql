-- CIERRE DE TURNO: el acta de una caja física al terminar el día (16/09/2026).
--
-- Un turno va desde el cierre anterior hasta el momento del cierre. El acta se congela en esta
-- tabla (apertura, ingresos/egresos por tipo, saldo de sistema, contado, diferencia, retiro y
-- fondo que queda) y no se recalcula después: por eso son columnas y no una consulta.
-- Aditiva: no toca ninguna tabla existente.

CREATE TABLE IF NOT EXISTS cierres_turno (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id     UUID NOT NULL,
  fecha         DATE NOT NULL DEFAULT now(),
  vendedor_id   UUID REFERENCES vendedores(id) ON DELETE SET NULL,
  cuenta        TEXT NOT NULL DEFAULT 'efectivo',
  numero        INTEGER NOT NULL,
  abierto_desde TIMESTAMPTZ,
  cerrado_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  saldo_apertura DOUBLE PRECISION NOT NULL,
  ingresos       DOUBLE PRECISION NOT NULL,
  egresos        DOUBLE PRECISION NOT NULL,
  saldo_sistema  DOUBLE PRECISION NOT NULL,
  saldo_fisico   DOUBLE PRECISION NOT NULL,
  diferencia     DOUBLE PRECISION NOT NULL,
  retiro         DOUBLE PRECISION NOT NULL,
  fondo          DOUBLE PRECISION NOT NULL,
  detalle        JSONB NOT NULL,
  arqueo_id      UUID,
  retiro_id      UUID,
  observacion    TEXT,
  -- Dólares en la misma acta (misma cuenta que las columnas de arriba, en U$S); null = no había.
  dolares        JSONB,
  incluye_dolares BOOLEAN NOT NULL DEFAULT false,
  -- Posición de las tres cuentas al cierre (informativa): { efectivo, banco, dolares }.
  posicion       JSONB,
  cerrado_por        UUID,
  cerrado_por_nombre TEXT
);
CREATE INDEX IF NOT EXISTS cierres_turno_tenant_caja_idx
  ON cierres_turno (tenant_id, vendedor_id, cuenta, created_at);

-- Como toda tabla public: RLS activo (Prisma entra con service role y filtra por tenant en la app).
ALTER TABLE cierres_turno ENABLE ROW LEVEL SECURITY;

-- ── Tipo `gasto` ──────────────────────────────────────────────────────────────────────
-- Los gastos de los agentes se grababan como `ajuste` con comprobante GAS. Ahora tienen su
-- tipo: un gasto es resultado del negocio; un ajuste corrige una diferencia. La columna es
-- TEXT (sin enum): solo se reetiquetan las filas que ya eran gastos.
UPDATE movimientos_caja SET tipo = 'gasto' WHERE serie = 'GAS' AND tipo = 'ajuste';
