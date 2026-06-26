import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { registrarAuditoria } from "@/lib/audit";
import { saldosPorCuenta, totalesCaja, round2, CUENTA_LABEL, etiquetaCaja, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante, formatComprobante, type SerieComprobante } from "@/lib/comprobantes";
import { nombreCompleto } from "@/lib/utils";

/**
 * Caja personal de un vendedor: todos los movimientos cuyo `vendedor_id` apunta a él.
 * Saldo = suma de los montos (ya firmados). Mismo shape que /api/caja para reusar UI.
 */
export async function cajaDeVendedor(tenantId: string, vendedorId: string) {
  const [movimientos, saldoMovs] = await Promise.all([
    prisma.movimientos_caja.findMany({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId },
      include: { credito: { select: { numero: true, cliente: { select: { nombre: true, apellido: true } } } } },
      orderBy: [{ fecha: "desc" }, { created_at: "desc" }],
      take: 500,
    }),
    prisma.movimientos_caja.findMany({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId },
      select: { monto: true, cuenta: true },
    }),
  ]);

  const saldos = saldosPorCuenta(saldoMovs);
  const saldoTotal = round2(saldos.efectivo + saldos.banco + saldos.dolares);
  const tot = totalesCaja(saldoMovs);

  return {
    saldo_total: saldoTotal,
    saldos_por_cuenta: saldos,
    ingresos: tot.ingresos,
    egresos: tot.egresos,
    neto: tot.neto,
    movimientos: movimientos.map((m) => ({
      id: m.id,
      fecha: m.fecha,
      created_at: m.created_at,
      tipo: m.tipo,
      monto: m.monto,
      metodo: m.metodo,
      cuenta: m.cuenta,
      origen: m.origen,
      destino: m.destino,
      comprobante: formatComprobante(m.serie, m.numero),
      descripcion: m.descripcion,
      credito_numero: m.credito?.numero ?? null,
      cliente: m.credito?.cliente ? nombreCompleto(m.credito.cliente) : null,
    })),
  };
}

export type AccionCaja = "entrega" | "rendicion";

/**
 * Registra un movimiento entre la caja principal y la caja del vendedor como un
 * PAR de filas (mantiene el saldo total del tenant intacto; solo cambia de manos):
 *  - entrega:   +X a la caja del vendedor, −X a la principal.
 *  - rendición: −X a la caja del vendedor, +X a la principal.
 */
export async function registrarMovimientoCajaVendedor(opts: {
  tenantId: string;
  vendedorId: string;
  accion: AccionCaja;
  monto: number;
  cuentaVendedor: Cuenta;   // cuenta de la caja del vendedor (origen o destino según la acción)
  cuentaPrincipal: Cuenta;  // cuenta de la caja principal (origen o destino según la acción)
  descripcion?: string;
}) {
  const { tenantId, vendedorId, accion, monto, cuentaVendedor, cuentaPrincipal } = opts;
  const abs = round2(Math.abs(monto));
  const signoVendedor = accion === "entrega" ? abs : -abs; // entrega ingresa al vendedor; rendición egresa

  // Descripciones detalladas con el flujo origen → destino (una por cada pata).
  const vend = await prisma.vendedores.findFirst({ where: { ...withTenant(tenantId), id: vendedorId }, select: { nombre: true } });
  const nombre = vend?.nombre ?? "vendedor";
  const lp = CUENTA_LABEL[cuentaPrincipal];
  const lv = CUENTA_LABEL[cuentaVendedor];
  const note = opts.descripcion?.trim();
  const cajaPrincipalLbl = `Caja principal (${lp})`;
  const cajaVendedorLbl = `Caja de ${nombre} (${lv})`;
  let descVendedor: string;
  let descPrincipal: string;
  // origen/destino por pata (mismo flujo físico, distinto dueño de la fila).
  let origenVendedor: string, destinoVendedor: string, origenPrincipal: string, destinoPrincipal: string;
  if (accion === "entrega") {
    descVendedor = note || "Entrega recibida";
    descPrincipal = note || `Entrega a ${nombre}`;
    origenVendedor = cajaPrincipalLbl; destinoVendedor = cajaVendedorLbl;
    origenPrincipal = cajaPrincipalLbl; destinoPrincipal = cajaVendedorLbl;
  } else {
    descVendedor = note || "Rendición a caja principal";
    descPrincipal = note || `Rendición de ${nombre}`;
    origenVendedor = cajaVendedorLbl; destinoVendedor = cajaPrincipalLbl;
    origenPrincipal = cajaVendedorLbl; destinoPrincipal = cajaPrincipalLbl;
  }

  // Las 2 patas (vendedor + principal) comparten el mismo N° de comprobante.
  const serie: SerieComprobante = accion === "entrega" ? "ENT" : "REN";
  const movVendedor = await prisma.$transaction(async (tx) => {
    const numero = await siguienteNumeroComprobante(tx, tenantId, serie);
    const mv = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        tipo: accion,
        monto: signoVendedor,
        cuenta: cuentaVendedor,
        vendedor_id: vendedorId,
        origen: origenVendedor,
        destino: destinoVendedor,
        serie,
        numero,
        descripcion: descVendedor,
      },
    });
    await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        tipo: accion,
        monto: -signoVendedor,
        cuenta: cuentaPrincipal,
        vendedor_id: null, // pata de la caja principal
        origen: origenPrincipal,
        destino: destinoPrincipal,
        serie,
        numero,
        descripcion: descPrincipal,
      },
    });
    return mv;
  });

  await registrarAuditoria({
    tenantId,
    entidad: "caja",
    entidadId: movVendedor.id,
    accion: "crear",
    descripcion: `${accion === "entrega" ? "Entrega" : "Rendición"} de $${abs.toLocaleString("es-AR")} — principal ${cuentaPrincipal} ↔ vendedor ${cuentaVendedor} (${vendedorId})`,
    meta: { monto: abs, tipo: accion, cuenta_vendedor: cuentaVendedor, cuenta_principal: cuentaPrincipal, vendedor_id: vendedorId },
  });

  return movVendedor;
}

/**
 * Registra un GASTO (egreso) de la caja del vendedor: una sola fila (la plata sale
 * del sistema, no vuelve a la principal). Tipo "ajuste" con motivo obligatorio.
 */
export async function registrarGastoCajaVendedor(opts: {
  tenantId: string;
  vendedorId: string;
  monto: number;
  cuenta: Cuenta;
  descripcion: string;
}) {
  const { tenantId, vendedorId, cuenta } = opts;
  const abs = round2(Math.abs(opts.monto));
  const motivo = opts.descripcion.trim();

  const mov = await prisma.$transaction(async (tx) => {
    const numero = await siguienteNumeroComprobante(tx, tenantId, "GAS");
    return tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        tipo: "ajuste",
        monto: -abs, // egreso
        cuenta,
        vendedor_id: vendedorId,
        origen: etiquetaCaja(true, cuenta),
        destino: `Gasto · ${motivo}`,
        serie: "GAS",
        numero,
        descripcion: `Gasto: ${motivo}`,
      },
    });
  });

  await registrarAuditoria({
    tenantId,
    entidad: "caja",
    entidadId: mov.id,
    accion: "crear",
    descripcion: `Gasto de $${abs.toLocaleString("es-AR")} en ${cuenta} — vendedor ${vendedorId} — ${motivo}`,
    meta: { monto: -abs, tipo: "gasto", cuenta, vendedor_id: vendedorId },
  });

  return mov;
}
