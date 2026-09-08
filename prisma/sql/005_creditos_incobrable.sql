-- Estado INCOBRABLE: cuándo se declaró y por qué.
--
-- El estado en sí no necesita migración (`creditos.estado` es un String, no un enum de la
-- base), pero sí estas dos columnas: la fecha es hasta dónde devengan los punitorios —seguir
-- cargando mora sobre algo que se mandó a ejecutar infla un número que nadie va a cobrar— y
-- el motivo es el registro de una decisión contable que dentro de un año nadie recuerda.
--
-- Aditivas y nulables: no tocan ninguna fila existente.
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS incobrable_at     TIMESTAMPTZ;
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS incobrable_motivo TEXT;
