import { round2 } from "./money";
import { esOperacionColocada } from "./reportes";

/**
 * REPORTE DE PRODUCTOS — qué se vende, cuánto deja colocado y en qué se está convirtiendo.
 *
 * Fernando (20/09/2026): «en reportes no tenemos nada relacionado a productos; quiero saber
 * los más vendidos y el ticket promedio sobre productos».
 *
 * 🔴 UNA SOLA DEFINICIÓN DE "VENDIDO", Y ES LA MISMA QUE LA DEL RESTO DE REPORTES.
 *
 * Una venta cuenta cuando el crédito se OTORGA (`fecha_inicio`), no cuando el cliente termina
 * de pagarlo: el producto ya salió del depósito ese día, y el capital ya está en la calle. Y
 * el conjunto es `esOperacionColocada` —sin refinanciaciones, sin anulados—, el mismo con el
 * que se arma "Monto otorgado" en el Resumen. Si acá se contara distinto, dos pantallas del
 * mismo sistema dirían dos números para la misma pregunta, que es el error que ya costó caro
 * en el desglose por tipo (ver `esOperacionColocada`).
 *
 * Las UNIDADES salen del mismo crédito (`producto_cantidad`), no del kardex: el kardex se
 * fecha por cuándo se asentó el movimiento y los créditos por cuándo se otorgaron, así que
 * mezclarlos haría que las unidades y la plata de la misma tarjeta se separaran en los bordes
 * del período. Una venta anulada no cuenta en ninguno de los dos (el kardex la devuelve,
 * `esOperacionColocada` la saca).
 */

/** Lo que hace falta de cada crédito para este reporte. */
export interface CreditoDeProducto {
  producto_id: string | null;
  producto_cantidad: number | null;
  monto_original: number;
  fecha_inicio: Date;
  es_refinanciacion: boolean;
  estado: string;
  producto: { nombre: string; categoria: string | null; sku: string | null } | null;
}

export interface ResumenProductos {
  /** Unidades que salieron del depósito en el período. */
  unidades: number;
  /** Capital colocado en créditos de producto (precio × cantidad, congelado al otorgar). */
  financiado: number;
  operaciones: number;
  /** Cuánto se financia por operación. */
  ticket_operacion: number;
  /**
   * Cuánto vale la unidad promedio. NO es lo mismo que el ticket: si el ticket es $540.000 y
   * la unidad $180.000, la gente se lleva tres cosas por vez. Esa diferencia es el dato.
   */
  precio_unidad: number;
  /** Cuántos productos distintos del catálogo se vendieron al menos una vez. */
  productos_distintos: number;
}

export interface FilaProductoVendido {
  producto_id: string;
  nombre: string;
  categoria: string | null;
  sku: string | null;
  unidades: number;
  operaciones: number;
  monto: number;
  /** Lo que se financia por operación de ESTE producto. */
  ticket_promedio: number;
  pct_monto: number;
  pct_unidades: number;
  /** Último día en que se otorgó un crédito por este producto (ISO, sin hora). */
  ultima_venta: string | null;
}

export interface FilaCategoria {
  categoria: string;
  unidades: number;
  operaciones: number;
  monto: number;
  pct_monto: number;
}

export interface PuntoProductosMes {
  mes: string; // "2026-09"
  unidades: number;
  operaciones: number;
  monto: number;
}

/** El producto ya no está en el catálogo (se borró): la plata cuenta, el nombre no existe. */
export const SIN_PRODUCTO = "__sin_producto__";

const unidadesDe = (c: CreditoDeProducto) => Math.max(1, c.producto_cantidad ?? 1);
const pct = (parte: number, total: number) => (total > 0 ? round2((parte / total) * 100) : 0);

/** Los créditos de producto del período que cuentan como venta. */
export function ventasDelPeriodo(creditos: CreditoDeProducto[], desde: Date, hasta: Date): CreditoDeProducto[] {
  return creditos.filter((c) => esOperacionColocada(c) && c.fecha_inicio >= desde && c.fecha_inicio <= hasta);
}

export function resumenProductos(ventas: CreditoDeProducto[]): ResumenProductos {
  const unidades = ventas.reduce((s, c) => s + unidadesDe(c), 0);
  const financiado = round2(ventas.reduce((s, c) => s + c.monto_original, 0));
  const operaciones = ventas.length;
  const distintos = new Set(ventas.map((c) => c.producto_id ?? SIN_PRODUCTO));
  return {
    unidades,
    financiado,
    operaciones,
    ticket_operacion: operaciones > 0 ? round2(financiado / operaciones) : 0,
    precio_unidad: unidades > 0 ? round2(financiado / unidades) : 0,
    productos_distintos: distintos.size,
  };
}

/**
 * El ranking. Viene ordenado por PLATA, pero la pantalla puede ordenarlo por unidades: casi
 * nunca son el mismo producto —el ventilador vende cuarenta y la heladera tres, y la heladera
 * deja seis veces más capital colocado— y mostrar un solo orden esconde la mitad del negocio.
 */
export function rankingProductos(ventas: CreditoDeProducto[]): FilaProductoVendido[] {
  const totalMonto = ventas.reduce((s, c) => s + c.monto_original, 0);
  const totalUnidades = ventas.reduce((s, c) => s + unidadesDe(c), 0);

  const mapa = new Map<string, FilaProductoVendido>();
  for (const c of ventas) {
    const id = c.producto_id ?? SIN_PRODUCTO;
    const fila = mapa.get(id) ?? {
      producto_id: id,
      nombre: c.producto?.nombre ?? "Producto eliminado del catálogo",
      categoria: c.producto?.categoria ?? null,
      sku: c.producto?.sku ?? null,
      unidades: 0, operaciones: 0, monto: 0, ticket_promedio: 0,
      pct_monto: 0, pct_unidades: 0, ultima_venta: null,
    };
    fila.unidades += unidadesDe(c);
    fila.operaciones += 1;
    fila.monto = round2(fila.monto + c.monto_original);
    const dia = c.fecha_inicio.toISOString().slice(0, 10);
    if (!fila.ultima_venta || dia > fila.ultima_venta) fila.ultima_venta = dia;
    mapa.set(id, fila);
  }

  return [...mapa.values()]
    .map((f) => ({
      ...f,
      ticket_promedio: f.operaciones > 0 ? round2(f.monto / f.operaciones) : 0,
      pct_monto: pct(f.monto, totalMonto),
      pct_unidades: pct(f.unidades, totalUnidades),
    }))
    .sort((a, b) => b.monto - a.monto);
}

/** Qué rubro mueve el negocio. Sin categoría cargada, el producto cae en "Sin categoría". */
export function ventasPorCategoria(ventas: CreditoDeProducto[]): FilaCategoria[] {
  const totalMonto = ventas.reduce((s, c) => s + c.monto_original, 0);
  const mapa = new Map<string, FilaCategoria>();
  for (const c of ventas) {
    const cat = (c.producto?.categoria ?? "").trim() || "Sin categoría";
    const fila = mapa.get(cat) ?? { categoria: cat, unidades: 0, operaciones: 0, monto: 0, pct_monto: 0 };
    fila.unidades += unidadesDe(c);
    fila.operaciones += 1;
    fila.monto = round2(fila.monto + c.monto_original);
    mapa.set(cat, fila);
  }
  return [...mapa.values()]
    .map((f) => ({ ...f, pct_monto: pct(f.monto, totalMonto) }))
    .sort((a, b) => b.monto - a.monto);
}

/**
 * Mes a mes. Se devuelven TODOS los meses del rango, incluso los que no tuvieron ventas: un
 * mes que falta en el eje no se lee como "no se vendió nada", se lee como que no pasó.
 */
export function serieProductos(ventas: CreditoDeProducto[], desde: Date, hasta: Date): PuntoProductosMes[] {
  const meses: PuntoProductosMes[] = [];
  const cursor = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
  const fin = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), 1));
  while (cursor <= fin && meses.length < 60) {
    meses.push({ mes: cursor.toISOString().slice(0, 7), unidades: 0, operaciones: 0, monto: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const porMes = new Map(meses.map((m) => [m.mes, m]));
  for (const c of ventas) {
    const punto = porMes.get(c.fecha_inicio.toISOString().slice(0, 7));
    if (!punto) continue;
    punto.unidades += unidadesDe(c);
    punto.operaciones += 1;
    punto.monto = round2(punto.monto + c.monto_original);
  }
  return meses;
}
