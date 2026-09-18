import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { geocodificar } from "@/lib/geocoder";
import { getFinanciera } from "@/lib/financiera";

/**
 * UBICAR UN CLIENTE: geocodificar su domicilio y completar la zona de cobranza.
 *
 * Reglas (Fernando, 18/09/2026: "que la zona se cargue sola según el domicilio"):
 *  - El domicilio va al mapa; lo que vuelve (lat, lon, barrio) se guarda en la ficha.
 *  - Si la ficha NO tiene zona, se completa: con la zona que la financiera enseñó para ese
 *    barrio (`barrio_zona`) o, si no enseñó nada, con el barrio tal cual.
 *  - Si la ficha SÍ tiene zona (la escribió alguien), no se pisa. Y si ese barrio todavía no
 *    tiene equivalencia, se aprende: "este barrio es esta zona". Ver `aprenderZona`.
 *  - Si el mapa no encuentra el domicilio, queda `geo_estado` con el motivo y la zona como
 *    estaba. Nada de esto puede frenar un alta.
 */
export interface ResultadoUbicar {
  estado: "ok" | "sin_direccion" | "sin_resultado" | "error";
  detalle?: string;
  latitud?: number;
  longitud?: number;
  barrio?: string | null;
  /** La zona que quedó en la ficha después de ubicar. */
  zona?: string | null;
  /** true si la zona la completó el sistema en esta corrida. */
  zona_completada?: boolean;
}

export const normalizarBarrio = (b: string) => b.trim().toLowerCase();

export async function ubicarCliente(tenantId: string, clienteId: string): Promise<ResultadoUbicar> {
  const c = await prisma.clientes.findFirst({
    where: { ...withTenant(tenantId), id: clienteId },
    select: { direccion: true, localidad: true, provincia: true, zona: true },
  });
  if (!c) return { estado: "error", detalle: "El cliente no existe." };

  /**
   * 🔴 SIN LOCALIDAD, EL MAPA SE VA A CUALQUIER LADO. "Chacabuco 1502" a secas cayó en San
   * Telmo (Buenos Aires) en la primera pasada sobre dev (18/09/2026). Si la ficha no trae
   * localidad o provincia, se usan las de la financiera (Configuración → Financiera): una
   * financiera de Tucumán presta en Tucumán.
   */
  let { localidad, provincia } = c;
  if (!localidad?.trim() || !provincia?.trim()) {
    const fin = await getFinanciera(tenantId);
    localidad = localidad?.trim() || fin.localidad || null;
    provincia = provincia?.trim() || fin.provincia || null;
  }
  const r = await geocodificar({ direccion: c.direccion, localidad, provincia });
  const ahora = new Date();
  if (!r.ok) {
    // Sin dirección o sin resultado: lo que hubiera ubicado antes ya no vale (el domicilio
    // cambió o nunca fue encontrable) y se limpia. Con un ERROR del mapa (red, cuota) se
    // conserva lo anterior: no se sabe nada nuevo.
    await prisma.clientes.update({ where: { id: clienteId }, data: { geo_estado: r.motivo, geocodificado_en: ahora, ...(r.motivo !== "error" ? { latitud: null, longitud: null, barrio: null } : {}) } });
    return { estado: r.motivo, detalle: r.detalle, zona: c.zona };
  }

  const { lat, lon, barrio } = r.ubicacion;
  let zona = c.zona?.trim() || null;
  let completada = false;
  if (barrio) {
    const aprendida = await prisma.barrio_zona.findUnique({ where: { tenant_id_barrio: { tenant_id: tenantId, barrio: normalizarBarrio(barrio) } }, select: { zona: true } });
    if (!zona) { zona = aprendida?.zona ?? barrio; completada = true; }
    else if (!aprendida) await aprenderZona(tenantId, barrio, zona);
  }
  await prisma.clientes.update({
    where: { id: clienteId },
    data: { latitud: lat, longitud: lon, barrio, geo_estado: "ok", geocodificado_en: ahora, zona },
  });
  return { estado: "ok", latitud: lat, longitud: lon, barrio, zona, zona_completada: completada };
}

/**
 * "Este barrio es esta zona". Se llama cuando alguien escribe o corrige la zona de un cliente
 * que tiene barrio: a partir de ahí, todo cliente nuevo de ese barrio nace con esa zona.
 */
export async function aprenderZona(tenantId: string, barrio: string, zona: string): Promise<void> {
  const z = zona.trim();
  if (!z) return;
  await prisma.barrio_zona.upsert({
    where: { tenant_id_barrio: { tenant_id: tenantId, barrio: normalizarBarrio(barrio) } },
    create: { tenant_id: tenantId, barrio: normalizarBarrio(barrio), zona: z },
    update: { zona: z },
  });
}

/** ¿Cambió algo del domicilio? Solo entonces vale la pena volver al mapa. */
export function cambioDomicilio(antes: { direccion: string | null; localidad: string | null; provincia: string | null }, despues: Partial<Record<"direccion" | "localidad" | "provincia", unknown>>): boolean {
  return (["direccion", "localidad", "provincia"] as const).some((k) => k in despues && (despues[k] ?? null) !== (antes[k] ?? null));
}
