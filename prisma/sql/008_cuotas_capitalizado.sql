-- ============================================================================
-- 008 — LA PARTE DE LA CUOTA QUE SE AGREGÓ DESPUÉS NO DEVENGA PUNITORIOS
-- ============================================================================
--
-- 🔴 QUÉ PROBLEMA RESUELVE
--
-- Al firmar un acuerdo de pago en modo `capitaliza`, el interés del acuerdo se reparte como
-- cargo sobre las cuotas vivas del crédito (`capitalizarInteresEnCuotas`): `gastos` sube y
-- `cuota_total` sube con él. Hace falta, porque si no el cobro del acuerdo no tiene contra
-- qué imputarse.
--
-- Pero `cuota_total` es TAMBIÉN la base sobre la que corre el punitorio. Así que agrandarla
-- reescribe hacia atrás la mora ya devengada: los mismos días de atraso, sobre una base
-- mayor, dan más plata — punitorios cobrados sobre un interés que en esos días no existía.
--
-- Medido sobre CRD-000006 (Héctor Ibarra), acuerdo del 10/09/2026:
--
--   al firmar        base $165.187,97  → mora congelada $70.204,89
--   tras capitalizar base $184.353,18  → mora congelada $78.350,10
--                                        ───────────────────────────
--                                        $8.145,21 de más
--
-- Y no es solo un número en pantalla: el crédito quedaba debiendo $631.409,64 mientras el
-- acuerdo pedía $623.254,43. Si el cliente pagaba las tres cuotas pactadas completas, el
-- acuerdo cerraba como CUMPLIDO y el crédito se quedaba con $8.145,21 vivos — o sea que
-- volvía a ser moroso después de haber pagado todo lo que se le pidió.
--
-- 🔴 LA REGLA QUE QUEDA
--
-- El interés de un acuerdo es, él mismo, el precio del atraso. Cobrarle punitorios encima es
-- interés sobre interés sobre interés (art. 770 CCyC). Esta columna lo deja identificado para
-- que la base de mora pueda excluirlo: `baseMoraDeCuota()` en `lib/domain/cuotas.ts` es la
-- única definición de esa resta, y el tipo la exige — una consulta que no traiga la columna
-- no compila.
--
-- 🔴 POR QUÉ AHORA
--
-- Producción está virgen: 0 créditos, 0 cuotas. Esta migración no toca un solo dato real.
-- El día que haya cartera, esto se arregla moviéndole la deuda a gente que ya pagó.
--
-- ============================================================================
-- IDEMPOTENTE: se puede correr dos veces sin romper nada.
-- ============================================================================

ALTER TABLE public.cuotas
  ADD COLUMN IF NOT EXISTS capitalizado DOUBLE PRECISION NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cuotas.capitalizado IS
  'Cuánto de esta cuota se agregó DESPUÉS de originarla, capitalizando el interés de un acuerdo de pago (modo capitaliza). Está incluido en gastos y en cuota_total —el cobro lo imputa como cualquier cargo— pero se resta de la base de mora: son días de atraso anteriores a que esa deuda existiera. Ver baseMoraDeCuota() en lib/domain/cuotas.ts.';

-- ============================================================================
-- BACKFILL — hace falta en desarrollo, no en producción.
--
-- Producción no tiene cuotas. En desarrollo hay acuerdos ya firmados cuyo interés ya se
-- repartió, y esa parte quedaría contada en la base de mora para siempre. Lo reconstruye
-- `scripts/backfill-capitalizado-cuotas.mjs` replicando el MISMO reparto proporcional de
-- `capitalizarInteresEnCuotas`, verificando que la suma cierre contra
-- `acuerdos_pago.interes_capitalizado` antes de escribir una sola fila (dry-run por defecto).
-- ============================================================================
