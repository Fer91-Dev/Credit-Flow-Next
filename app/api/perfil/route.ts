import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { soloDigitos } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * PUT /api/perfil — datos personales del usuario en sesión.
 *
 * `profiles` es la **fuente de verdad** de estos campos: los edita cada uno acá y la
 * ficha de Agentes los muestra en solo lectura (se queda con lo laboral). Van en
 * `profiles` y no en `vendedores` porque no todo usuario tiene ficha de agente.
 *
 * `full_name` **no se recibe**: se RECALCULA como "nombre apellido". Así los ~42 usos
 * que lee (saludo del Home, actor de auditoría, listas, emails) siguen intactos.
 *
 * Email y contraseña NO pasan por acá: van directo a Supabase Auth desde el cliente.
 */

/** Campos de texto libre que se guardan tal cual (trim; vacío → null). */
const TEXTO = [
  "apellido", "direccion", "provincia", "localidad",
  "codigo_postal", "tipo_domicilio", "piso", "depto",
] as const;

function limpiar(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export const PUT = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { userId, tenantId } = await requireAuth(req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // El nombre es lo único obligatorio: de él sale el `full_name` que se muestra en
  // toda la app. Si quedara vacío, el usuario desaparecería de las listas.
  const nombre = limpiar(body.nombre);
  if (!nombre) {
    return errorResponse("El nombre no puede estar vacío", "INVALID_INPUT", 400);
  }

  const data: Record<string, string | Date | null> = { nombre };
  for (const campo of TEXTO) data[campo] = limpiar(body[campo]);

  // Celular: se guardan solo los dígitos (mismo criterio que clientes/agentes).
  const tel = limpiar(body.telefono);
  data.telefono = tel ? soloDigitos(tel, 20) : null;

  // Fecha de nacimiento: se acepta "AAAA-MM-DD" y se rechaza una fecha futura o
  // inválida (un nacimiento en el futuro es siempre un error de carga).
  const fnac = limpiar(body.fecha_nacimiento);
  if (fnac) {
    const d = new Date(`${fnac}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      return errorResponse("La fecha de nacimiento no es válida", "INVALID_INPUT", 400);
    }
    if (d.getTime() > Date.now()) {
      return errorResponse("La fecha de nacimiento no puede ser futura", "INVALID_INPUT", 400);
    }
    data.fecha_nacimiento = d;
  } else {
    data.fecha_nacimiento = null;
  }

  // `full_name` = nombre + apellido. Derivado, nunca recibido del cliente.
  data.full_name = [nombre, data.apellido].filter(Boolean).join(" ");

  await prisma.profiles.update({ where: { id: userId }, data });

  await registrarAuditoria({
    tenantId,
    entidad: "usuarios",
    entidadId: userId,
    accion: "actualizar",
    descripcion: "Usuario actualizó sus datos personales",
    meta: {},
  });

  return successResponse({ ok: true, full_name: data.full_name });
});
