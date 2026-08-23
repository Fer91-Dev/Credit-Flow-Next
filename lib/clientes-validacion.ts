import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { errorResponse } from "@/app/lib/api";
import { nombreCompleto } from "@/lib/utils";
import { normalizarEstadoCliente } from "@/lib/domain";

/** Normaliza el CUIT/CUIL a solo dígitos (para unicidad y comparación). null si vacío. */
export function normalizarCuit(v: unknown): string | null {
  if (v == null) return null;
  const digits = String(v).replace(/\D/g, "");
  return digits.length ? digits : null;
}

/**
 * Valida la unicidad de un cliente al crear/editar:
 *  - El CUIT/CUIL es el identificador ÚNICO (no puede repetirse).
 *  - El DNI puede repetirse SOLO si el CUIT lo diferencia (caso real en AR). Si el
 *    DNI ya existe y no se cargó CUIT, se pide el CUIT.
 * Devuelve una Response de error si hay conflicto, o null si está OK.
 * `excluirId` evita marcar al propio cliente en edición.
 */
export async function validarDuplicadoCliente(
  tenantId: string,
  documento: string | null,
  cuit: string | null,
  excluirId: string | null,
): Promise<Response | null> {
  const base: Record<string, unknown> = { ...withTenant(tenantId) };
  if (excluirId) base.id = { not: excluirId };

  // CUIT siempre único.
  if (cuit) {
    const cuitDup = await prisma.clientes.findFirst({
      where: { ...base, cuit_cuil: cuit },
      select: { id: true, nombre: true, apellido: true },
    });
    if (cuitDup) {
      return errorResponse(`Ya existe un cliente con el CUIT ${cuit} (${nombreCompleto(cuitDup)}).`, "DUPLICATE_CUIT", 409);
    }
  }

  // DNI repetido sin CUIT → pedir CUIT para diferenciar.
  if (documento) {
    const dniDup = await prisma.clientes.findFirst({
      where: { ...base, documento },
      select: { id: true, nombre: true, apellido: true, estado: true },
    });
    if (dniDup && !cuit) {
      /**
       * El ESTADO del homónimo va en el mensaje. Sin él, alguien que no encuentra a un
       * cliente fallecido o dado de baja intenta crearlo de nuevo y recibe un "ya existe"
       * que no explica por qué no lo veía. El dato que falta es justamente ese.
       */
      const estado = normalizarEstadoCliente(dniDup.estado);
      const porque =
        estado === "fallecido" ? " Figura como FALLECIDA/O, por eso no aparece al otorgar un crédito."
        : estado === "inactivo" ? " Está dado de baja, por eso no aparece al otorgar un crédito."
        : "";
      return errorResponse(
        `Ya existe un cliente con el DNI ${documento} (${nombreCompleto(dniDup)}).${porque} Si es OTRA persona con el mismo DNI, ingresá el CUIT para diferenciarla.`,
        "DNI_DUP_NEEDS_CUIT",
        409,
      );
    }
  }

  return null;
}
