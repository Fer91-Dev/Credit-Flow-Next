import { prisma } from "@/lib/prisma";
import { PLATAFORMA_TENANT_ID } from "@/lib/saas-owner";

export type BrandingPublico = { nombre: string | null; logo_url: string | null };

/**
 * Branding PÚBLICO (pre-login) de la financiera del despliegue: SOLO nombre + logo, nada
 * sensible. Single-tenant: la financiera activa más antigua. Se usa server-side (layout de
 * `/auth`) para que el logo venga ya en el HTML inicial (sin parpadeo CreditFlow→financiera).
 */
export async function getBrandingPublico(): Promise<BrandingPublico> {
  const t = await prisma.tenants.findFirst({
    // Excluye el tenant de sistema (plataforma): nunca debe mostrarse como financiera pre-login.
    where: { activo: true, id: { not: PLATAFORMA_TENANT_ID } },
    orderBy: { created_at: "asc" },
    select: { nombre: true, logo_url: true },
  });
  return { nombre: t?.nombre ?? null, logo_url: t?.logo_url ?? null };
}
