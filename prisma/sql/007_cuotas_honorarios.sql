-- ============================================================================
-- 007 — LOS HONORARIOS DE GESTIÓN, CON COLUMNA PROPIA
-- ============================================================================
--
-- 🔴 QUÉ PROBLEMA RESUELVE
--
-- `cuotas` tenía tres columnas de cargo — iva, seguro y gastos — y los honorarios por gestión
-- de cobranza, que se cobran al refinanciar, se guardaban SUMADOS dentro de `gastos`.
--
-- El motor sí los calcula aparte; era el mapeo a la fila persistida el que los fusionaba. A
-- partir de ahí quedaban indistinguibles:
--
--   · el cliente veía "gastos $9.100,25" sobre una refinanciación, sin saber que está pagando
--     el honorario de la gestión que lo llevó ahí — que es justamente el cargo que conviene
--     tener nombrado;
--   · si algún día se activan los gastos administrativos, los dos conceptos se mezclan en la
--     misma columna y no se separan NUNCA MÁS;
--   · y no había forma de medir cuánto gana la financiera gestionando, que es un ingreso por
--     un servicio distinto del interés.
--
-- La única traza que quedaba era el snapshot `cargos` del crédito, que da el total de ESE
-- crédito pero no sirve para el plan de cuotas, el recibo ni un reporte.
--
-- 🔴 POR QUÉ AHORA
--
-- Producción está virgen: 0 créditos, 0 cuotas. Esta migración no toca un solo dato real.
-- Hacerla después significa migrar cuotas con plata imputada encima.
--
-- ============================================================================
-- IDEMPOTENTE: se puede correr dos veces sin romper nada.
-- ============================================================================

ALTER TABLE public.cuotas
  ADD COLUMN IF NOT EXISTS honorarios DOUBLE PRECISION NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cuotas.honorarios IS
  'Honorarios por gestión de cobranza prorrateados en esta cuota. Se cobran al refinanciar y no capitalizan: es lo que costó gestionar, no plata prestada. Forman parte de los CARGOS de la cuota junto con iva, seguro y gastos.';

-- ============================================================================
-- BACKFILL — NO SE HACE, Y ES A PROPÓSITO.
--
-- Los honorarios viejos están sumados dentro de `gastos` y no hay forma de separarlos con una
-- consulta: habría que repartir el total del snapshot `cargos` del crédito entre sus cuotas y
-- restarlo, replicando el prorrateo del motor (incluida la cuota de ajuste que absorbe el
-- redondeo). Sobre producción no hay nada que separar — no hay créditos — y en desarrollo son
-- casos de prueba que se resiembran.
--
-- Para dev existe `scripts/backfill-honorarios-cuotas.mjs`, que hace exactamente ese reparto
-- y verifica que la suma cierre antes de escribir.
-- ============================================================================
