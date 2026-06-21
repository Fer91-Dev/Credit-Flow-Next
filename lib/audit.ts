/**
 * Traza de auditoría — registro de eventos de negocio por tenant.
 *
 * Regla clave: la auditoría NUNCA debe romper la operación principal. Si la
 * escritura del log falla, se traga el error (se loguea en consola) y la
 * mutación sigue su curso normal. Por eso cada llamada va envuelta en try/catch.
 */
import { prisma } from "@/lib/prisma";

export type AuditEntidad = "clientes" | "creditos" | "pagos" | "configuracion" | "caja" | "campana" | "vendedores" | "proveedores" | "usuarios";
export type AuditAccion =
  | "crear"
  | "actualizar"
  | "eliminar"
  | "cancelar"
  | "anular"
  | "registrar_pago"
  | "actualizar_config";

export interface AuditInput {
  tenantId: string;
  entidad: AuditEntidad;
  entidadId?: string | null;
  accion: AuditAccion;
  descripcion: string;
  meta?: Record<string, unknown>;
}

export async function registrarAuditoria(input: AuditInput): Promise<void> {
  try {
    await prisma.auditoria.create({
      data: {
        tenant_id: input.tenantId,
        entidad: input.entidad,
        entidad_id: input.entidadId ?? null,
        accion: input.accion,
        descripcion: input.descripcion,
        meta: input.meta === undefined ? undefined : (input.meta as object),
      },
    });
  } catch (err) {
    console.error("[auditoria] no se pudo registrar el evento:", err);
  }
}
