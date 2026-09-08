-- Quita de punitorios aplicada en un cobro, congelada en el pago.
--
-- El % de la campaña y los pesos condonados se guardaban solo en el `meta` de la auditoría,
-- así que el RECIBO no podía nombrarlos: decía "Interés por mora $19.636,50" cuando lo
-- devengado eran $24.545,62, sin rastro de los $4.909,12 de diferencia.
--
-- Aditivas y con default: no tocan ninguna fila existente. Los pagos anteriores quedan en 0,
-- que es lo correcto — ninguno llevaba descuento porque la quita recién ahora se comunica.
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS descuento_mora_pct DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS ahorro_mora        DOUBLE PRECISION NOT NULL DEFAULT 0;
