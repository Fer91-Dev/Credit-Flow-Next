/**
 * BARRERA CONTRA BORRADOS MASIVOS — el SQL, en un solo lugar.
 *
 * Lo usan `migrar-prod-017.mjs` (que la instala en producción) y `probar-barrera-dev.mjs` (que
 * la prueba en dev dentro de una transacción que se deshace). Una sola definición: si la
 * prueba y la migración tuvieran cada una su copia, se probaría una cosa y se instalaría otra.
 *
 * 🔴 QUÉ HACE. Es la ÚLTIMA defensa, adentro de la base: no depende de que el código, un
 * script o una persona se porten bien. En las tablas de la plata:
 *   - un DELETE que se lleve más de `LIMITE` filas en UNA sola sentencia se rechaza entero
 *     (la base lo deshace: no se borra ni una);
 *   - un TRUNCATE (vaciar la tabla de un golpe) se rechaza siempre.
 *
 * POR QUÉ 1.000. Ninguna operación normal del sistema se acerca: lo más grande que borra de una
 * vez es eliminar un crédito (sus cuotas, en cascada: un plan diario de un año son 365) o
 * anularlo (sus imputaciones). Un reset, en cambio, borra la tabla entera. Las cascadas de
 * Postgres borran de a un padre por vez, así que cuentan por crédito y no por lote.
 *
 * `auditoria` NO lleva barrera a propósito: su purga programada borra de a 5.000
 * (`lib/mantenimiento.ts`). Y en DEV no se instala: ahí el reset necesita borrar en masa.
 *
 * Si alguna vez hace falta un borrado grande legítimo (por ejemplo, dar de baja una
 * financiera entera), se hace a conciencia, dentro de una transacción:
 *   ALTER TABLE <tabla> DISABLE TRIGGER barrera_borrado_masivo;  … ;  ENABLE TRIGGER …
 * Que cueste ese paso es exactamente la idea.
 */
export const LIMITE = 1000;

/**
 * Excepción: `pago_cuota`. Anular un crédito borra TODAS sus imputaciones en una sentencia,
 * y un plan diario de un año cobrado día por día puede acercarse a mil. La barrera no puede
 * frenar una anulación legítima.
 */
export const LIMITE_POR_TABLA = { pago_cuota: 5000 };
export const limiteDe = (tabla) => LIMITE_POR_TABLA[tabla] ?? LIMITE;

export const TABLAS = [
  "clientes", "creditos", "cuotas", "pagos", "pago_cuota",
  "movimientos_caja", "acuerdos_pago", "liquidaciones_comision",
];

/** Las dos funciones. `search_path` vacío: no dependen de nada del esquema. */
export const FUNCIONES = [
  `CREATE OR REPLACE FUNCTION public.barrera_borrado_masivo() RETURNS trigger
   LANGUAGE plpgsql SET search_path = '' AS $fn$
   DECLARE
     n bigint;
     limite int := TG_ARGV[0]::int;
   BEGIN
     SELECT count(*) INTO n FROM borradas;
     IF n > limite THEN
       RAISE EXCEPTION 'BARRERA: se intentaron borrar % filas de % en una sola operacion (limite %). No se borro nada.',
         n, TG_TABLE_NAME, limite;
     END IF;
     RETURN NULL;
   END $fn$`,
  `CREATE OR REPLACE FUNCTION public.barrera_truncate() RETURNS trigger
   LANGUAGE plpgsql SET search_path = '' AS $fn$
   BEGIN
     RAISE EXCEPTION 'BARRERA: vaciar la tabla % esta bloqueado en produccion. No se borro nada.', TG_TABLE_NAME;
   END $fn$`,
];

/** Los triggers de una tabla. Idempotente: se borran y se vuelven a crear. */
export function triggersDe(tabla, limite = limiteDe(tabla)) {
  return [
    `DROP TRIGGER IF EXISTS barrera_borrado_masivo ON public."${tabla}"`,
    `CREATE TRIGGER barrera_borrado_masivo AFTER DELETE ON public."${tabla}"
     REFERENCING OLD TABLE AS borradas FOR EACH STATEMENT
     EXECUTE FUNCTION public.barrera_borrado_masivo('${limite}')`,
    `DROP TRIGGER IF EXISTS barrera_truncate ON public."${tabla}"`,
    `CREATE TRIGGER barrera_truncate BEFORE TRUNCATE ON public."${tabla}"
     FOR EACH STATEMENT EXECUTE FUNCTION public.barrera_truncate()`,
  ];
}
