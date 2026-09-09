-- CIERRE DE UN CASO INCOBRABLE: el cliente acepta una oferta, paga, y la deuda se termina.
--
-- Hasta acá un incobrable admitía cobros pero no podía CERRARSE: el pago se imputaba contra la
-- deuda nominal y el cliente quedaba debiendo el resto, con el crédito abierto para siempre.
-- Cobrarle a Ricardo Paz los $1.119.960,00 que el motor sugiere lo dejaba debiendo
-- $5.625.379,99. Estas columnas registran la otra mitad de la operación: qué se condonó y
-- cuánta plata se perdió de verdad.
--
-- Todas aditivas y nulables/con default: no tocan ninguna fila existente.

-- ── El cierre, en el crédito ────────────────────────────────────────────────────────────
-- Cuándo se cerró el caso. Es el marcador: `NULL` = nunca se cerró por recupero.
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS recupero_at        TIMESTAMPTZ;
-- Lo que entró en el cierre. No se deriva de `pagos` porque a un incobrable se le pueden haber
-- imputado cobros parciales antes: este es el del acuerdo de cancelación, no la suma de todos.
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS recupero_cobrado   DOUBLE PRECISION;
-- Deuda nominal perdonada (capital del crédito + interés del plan + punitorios).
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS recupero_condonado DOUBLE PRECISION;
-- LA PÉRDIDA DE CAJA: plata prestada que no volvió, medida contra el crédito RAÍZ de la
-- cadena. Va como columna propia y no se deriva de la anterior a propósito: en un refinanciado
-- el "capital" incluye interés capitalizado, así que condonado y perdido son números muy
-- distintos y el que importa para el resultado del negocio es este.
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS recupero_perdida   DOUBLE PRECISION;
-- Cuánto había sugerido el motor. La diferencia contra lo cobrado es la que hay que poder
-- explicar después: sin esto no se puede auditar si el operador cerró bien o regaló el caso.
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS recupero_sugerido  DOUBLE PRECISION;
-- Con quién se pactó y bajo qué condiciones. Obligatorio al cerrar, igual que el motivo de la
-- declaración de incobrable: dar por perdida plata es una decisión contable.
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS recupero_nota      TEXT;

-- ── Lo condonado, cuota por cuota ───────────────────────────────────────────────────────
-- Una cuota que se condona NO es una cuota pagada: nadie puso esa plata. Marcarla como
-- `pagada` haría que los reportes de cobranza contaran como cobrado algo que se perdonó.
-- El estado `condonada` es su propio valor (la columna es TEXT, no un enum de la base) y esta
-- columna guarda cuánto se perdonó en ella.
ALTER TABLE cuotas ADD COLUMN IF NOT EXISTS condonado DOUBLE PRECISION NOT NULL DEFAULT 0;
