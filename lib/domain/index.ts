/**
 * Motor financiero de CreditFlow — capa de dominio pura (sin dependencias de framework).
 *
 * Reglas configuradas con el negocio:
 *  - Tasa `tasa` del crédito = Nominal Anual capitalizable mensual (tasa/12 = mensual).
 *  - Amortización: sistema francés (cuota fija).
 *  - Mora: 1% del valor de la cuota por día de atraso (interés moratorio diario simple).
 *  - Imputación de pagos: Mora → Interés → Capital.
 */
export * from "./config";
export * from "./money";
export * from "./rates";
export * from "./amortization";
export * from "./frequency";
export * from "./mora";
export * from "./payments";
export * from "./refinanciacion";
export * from "./cuotas";
export * from "./credito-estado";
export * from "./caja";
export * from "./campanas";
export * from "./calendar";
export * from "./scoring";
export * from "./comisiones";
export * from "./proveedores";
export * from "./logros";
export * from "./stock";
export * from "./reportes";
