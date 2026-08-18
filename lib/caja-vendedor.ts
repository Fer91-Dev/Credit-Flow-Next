import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { ApiError } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/audit";
import { saldosPorCuenta, totalesCaja, round2, esCuentaValida, CUENTA_LABEL, etiquetaCaja, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante, formatComprobante, type SerieComprobante } from "@/lib/comprobantes";
import { getDolarBlueVenta } from "@/lib/cotizacion";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import { assertFondosSuficientesTx } from "@/lib/caja-fondos";
import { getCobranzaConfig } from "@/lib/config";

/**
 * Caja de un vendedor: todos los movimientos cuyo `vendedor_id` apunta a él.
 * Con `vendedorId = null` devuelve la CAJA PRINCIPAL (movimientos sin vendedor), que es
 * de la que desembolsa el admin. Saldo = suma de los montos (ya firmados). Mismo shape
 * que /api/caja para reusar UI.
 */
export async function cajaDeVendedor(tenantId: string, vendedorId: string | null) {
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
  // Dólares (USD) aparte: el total es solo pesos; se valoriza al blue como referencia.
  const saldoTotal = round2(saldos.efectivo + saldos.banco);
  const saldoDolares = saldos.dolares;
  const dolarBlue = await getDolarBlueVenta();
  const valorizacionDolares = dolarBlue != null ? round2(saldoDolares * dolarBlue) : null;
  const tot = totalesCaja(saldoMovs);

  // Desglose por cuenta, con la MISMA forma que devuelve `/api/caja` — así la tarjeta
  // de saldo es un componente compartido y no dos diseños que se van separando.
  // La caja del vendedor no tiene filtro de fechas: su "período" es todo su historial,
  // por eso `anterior` da 0 y los ingresos/egresos son los acumulados.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const saldosDetalle = { efectivo: null, banco: null, dolares: null } as unknown as Record<
    "efectivo" | "banco" | "dolares",
    { saldo: number; anterior: number; ingresos: number; egresos: number }
  >;
  for (const cta of ["efectivo", "banco", "dolares"] as const) {
    saldosDetalle[cta] = { saldo: saldos[cta], anterior: 0, ingresos: 0, egresos: 0 };
  }
  for (const m of saldoMovs) {
    const cta = esCuentaValida(m.cuenta) ? m.cuenta : "efectivo";
    if (m.monto >= 0) saldosDetalle[cta].ingresos = r2(saldosDetalle[cta].ingresos + m.monto);
    else saldosDetalle[cta].egresos = r2(saldosDetalle[cta].egresos + Math.abs(m.monto));
  }
  for (const cta of ["efectivo", "banco", "dolares"] as const) {
    const d = saldosDetalle[cta];
    d.anterior = r2(d.saldo - (d.ingresos - d.egresos));
  }

  return {
    saldo_total: saldoTotal,
    saldo_dolares: saldoDolares,
    dolar_blue: dolarBlue,
    valorizacion_dolares: valorizacionDolares,
    saldos_por_cuenta: saldos,
    saldos_detalle: saldosDetalle,
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

  /**
   * 🔴 Las dos patas se escriben con el MISMO valor absoluto, así que cruzar monedas creaba
   * plata de la nada: una entrega de 100 desde `efectivo` (pesos) hacia `dolares` sacaba
   * $100 de la principal y ponía U$S 100 en la caja del vendedor. Con una rendición
   * dólares→dólares después, esos U$S 100 llegaban a la tesorería y `/api/caja` los
   * valorizaba al blue: el tenant inventó dólares al costo de cien pesos.
   *
   * La misma guarda ya existía en la transferencia interna del vendedor y en
   * `caja/transferencia` (que lo resuelve pidiendo `monto_destino`); acá faltaba.
   */
  if ((cuentaVendedor === "dolares") !== (cuentaPrincipal === "dolares")) {
    throw new ApiError(
      "No se puede mover plata entre una cuenta en pesos y una en dólares sin tipo de cambio: las dos cuentas tienen que ser de la misma moneda.",
      "MONEDA_CRUZADA",
      400,
    );
  }

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
    // La pata de la principal SIEMPRE nombra a la contraparte, aunque haya nota. Antes la
    // nota la reemplazaba y el asiento quedaba diciendo solo "Préstamo": en la campanita,
    // donde ahora se ve una sola línea por transferencia, no había forma de saber a quién
    // se le entregó.
    descPrincipal = note ? `Entrega a ${nombre} — ${note}` : `Entrega a ${nombre}`;
    origenVendedor = cajaPrincipalLbl; destinoVendedor = cajaVendedorLbl;
    origenPrincipal = cajaPrincipalLbl; destinoPrincipal = cajaVendedorLbl;
  } else {
    descVendedor = note || "Rendición a caja principal";
    descPrincipal = note ? `Rendición de ${nombre} — ${note}` : `Rendición de ${nombre}`;
    origenVendedor = cajaVendedorLbl; destinoVendedor = cajaPrincipalLbl;
    origenPrincipal = cajaVendedorLbl; destinoPrincipal = cajaPrincipalLbl;
  }

  // Cada pata (vendedor + principal) es un comprobante propio con su número único.
  const serie: SerieComprobante = accion === "entrega" ? "ENT" : "REN";
  const fecha = hoyComercial();
  const movVendedor = await prisma.$transaction(async (tx) => {
    // Fondos (anti-race): rendición sale de la caja del vendedor; entrega, de la principal.
    if (accion === "rendicion") {
      await assertFondosSuficientesTx(tx, {
        tenantId, vendedorId, cuenta: cuentaVendedor, monto: abs,
        mensaje: (disp) => `No podés rendir más de lo que tenés en ${CUENTA_LABEL[cuentaVendedor]} (disponible $${disp.toLocaleString("es-AR")}).`,
      });
    } else {
      await assertFondosSuficientesTx(tx, {
        tenantId, vendedorId: null, cuenta: cuentaPrincipal, monto: abs,
        mensaje: (disp) => `La caja principal no tiene saldo suficiente en ${CUENTA_LABEL[cuentaPrincipal]} (disponible $${disp.toLocaleString("es-AR")}).`,
      });
    }
    const mv = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: accion,
        monto: signoVendedor,
        cuenta: cuentaVendedor,
        vendedor_id: vendedorId,
        origen: origenVendedor,
        destino: destinoVendedor,
        serie,
        numero: await siguienteNumeroComprobante(tx, tenantId, serie),
        descripcion: descVendedor,
      },
    });
    await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: accion,
        monto: -signoVendedor,
        cuenta: cuentaPrincipal,
        vendedor_id: null, // pata de la caja principal
        origen: origenPrincipal,
        destino: destinoPrincipal,
        serie,
        numero: await siguienteNumeroComprobante(tx, tenantId, serie),
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

  /**
   * 🔴 Tope de gasto autoliquidable — cierra la puerta de atrás del arqueo.
   *
   * Todo el módulo de caja está armado sobre una regla: **el vendedor no puede resolver
   * solo un faltante de su caja** (declara el conteo, el admin concilia con motivo). El
   * gasto de texto libre y sin tope la esquivaba entera: registrando "combustible $80.000"
   * su saldo de sistema bajaba $80.000 y el arqueo del día cerraba cuadrado, sin quedar
   * nunca `pendiente` y con el faltante documentado como gasto operativo.
   *
   * Ahora el techo lo pone la financiera (`cobranza_config.tope_gasto_vendedor`), no el
   * vendedor. Arranca en 0 = no registra gastos por su cuenta, igual que
   * `quita_max_vendedor_pct`. Un admin siempre puede cargarlo desde la caja principal.
   */
  const { tope_gasto_vendedor: tope } = await getCobranzaConfig(tenantId);
  if (abs > tope) {
    throw new ApiError(
      tope === 0
        ? "No podés registrar gastos de tu caja por tu cuenta. Pedile a un administrador que lo cargue."
        : `El gasto máximo que podés registrar solo es de $${tope.toLocaleString("es-AR")}. Por encima de eso lo tiene que cargar un administrador.`,
      "GASTO_EXCEDIDO",
      403,
    );
  }

  const mov = await prisma.$transaction(async (tx) => {
    await assertFondosSuficientesTx(tx, {
      tenantId, vendedorId, cuenta, monto: abs,
      mensaje: (disp) => `No podés gastar más de lo que tenés en ${CUENTA_LABEL[cuenta]} (disponible $${disp.toLocaleString("es-AR")}).`,
    });
    const numero = await siguienteNumeroComprobante(tx, tenantId, "GAS");
    return tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha: hoyComercial(),
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

/**
 * Transferencia INTERNA entre cuentas de la caja del vendedor (efectivo/banco/dólares).
 * No afecta el total de su caja; solo mueve saldo de una cuenta a otra. Dos filas
 * (egreso/ingreso), cada una con su comprobante TRF.
 */
export async function registrarTransferenciaCajaVendedor(opts: {
  tenantId: string;
  vendedorId: string;
  origen: Cuenta;
  destino: Cuenta;
  monto: number;
  descripcion?: string;
}) {
  const { tenantId, vendedorId, origen, destino, descripcion } = opts;
  const abs = round2(Math.abs(opts.monto));
  if (origen === destino) {
    throw new ApiError("La cuenta de origen y destino deben ser distintas", "INVALID_INPUT", 400);
  }
  // Pesos↔dólares no es 1:1: requiere tipo de cambio. Hasta ese flujo, solo misma moneda.
  if ((origen === "dolares") !== (destino === "dolares")) {
    throw new ApiError("Las transferencias entre pesos y dólares requieren tipo de cambio. Por ahora solo se permite entre cuentas de la misma moneda.", "MONEDA_CRUZADA", 400);
  }

  const note = descripcion?.trim();
  const glosa = `Transferencia ${CUENTA_LABEL[origen]} → ${CUENTA_LABEL[destino]}${note ? ` · ${note}` : ""}`;
  const origenLbl = etiquetaCaja(true, origen);
  const destinoLbl = etiquetaCaja(true, destino);

  const fecha = hoyComercial();
  const movSalida = await prisma.$transaction(async (tx) => {
    await assertFondosSuficientesTx(tx, {
      tenantId, vendedorId, cuenta: origen, monto: abs,
      mensaje: (disp) => `No podés transferir más de lo que tenés en ${CUENTA_LABEL[origen]} (disponible $${disp.toLocaleString("es-AR")}).`,
    });
    const s = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: "transferencia",
        monto: -abs,
        cuenta: origen,
        vendedor_id: vendedorId,
        origen: origenLbl,
        destino: destinoLbl,
        serie: "TRF",
        numero: await siguienteNumeroComprobante(tx, tenantId, "TRF"),
        descripcion: glosa,
      },
    });
    await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: "transferencia",
        monto: abs,
        cuenta: destino,
        vendedor_id: vendedorId,
        origen: origenLbl,
        destino: destinoLbl,
        serie: "TRF",
        numero: await siguienteNumeroComprobante(tx, tenantId, "TRF"),
        descripcion: glosa,
      },
    });
    return s;
  });

  await registrarAuditoria({
    tenantId,
    entidad: "caja",
    entidadId: movSalida.id,
    accion: "crear",
    descripcion: `Transferencia interna de $${abs.toLocaleString("es-AR")} ${CUENTA_LABEL[origen]} → ${CUENTA_LABEL[destino]} — vendedor ${vendedorId}`,
    meta: { monto: abs, tipo: "transferencia", origen, destino, vendedor_id: vendedorId },
  });

  return movSalida;
}
