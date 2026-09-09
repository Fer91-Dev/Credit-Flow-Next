/**
 * Traza de auditoría — registro de eventos de negocio por tenant.
 *
 * Regla clave: la auditoría NUNCA debe romper la operación principal. Si la
 * escritura del log falla, se traga el error (se loguea en consola) y la
 * mutación sigue su curso normal. Por eso cada llamada va envuelta en try/catch.
 */
import { prisma } from "@/lib/prisma";
import { getAuditActor } from "@/lib/audit-context";

export type AuditEntidad = "clientes" | "creditos" | "pagos" | "configuracion" | "caja" | "campana" | "vendedores" | "proveedores" | "productos" | "usuarios" | "plataforma" | "planilla";
export type AuditAccion =
  | "crear"
  | "actualizar"
  | "eliminar"
  | "cancelar"
  | "anular"
  | "refinanciar"
  | "registrar_pago"
  | "actualizar_config"
  // Contacto individual con un cliente (WhatsApp/email desde su ficha). Se audita SIEMPRE,
  // sea cual sea el motivo: es el registro de que a esa persona se la contactó y qué se le dijo.
  | "contactar"
  | "backup"
  // Alerta que asienta el cron, sin actor humano: algo que el sistema encontró roto y que
  // necesita que una persona decida (hoy, el crédito vivo que se quedó sin plan de cuotas).
  | "alerta_sin_plan"
  /**
   * Cierre de un caso incobrable: se cobró lo pactado y se condonó el resto. Acción propia y
   * no "cancelar" porque lo que hay que poder rastrear es la PLATA RESIGNADA — cuánto sugirió
   * el motor, cuánto se aceptó y quién firmó la diferencia.
   */
  | "cerrar_incobrable";

export interface AuditInput {
  tenantId: string;
  entidad: AuditEntidad;
  entidadId?: string | null;
  accion: AuditAccion;
  descripcion: string;
  meta?: Record<string, unknown>;
  /**
   * 🔴 EL VALOR ANTERIOR. (Hallazgo A5 de la auditoría financiera.)
   *
   * La auditoría guardaba `meta: updateData`, o sea SOLO los valores nuevos. Sobre una
   * mutación de plata eso no alcanza para contestar la única pregunta que importa después:
   * *"¿qué decía antes?"*. Un registro que dice "saldo: 0" sin decir de cuánto venía no
   * prueba nada — ni a favor ni en contra de quien lo hizo.
   *
   * Se pasan los dos objetos y el diff lo arma `registrarAuditoria`: así hay UNA
   * implementación y no una por endpoint, que es como se llega a que cuatro lo guarden y
   * veinte no. Solo viajan los campos que CAMBIARON, con su par `{antes, despues}`.
   *
   * 🔴 CAMPOS EXPLÍCITOS, NO LA FILA DE PRISMA. Pasar el registro entero mete adentro las
   * relaciones incluidas (`cliente`, `pagos`) y los snapshots JSON, así que el log termina
   * con la ficha completa del titular —datos personales— copiada en cada edición, y el
   * cambio real perdido en el medio. Se pasa el puñado de campos que la mutación puede tocar.
   */
  antes?: Record<string, unknown> | null;
  despues?: Record<string, unknown> | null;
}

/** Normaliza un valor para comparar y guardar: las fechas como ISO, el resto tal cual. */
function normalizar(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  return v;
}

/**
 * Compara dos valores POR CONTENIDO, no por identidad.
 *
 * Sin esto, todo campo JSON de la fila —`cargos`, `cronograma`, `riesgo_snapshot`— figuraba
 * como "cambiado" en cada edición aunque nadie lo hubiera tocado: dos objetos con el mismo
 * contenido nunca son `===`. El log quedaba lleno de copias del snapshot de riesgo y el
 * cambio real se perdía adentro.
 */
function igualPorValor(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Importes: tolerancia de un centavo, para que un redondeo del float no figure como cambio.
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" && typeof b === "object") {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

/**
 * Qué cambió entre dos versiones de un registro, campo por campo.
 *
 * Devuelve `undefined` si no cambió nada (para no ensuciar el `meta` con un objeto vacío).
 * Se recorren las claves de `despues` porque son las que la mutación tocó: incluir todo el
 * registro anterior llenaría el log de campos que nadie modificó.
 *
 * Exportada para poder usarla suelta donde el diff se arma antes de tener el resultado.
 */
export function diffAuditoria(
  antes: Record<string, unknown> | null | undefined,
  despues: Record<string, unknown> | null | undefined,
): Record<string, { antes: unknown; despues: unknown }> | undefined {
  if (!antes || !despues) return undefined;
  const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
  for (const campo of Object.keys(despues)) {
    const a = normalizar(antes[campo]);
    const b = normalizar(despues[campo]);
    if (igualPorValor(a, b)) continue;
    cambios[campo] = { antes: a ?? null, despues: b ?? null };
  }
  return Object.keys(cambios).length > 0 ? cambios : undefined;
}

export async function registrarAuditoria(input: AuditInput): Promise<void> {
  try {
    const actor = getAuditActor(); // quién ejecutó la acción (seteado en requireAuth)
    // El diff se arma acá y no en cada endpoint: una sola implementación, y así el `meta`
    // de toda mutación de plata tiene la misma forma (`cambios: { campo: {antes, despues} }`).
    const cambios = diffAuditoria(input.antes, input.despues);
    const metaFinal = cambios ? { ...(input.meta ?? {}), cambios } : input.meta;
    await prisma.auditoria.create({
      data: {
        tenant_id: input.tenantId,
        entidad: input.entidad,
        entidad_id: input.entidadId ?? null,
        accion: input.accion,
        descripcion: input.descripcion,
        meta: metaFinal === undefined ? undefined : (metaFinal as object),
        usuario_id: actor?.userId ?? null,
        usuario_nombre: actor?.nombre ?? null,
        usuario_email: actor?.email ?? null,
      },
    });
  } catch (err) {
    console.error("[auditoria] no se pudo registrar el evento:", err);
  }
}
