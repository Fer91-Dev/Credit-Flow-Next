-- ============================================================================
-- 009 — UN COBRO PUEDE ADELANTAR VARIAS CUOTAS DEL ACUERDO
-- ============================================================================
--
-- 🔴 QUÉ PROBLEMA RESUELVE
--
-- Un cliente que viene con plata y quiere pagar dos cuotas del acuerdo juntas no tenía cómo:
-- la terminal cobraba SIEMPRE la próxima y nada más.
--
-- El ledger ya lo soportaba sin saberlo —el avance del acuerdo se DERIVA del total cobrado
-- desde que se firmó (`cobradoDesde` + `actualizarCuotasCobradas`), no del vínculo del pago—,
-- así que un cobro por el doble ya marcaba dos cuotas pagadas. Lo que faltaba era decirlo:
--
--   `pagos.acuerdo_cuota_id` apunta a UNA cuota pactada, y el recibo imprime "la cuota 1 de 3
--   del acuerdo de pago". Sobre un cobro que cubrió la 1 y la 2, ese papel le dice al cliente
--   que pagó una sola — y es el papel que se lleva a su casa.
--
-- Esta columna guarda hasta qué número llegó el cobro. `NULL` = una sola cuota, que es el caso
-- de siempre y el de todos los pagos anteriores.
--
-- 🔴 POR QUÉ SE GUARDA Y NO SE DERIVA AL IMPRIMIR
--
-- Por lo mismo que se guarda `acuerdo_cuota_id`: el reparto de lo cobrado se recalcula cada
-- vez que cambia el total, así que anular un pago viejo remapearía recibos YA ENTREGADOS. Un
-- comprobante dice lo que decía el día que se emitió, siempre.
--
-- 🔴 POR QUÉ AHORA
--
-- Producción está virgen: 0 pagos. La columna es aditiva y nullable — nada que migrar.
--
-- ============================================================================
-- IDEMPOTENTE: se puede correr dos veces sin romper nada.
-- ============================================================================

ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS acuerdo_cuota_hasta INTEGER;

COMMENT ON COLUMN public.pagos.acuerdo_cuota_hasta IS
  'Número de la ÚLTIMA cuota pactada que cubrió este cobro, cuando adelantó varias. NULL = cubrió solo la de acuerdo_cuota_id (el caso normal). Se guarda, no se deriva: el recibo tiene que decir lo mismo dentro de seis meses.';
