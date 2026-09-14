-- Nota: los importes de los comentarios van SIN el signo peso a proposito. Un "$29" dentro
-- del archivo lo toma Postgres como parametro posicional si alguien pasa el .sql entero por
-- executeRawUnsafe, y la migracion falla con un error de sintaxis que no dice por que.
--
-- 010 · LA MORA PERDONADA POR UNA CAMPAÑA SE ASIENTA, NO SE RECALCULA
--
-- 🔴 QUÉ ARREGLA
--
-- La quita de una campaña de recuperación ("pagá antes del 30 y te perdonamos el 20% de los
-- punitorios") no se guardaba en ningún lado: se aplicaba como un FACTOR en el momento de
-- calcular la mora. Mientras la campaña estaba activa la cuota pedía el 80%; al vencer la
-- campaña, la mora volvía a calcularse al 100% y lo perdonado REAPARECÍA como deuda de esa
-- misma cuota, que el cobro siguiente levantaba sin que nadie lo notara.
--
-- Medido sobre CRD-000065 en desarrollo:
--
--     cuota 1   mora plena          29.596,18 pesos
--               cobrada con promo   23.676,94 pesos   → perdonado 5.919,24 pesos
--               `condonado`              0,00   → ninguna traza
--     el cobro siguiente imputó 14.178,64 pesos = 8.259,40 pesos (cuota 2) + 5.919,24 pesos (la cuota 1)
--
-- El cliente pagó dentro del plazo y terminó pagando el 100%. Sin error, sin excepción y sin
-- ningún número en rojo. Y no es un caso borde: con la promo activa el importe a cobrar SIEMPRE
-- pide el 80%, así que todo cobro hecho bajo campaña dejaba ese residuo.
--
-- 🔴 POR QUÉ UNA COLUMNA PROPIA Y NO `condonado`
--
-- `cuotas.condonado` es lo perdonado DEL PLAN (capital + interés + cargos) al cerrar un caso
-- incobrable o un acuerdo cumplido, y el certificado de libre deuda lo usa para cerrar la
-- cuenta contra el total de las cuotas. La mora se devenga ENCIMA del plan, no dentro: meterla
-- en la misma columna haría que esa cuenta diera de más y el papel volvería a contradecirse.
--
-- Aditiva, con default 0: no hay nada que migrar. Producción está virgen.
ALTER TABLE public.cuotas
  ADD COLUMN IF NOT EXISTS condonado_mora DOUBLE PRECISION NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cuotas.condonado_mora IS
  'Punitorios PERDONADOS de forma definitiva (quita de campaña aplicada al cobrar). La mora exigible de la cuota es la devengada menos esto: una vez perdonada, no vuelve aunque la campaña venza.';
