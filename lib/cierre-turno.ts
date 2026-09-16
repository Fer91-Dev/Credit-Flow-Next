/**
 * CIERRE DE TURNO — servidor. La cuenta la hace `lib/domain/cierre-turno.ts`; acá se lee
 * el libro, se arquea, se retira y se firma el acta en UNA transacción con candado sobre
 * la cuenta (como todo lo que toca la caja).
 *
 * Lo que Silvio hace con los billetes después del cierre es suyo: el sistema registra que
 * salieron (`cierre_turno`, serie CIE). En la caja de un agente el retiro es su rendición a
 * la principal (`rendicion`, serie REN), igual que si la hiciera a mano.
 */
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { ApiError } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/audit";
import { getAuditActor } from "@/lib/audit-context";
import { CUENTA_LABEL, etiquetaCaja, resumirTurno, evaluarCierre, formatPesos, round2, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { lockCuentaTx } from "@/lib/caja-fondos";
import { arqueoEnTx } from "@/lib/arqueo";
import { hoyComercial } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

const CUENTA_CIERRE: Cuenta = "efectivo";

/** La cuenta de los dólares dentro del acta (misma forma que las columnas de efectivo). */
export interface CierreDolares {
  abierto_desde: string | null;
  apertura: number; ingresos: number; egresos: number; sistema: number;
  fisico: number; diferencia: number; retiro: number; fondo: number;
  detalle: Record<string, { cantidad: number; monto: number }>;
  arqueo_id: string | null; retiro_id: string | null;
}

const usdTexto = (n: number) => `U$S ${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * El último cierre de esa caja que cerró ESA cuenta, o null si nunca se cerró. El acta es
 * una sola por cierre (fila `cuenta = "efectivo"`); los dólares viajan adentro, así que "el
 * último cierre de dólares" es el último que los incluyó. Banco no se cierra nunca.
 */
export async function ultimoCierre(tenantId: string, vendedorId: string | null, cuenta: Cuenta = CUENTA_CIERRE) {
  if (cuenta === "banco") return null;
  return prisma.cierres_turno.findFirst({
    where: { ...withTenant(tenantId), vendedor_id: vendedorId, cuenta: CUENTA_CIERRE, ...(cuenta === "dolares" ? { incluye_dolares: true } : {}) },
    orderBy: { created_at: "desc" },
  });
}

/**
 * El turno ABIERTO de una caja: desde el último cierre hasta ahora. Es lo que ve el modal
 * antes de contar, y la misma cuenta que después se congela en el acta.
 */
export async function turnoAbierto(tenantId: string, vendedorId: string | null) {
  const [previo, previoUsd, movs] = await Promise.all([
    ultimoCierre(tenantId, vendedorId, "efectivo"),
    ultimoCierre(tenantId, vendedorId, "dolares"),
    prisma.movimientos_caja.findMany({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId },
      select: { monto: true, tipo: true, cuenta: true, created_at: true },
    }),
  ]);
  const ahora = new Date();
  const porCuenta = (c: Cuenta) => movs.filter((m) => m.cuenta === c);
  const resumen = resumirTurno(porCuenta("efectivo"), previo?.created_at ?? null, ahora);
  const usd = resumirTurno(porCuenta("dolares"), previoUsd?.created_at ?? null, ahora);
  const banco = round2(porCuenta("banco").reduce((t, m) => t + m.monto, 0));
  return {
    cuenta: CUENTA_CIERRE,
    abierto_desde: previo?.created_at ?? null,
    fondo_anterior: previo?.fondo ?? null,
    ...resumen,
    // Dólares: solo si hay algo que contar (saldo o movimientos en el turno).
    dolares: usd.saldoSistema !== 0 || usd.cantidad > 0
      ? { abierto_desde: previoUsd?.created_at ?? null, ...usd }
      : null,
    posicion: { efectivo: resumen.saldoSistema, banco, dolares: usd.saldoSistema },
  };
}

export interface CerrarTurnoInput {
  tenantId: string;
  /** null = caja principal (solo admin). */
  vendedorId: string | null;
  contado: number;
  /** Lo que queda en la caja para el turno siguiente. */
  fondo: number;
  /** Dólares contados y fondo en U$S; se omite si la caja no tiene dólares. */
  dolares?: { contado: number; fondo: number } | null;
  observacion?: string;
}

export async function cerrarTurno(input: CerrarTurnoInput) {
  const { tenantId, vendedorId } = input;
  const cuenta = CUENTA_CIERRE;
  const actor = getAuditActor();
  const observacion = input.observacion?.trim() || null;
  const fecha = hoyComercial();
  const esVendedor = vendedorId !== null;
  const nombreCaja = esVendedor
    ? (await prisma.vendedores.findFirst({ where: { ...withTenant(tenantId), id: vendedorId }, select: { nombre: true } }))?.nombre ?? "agente"
    : null;

  /**
   * Una cuenta (efectivo o dólares): arqueo + retiro. Devuelve la cuenta del acta para esa
   * moneda. Se corre para efectivo siempre y para dólares si vinieron.
   */
  async function cerrarCuenta(
    tx: Prisma.TransactionClient, cuenta: Cuenta, contado: number, fondo: number, previoAt: Date | null, ahora: Date,
    movs: { monto: number; tipo: string; created_at: Date }[],
  ) {
    const resumen = resumirTurno(movs, previoAt, ahora);
    const ev = evaluarCierre(resumen.saldoSistema, contado, fondo);
    if (ev.error) throw new ApiError(`${cuenta === "dolares" ? "Dólares: " : ""}${ev.error}`, "INVALID_INPUT", 400);
    const sufijo = cuenta === "dolares" ? " (dólares)" : "";

    // 1) Arqueo: concilia la diferencia con un ajuste ARQ (o cuadra, y solo deja el acta).
    const arqueo = await arqueoEnTx(tx, {
      tenantId, vendedorId, cuenta, montoFisico: contado, modo: "auto",
      fecha, observacion: observacion ? `Cierre de turno · ${observacion}` : "Cierre de turno",
      nombreCaja, actor,
    });

    // 2) Retiro: lo contado menos el fondo. Después de esto la caja queda en `fondo`.
    let retiroId: string | null = null;
    if (ev.retiro > 0) {
      if (esVendedor) {
        // Rendición a la principal: dos patas, como en `registrarMovimientoCajaVendedor`.
        // Misma cuenta de los dos lados: nunca se cruza moneda.
        const cajaVend = `Caja de ${nombreCaja} (${CUENTA_LABEL[cuenta]})`;
        const cajaPpal = `Caja principal (${CUENTA_LABEL[cuenta]})`;
        const mv = await tx.movimientos_caja.create({
          data: {
            ...withTenant(tenantId), fecha, tipo: "rendicion", monto: -ev.retiro, cuenta, vendedor_id: vendedorId,
            origen: cajaVend, destino: cajaPpal, serie: "REN", numero: await siguienteNumeroComprobante(tx, tenantId, "REN"),
            descripcion: `Rendición por cierre de turno${sufijo}${observacion ? ` · ${observacion}` : ""}`,
          },
        });
        await tx.movimientos_caja.create({
          data: {
            ...withTenant(tenantId), fecha, tipo: "rendicion", monto: ev.retiro, cuenta, vendedor_id: null,
            origen: cajaVend, destino: cajaPpal, serie: "REN", numero: await siguienteNumeroComprobante(tx, tenantId, "REN"),
            descripcion: `Rendición de ${nombreCaja} por cierre de turno${sufijo}`,
          },
        });
        retiroId = mv.id;
      } else {
        const mv = await tx.movimientos_caja.create({
          data: {
            ...withTenant(tenantId), fecha, tipo: "cierre_turno", monto: -ev.retiro, cuenta, vendedor_id: null,
            origen: etiquetaCaja(false, cuenta), destino: "Retiro de cierre (titular)",
            serie: "CIE", numero: await siguienteNumeroComprobante(tx, tenantId, "CIE"),
            descripcion: `Retiro de cierre de turno${sufijo}${observacion ? ` · ${observacion}` : ""}`,
          },
        });
        retiroId = mv.id;
      }
    }
    return {
      apertura: resumen.apertura, ingresos: resumen.ingresos, egresos: resumen.egresos, sistema: resumen.saldoSistema,
      fisico: round2(contado), diferencia: ev.diferencia, retiro: ev.retiro, fondo: ev.fondo,
      detalle: resumen.detalle, arqueo_id: arqueo.id, retiro_id: retiroId,
    };
  }

  const cierre = await prisma.$transaction(async (tx) => {
    await lockCuentaTx(tx, tenantId, vendedorId, "efectivo");
    if (input.dolares) await lockCuentaTx(tx, tenantId, vendedorId, "dolares");
    const [previo, previoUsd] = await Promise.all([
      tx.cierres_turno.findFirst({ where: { ...withTenant(tenantId), vendedor_id: vendedorId, cuenta: "efectivo" }, orderBy: { created_at: "desc" } }),
      tx.cierres_turno.findFirst({ where: { ...withTenant(tenantId), vendedor_id: vendedorId, cuenta: "efectivo", incluye_dolares: true }, orderBy: { created_at: "desc" } }),
    ]);
    const movs = await tx.movimientos_caja.findMany({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId },
      select: { monto: true, tipo: true, cuenta: true, created_at: true },
    });
    const ahora = new Date();
    const porCuenta = (c: Cuenta) => movs.filter((m) => m.cuenta === c);

    const ef = await cerrarCuenta(tx, "efectivo", input.contado, input.fondo, previo?.created_at ?? null, ahora, porCuenta("efectivo"));
    const usd = input.dolares
      ? await cerrarCuenta(tx, "dolares", input.dolares.contado, input.dolares.fondo, previoUsd?.created_at ?? null, ahora, porCuenta("dolares"))
      : null;
    // Posición al cierre: lo que queda en cada cuenta después del retiro. Banco no se
    // cuenta ni se retira: es su saldo de sistema (se concilia aparte, contra el extracto).
    const posicion = {
      efectivo: ef.fondo,
      banco: round2(porCuenta("banco").reduce((t, m) => t + m.monto, 0)),
      dolares: usd ? usd.fondo : round2(porCuenta("dolares").reduce((t, m) => t + m.monto, 0)),
    };

    // 3) El acta, congelada.
    return tx.cierres_turno.create({
      data: {
        ...withTenant(tenantId),
        fecha, vendedor_id: vendedorId, cuenta: "efectivo",
        numero: await siguienteNumeroComprobante(tx, tenantId, "CIE"),
        abierto_desde: previo?.created_at ?? null,
        cerrado_at: ahora,
        saldo_apertura: ef.apertura,
        ingresos: ef.ingresos,
        egresos: ef.egresos,
        saldo_sistema: ef.sistema,
        saldo_fisico: ef.fisico,
        diferencia: ef.diferencia,
        retiro: ef.retiro,
        fondo: ef.fondo,
        detalle: ef.detalle,
        arqueo_id: ef.arqueo_id,
        retiro_id: ef.retiro_id,
        dolares: usd ? { abierto_desde: previoUsd?.created_at?.toISOString() ?? null, ...usd } : undefined,
        incluye_dolares: !!usd,
        posicion,
        observacion,
        cerrado_por: actor?.userId ?? null,
        cerrado_por_nombre: actor?.nombre ?? null,
      },
    });
  }, {
    // Es la transacción más larga del sistema (candado + arqueo + retiro en dos patas + tres
    // numeraciones + acta, por dos monedas): con la base a ~190 ms por consulta pasa los 5 s
    // por defecto y Prisma la cierra a la mitad. Es la acción de fin del día; puede tardar.
    timeout: 45_000,
    maxWait: 10_000,
  });

  const quien = esVendedor ? `caja de ${nombreCaja}` : "caja principal";
  await registrarAuditoria({
    tenantId, entidad: "caja", entidadId: cierre.id, accion: "crear",
    descripcion:
      `Cierre de turno (${quien}): apertura ${formatPesos(cierre.saldo_apertura)}, ingresos ${formatPesos(cierre.ingresos)}, ` +
      `egresos ${formatPesos(cierre.egresos)}, sistema ${formatPesos(cierre.saldo_sistema)}, contado ${formatPesos(cierre.saldo_fisico)}, ` +
      `diferencia ${formatPesos(cierre.diferencia)}, retiro ${formatPesos(cierre.retiro)}, queda ${formatPesos(cierre.fondo)}` +
      (cierre.incluye_dolares && cierre.dolares && typeof cierre.dolares === "object"
        ? ` · dólares: contado ${usdTexto((cierre.dolares as { fisico: number }).fisico)}, retiro ${usdTexto((cierre.dolares as { retiro: number }).retiro)}`
        : ""),
    meta: { tipo: "cierre_turno", vendedor_id: vendedorId, cuenta, arqueo_id: cierre.arqueo_id, retiro_id: cierre.retiro_id, numero: cierre.numero },
  });

  return cierre;
}

/**
 * PERÍODO CERRADO. Un movimiento con fecha anterior al último cierre de esa caja/cuenta
 * cambiaría un acta ya firmada. Devuelve la fecha del último cierre si `fecha` cae dentro
 * de un turno cerrado; null si está permitida.
 */
export async function turnoCerradoPara(tenantId: string, vendedorId: string | null, cuenta: Cuenta, fecha: Date): Promise<Date | null> {
  const previo = await ultimoCierre(tenantId, vendedorId, cuenta);
  if (!previo) return null;
  return fecha < previo.fecha ? previo.fecha : null;
}

/** Lanza 409 `TURNO_CERRADO` si la fecha cae en un turno ya cerrado (movimientos manuales). */
export async function assertTurnoAbierto(tenantId: string, vendedorId: string | null, cuenta: Cuenta, fecha: Date) {
  const cerrado = await turnoCerradoPara(tenantId, vendedorId, cuenta, fecha);
  if (cerrado) {
    const d = `${String(cerrado.getUTCDate()).padStart(2, "0")}/${String(cerrado.getUTCMonth() + 1).padStart(2, "0")}`;
    throw new ApiError(`El turno del ${d} ya está cerrado: registralo con la fecha de hoy.`, "TURNO_CERRADO", 409);
  }
}

export function serializarCierre(c: {
  id: string; created_at: Date; fecha: Date; vendedor_id: string | null; cuenta: string; numero: number;
  abierto_desde: Date | null; cerrado_at: Date; saldo_apertura: number; ingresos: number; egresos: number;
  saldo_sistema: number; saldo_fisico: number; diferencia: number; retiro: number; fondo: number;
  detalle: unknown; arqueo_id: string | null; retiro_id: string | null; observacion: string | null;
  dolares?: unknown; incluye_dolares?: boolean; posicion?: unknown;
  cerrado_por_nombre: string | null; vendedor?: { nombre: string } | null;
}) {
  return {
    id: c.id, numero: c.numero, comprobante: `CIE-${String(c.numero).padStart(6, "0")}`,
    fecha: c.fecha.toISOString().slice(0, 10), cerrado_at: c.cerrado_at.toISOString(), abierto_desde: c.abierto_desde?.toISOString() ?? null,
    vendedor_id: c.vendedor_id, vendedor_nombre: c.vendedor?.nombre ?? null, cuenta: c.cuenta,
    saldo_apertura: c.saldo_apertura, ingresos: c.ingresos, egresos: c.egresos, saldo_sistema: c.saldo_sistema,
    saldo_fisico: c.saldo_fisico, diferencia: c.diferencia, retiro: c.retiro, fondo: c.fondo,
    detalle: (c.detalle ?? {}) as Record<string, { cantidad: number; monto: number }>,
    arqueo_id: c.arqueo_id, retiro_id: c.retiro_id, observacion: c.observacion, cerrado_por_nombre: c.cerrado_por_nombre,
    dolares: (c.incluye_dolares && c.dolares && typeof c.dolares === "object" ? c.dolares : null) as CierreDolares | null,
    posicion: (c.posicion && typeof c.posicion === "object" ? c.posicion : null) as { efectivo: number; banco: number; dolares: number } | null,
  };
}

/**
 * Fecha con la que un hecho de negocio ENTRA A LA CAJA. Un cobro (o un crédito) puede
 * cargarse con fecha atrasada —la mora se calcula con la fecha real del pago—, pero si ese
 * día ya tiene el turno cerrado, el billete entró hoy: el movimiento de caja lleva la fecha
 * de hoy y el acta de ayer no cambia. Dentro de la transacción del hecho.
 */
export async function fechaDeCajaTx(
  tx: Prisma.TransactionClient, tenantId: string, vendedorId: string | null, cuenta: Cuenta, fecha: Date,
): Promise<Date> {
  const previo = await tx.cierres_turno.findFirst({
    where: { ...withTenant(tenantId), vendedor_id: vendedorId, cuenta },
    orderBy: { created_at: "desc" },
    select: { fecha: true },
  });
  return previo && fecha < previo.fecha ? hoyComercial() : fecha;
}
