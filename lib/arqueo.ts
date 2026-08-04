/**
 * Arqueos de caja — capa de servidor (persistencia + reglas de quién puede qué).
 *
 * El dominio puro (`lib/domain/arqueo.ts`) decide si cuadra y en qué estado queda; acá se
 * asienta el acta, se crea el ajuste cuando corresponde y se audita.
 *
 * La regla que sostiene todo esto: **el vendedor declara, el admin concilia.** Ver el
 * comentario del modelo `arqueos_caja` en el esquema.
 */
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { ApiError } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/audit";
import { getAuditActor } from "@/lib/audit-context";
import {
  saldosPorCuenta,
  evaluarArqueo,
  etiquetaDiferencia,
  CUENTA_LABEL,
  etiquetaCaja,
  esCuentaValida,
  round2,
  type Cuenta,
  type ModoArqueo,
} from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { lockCuentaTx } from "@/lib/caja-fondos";
import { hoyComercial } from "@/lib/utils";

const money = (n: number) => `$${n.toLocaleString("es-AR")}`;

/** Saldo de SISTEMA de una cuenta, para la caja indicada (`vendedorId = null` → principal). */
export async function saldoSistemaDeCuenta(
  tenantId: string,
  vendedorId: string | null,
  cuenta: Cuenta,
): Promise<number> {
  const movs = await prisma.movimientos_caja.findMany({
    where: { ...withTenant(tenantId), vendedor_id: vendedorId },
    select: { monto: true, cuenta: true },
  });
  return saldosPorCuenta(movs)[cuenta];
}

export interface RegistrarArqueoInput {
  tenantId: string;
  /** Caja arqueada: null = principal (solo admin). */
  vendedorId: string | null;
  cuenta: Cuenta;
  montoFisico: number;
  /** `auto` (admin, ajusta ya) o `declarado` (vendedor, deja pendiente). */
  modo: ModoArqueo;
  observacion?: string;
  /** Fecha del conteo (día comercial). Default: hoy. */
  fecha?: Date;
}

/**
 * Registra un arqueo. Devuelve el acta y, si el modo es `auto` y hubo diferencia, también
 * el movimiento de ajuste que la cerró.
 *
 * El acta se escribe SIEMPRE, cuadre o no: es lo que permite probar que la caja se cerró.
 */
export async function registrarArqueo(input: RegistrarArqueoInput) {
  const { tenantId, vendedorId, cuenta, modo } = input;
  const fecha = input.fecha ?? hoyComercial();
  const observacion = input.observacion?.trim() || null;
  const actor = getAuditActor();

  const esVendedor = vendedorId !== null;
  const nombreCaja = esVendedor
    ? (await prisma.vendedores.findFirst({
        where: { ...withTenant(tenantId), id: vendedorId },
        select: { nombre: true },
      }))?.nombre ?? "vendedor"
    : null;

  const arqueo = await prisma.$transaction(async (tx) => {
    // Candado por (tenant, caja, cuenta) ANTES de leer, igual que toda operación de caja.
    // Leer dentro de la transacción no alcanza: sin el candado, un cobro puede commitear
    // entre la lectura y el asiento, y el ajuste queda cuadrando contra un saldo viejo —
    // el arqueo diría que la caja quedó en lo contado, y no. Con el lock, nadie más toca
    // esa cuenta hasta que este arqueo termina.
    await lockCuentaTx(tx, tenantId, vendedorId, cuenta);
    const movs = await tx.movimientos_caja.findMany({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId },
      select: { monto: true, cuenta: true },
    });
    const sistema = saldosPorCuenta(movs)[cuenta];
    const r = evaluarArqueo(sistema, input.montoFisico, modo);

    let ajusteId: string | null = null;
    if (r.requiereAjuste) {
      const numero = await siguienteNumeroComprobante(tx, tenantId, "ARQ");
      const etiquetaMiCaja = esVendedor
        ? `Caja de ${nombreCaja} (${CUENTA_LABEL[cuenta]})`
        : etiquetaCaja(false, cuenta);
      const mov = await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha,
          tipo: "ajuste",
          monto: r.diferencia, // ya viene con signo
          cuenta,
          vendedor_id: vendedorId,
          origen: r.diferencia > 0 ? "Arqueo (sobrante)" : etiquetaMiCaja,
          destino: r.diferencia > 0 ? etiquetaMiCaja : "Arqueo (faltante)",
          serie: "ARQ",
          numero,
          descripcion:
            `Arqueo ${CUENTA_LABEL[cuenta]}: conciliación de ${r.diferencia > 0 ? "sobrante" : "faltante"}` +
            (observacion ? ` · ${observacion}` : ""),
        },
      });
      ajusteId = mov.id;
    }

    return tx.arqueos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        vendedor_id: vendedorId,
        cuenta,
        saldo_sistema: r.sistema,
        saldo_fisico: r.fisico,
        diferencia: r.diferencia,
        estado: r.estado,
        observacion,
        ajuste_id: ajusteId,
        creado_por: actor?.userId ?? null,
        creado_por_nombre: actor?.nombre ?? null,
        // Un arqueo `auto` con diferencia se concilia solo, en el mismo acto.
        ...(r.requiereAjuste
          ? {
              resuelto_por: actor?.userId ?? null,
              resuelto_por_nombre: actor?.nombre ?? null,
              resuelto_at: new Date(),
            }
          : {}),
      },
    });
  });

  const quien = esVendedor ? `caja de ${nombreCaja}` : "caja principal";
  await registrarAuditoria({
    tenantId,
    entidad: "caja",
    entidadId: arqueo.id,
    accion: "crear",
    descripcion:
      `Arqueo de ${CUENTA_LABEL[cuenta]} (${quien}): sistema ${money(arqueo.saldo_sistema)} vs ` +
      `físico ${money(arqueo.saldo_fisico)} — ${etiquetaDiferencia(arqueo.diferencia)} ` +
      `${money(Math.abs(arqueo.diferencia))} [${arqueo.estado}]`,
    meta: {
      tipo: "arqueo",
      cuenta,
      vendedor_id: vendedorId,
      sistema: arqueo.saldo_sistema,
      fisico: arqueo.saldo_fisico,
      diferencia: arqueo.diferencia,
      estado: arqueo.estado,
      modo,
    },
  });

  return arqueo;
}

/**
 * Concilia un arqueo PENDIENTE (el que declaró un vendedor): crea el ajuste en SU caja y
 * cierra el acta. Solo admin — es justamente la decisión que el vendedor no puede tomar
 * sobre su propia caja.
 *
 * El motivo es obligatorio: un faltante que se ajusta sin explicación es plata que
 * desaparece del sistema sin dejar por qué.
 */
export async function conciliarArqueo(opts: {
  tenantId: string;
  arqueoId: string;
  nota: string;
}) {
  const { tenantId, arqueoId } = opts;
  const nota = opts.nota.trim();
  if (!nota) {
    throw new ApiError("Explicá por qué se ajusta la diferencia", "MOTIVO_REQUERIDO", 400);
  }
  const actor = getAuditActor();

  const arqueo = await prisma.$transaction(async (tx) => {
    const a = await tx.arqueos_caja.findFirst({ where: { ...withTenant(tenantId), id: arqueoId } });
    if (!a) throw new ApiError("El arqueo no existe", "NOT_FOUND", 404);
    if (a.estado !== "pendiente") {
      throw new ApiError(
        a.estado === "conciliado" ? "Ese arqueo ya fue conciliado" : "Ese arqueo cuadró: no hay nada que conciliar",
        "ARQUEO_NO_PENDIENTE",
        409,
      );
    }

    // El ajuste se calcula contra la diferencia DECLARADA, no contra el saldo de hoy: el
    // acta congela lo que se contó ese día. Si el vendedor siguió operando desde entonces,
    // recalcular contra el saldo actual borraría movimientos legítimos posteriores.
    const diferencia = round2(a.diferencia);
    const cuentaLock = (esCuentaValida(a.cuenta) ? a.cuenta : "efectivo") as Cuenta;
    // Mismo candado que el resto de la caja, para no insertar mientras otra operación
    // está calculando fondos sobre esta misma cuenta.
    await lockCuentaTx(tx, tenantId, a.vendedor_id, cuentaLock);

    // A propósito NO se valida saldo suficiente. Conciliar un faltante puede dejar la caja
    // en negativo si el vendedor ya rindió de más, y eso es exactamente lo que hay que
    // mostrar: debe esa plata. Bloquearlo sería peor — el faltante quedaría sin poder
    // resolverse nunca, que es el único estado del que hay que salir sí o sí.
    const vend = a.vendedor_id
      ? await tx.vendedores.findFirst({ where: { ...withTenant(tenantId), id: a.vendedor_id }, select: { nombre: true } })
      : null;
    const cuenta = cuentaLock;
    const etiquetaMiCaja = a.vendedor_id
      ? `Caja de ${vend?.nombre ?? "vendedor"} (${CUENTA_LABEL[cuenta] ?? cuenta})`
      : etiquetaCaja(false, cuenta);

    const numero = await siguienteNumeroComprobante(tx, tenantId, "ARQ");
    const mov = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha: hoyComercial(),
        tipo: "ajuste",
        monto: diferencia,
        cuenta,
        vendedor_id: a.vendedor_id,
        origen: diferencia > 0 ? "Arqueo (sobrante)" : etiquetaMiCaja,
        destino: diferencia > 0 ? etiquetaMiCaja : "Arqueo (faltante)",
        serie: "ARQ",
        numero,
        descripcion: `Arqueo ${CUENTA_LABEL[cuenta] ?? cuenta}: conciliación de ${diferencia > 0 ? "sobrante" : "faltante"} · ${nota}`,
      },
    });

    // `updateMany` con el tenant: un id de otra financiera no actualiza nada.
    await tx.arqueos_caja.updateMany({
      where: { ...withTenant(tenantId), id: arqueoId, estado: "pendiente" },
      data: {
        estado: "conciliado",
        ajuste_id: mov.id,
        resuelto_por: actor?.userId ?? null,
        resuelto_por_nombre: actor?.nombre ?? null,
        resuelto_at: new Date(),
        resolucion_nota: nota,
      },
    });

    return { ...a, ajuste_id: mov.id, estado: "conciliado" as const };
  });

  await registrarAuditoria({
    tenantId,
    entidad: "caja",
    entidadId: arqueo.id,
    accion: "actualizar",
    descripcion:
      `Conciliación de arqueo: ${etiquetaDiferencia(arqueo.diferencia)} de ` +
      `${money(Math.abs(arqueo.diferencia))} en ${CUENTA_LABEL[arqueo.cuenta as Cuenta] ?? arqueo.cuenta} · ${nota}`,
    meta: {
      tipo: "arqueo_conciliacion",
      arqueo_id: arqueo.id,
      diferencia: arqueo.diferencia,
      ajuste_id: arqueo.ajuste_id,
      vendedor_id: arqueo.vendedor_id,
      nota,
    },
  });

  return arqueo;
}

/** Forma con la que viajan los arqueos a la UI (misma para el admin y el vendedor). */
export function serializarArqueo(a: {
  id: string;
  created_at: Date;
  fecha: Date;
  vendedor_id: string | null;
  cuenta: string;
  saldo_sistema: number;
  saldo_fisico: number;
  diferencia: number;
  estado: string;
  observacion: string | null;
  ajuste_id: string | null;
  creado_por_nombre: string | null;
  resuelto_por_nombre: string | null;
  resuelto_at: Date | null;
  resolucion_nota: string | null;
  vendedor?: { nombre: string } | null;
}) {
  return {
    id: a.id,
    created_at: a.created_at,
    fecha: a.fecha,
    cuenta: a.cuenta,
    caja: a.vendedor?.nombre ? `Caja de ${a.vendedor.nombre}` : "Caja principal",
    vendedor_id: a.vendedor_id,
    sistema: a.saldo_sistema,
    fisico: a.saldo_fisico,
    diferencia: a.diferencia,
    estado: a.estado,
    observacion: a.observacion,
    ajuste_id: a.ajuste_id,
    creado_por: a.creado_por_nombre,
    resuelto_por: a.resuelto_por_nombre,
    resuelto_at: a.resuelto_at,
    resolucion_nota: a.resolucion_nota,
  };
}
