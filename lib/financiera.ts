/**
 * Datos/identidad de la financiera (tenant). Los edita el admin del tenant; alimentan el
 * co-branding (sidebar/Home/PDFs) y la facturación futura. `nombre` = nombre de fantasía.
 */
import { prisma } from "@/lib/prisma";

export interface FinancieraDatos {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  logo_url: string | null;
}

const SELECT = {
  nombre: true, razon_social: true, cuit: true, direccion: true, telefono: true, email: true, logo_url: true,
} as const;

export async function getFinanciera(tenantId: string): Promise<FinancieraDatos> {
  const t = await prisma.tenants.findUnique({ where: { id: tenantId }, select: SELECT });
  return {
    nombre: t?.nombre ?? "",
    razon_social: t?.razon_social ?? null,
    cuit: t?.cuit ?? null,
    direccion: t?.direccion ?? null,
    telefono: t?.telefono ?? null,
    email: t?.email ?? null,
    logo_url: t?.logo_url ?? null,
  };
}

/** Actualiza solo los campos presentes en `data`. `nombre` (si viene) no puede quedar vacío. */
export async function guardarFinanciera(tenantId: string, data: Partial<FinancieraDatos>): Promise<FinancieraDatos> {
  const upd: Record<string, string | null> = {};
  if (data.nombre !== undefined) upd.nombre = data.nombre.trim();
  const opcionales: (keyof FinancieraDatos)[] = ["razon_social", "cuit", "direccion", "telefono", "email", "logo_url"];
  for (const k of opcionales) {
    if (data[k] !== undefined) upd[k] = (data[k] as string | null)?.toString().trim() || null;
  }
  await prisma.tenants.update({ where: { id: tenantId }, data: upd });
  return getFinanciera(tenantId);
}
