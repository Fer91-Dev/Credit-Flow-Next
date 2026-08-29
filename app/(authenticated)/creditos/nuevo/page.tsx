import { NuevoCreditoView } from "@/components/creditos/NuevoCreditoView";

/**
 * `?cliente=<id>` deja el cliente ya elegido en el simulador.
 *
 * Se entra desde la ficha de un cliente sin créditos activos ("Ofrecerle un crédito"): a quién
 * se le va a prestar ya está decidido, y hacerlo buscar de nuevo al mismo cliente es el paso
 * de más que se sacó de la terminal de cobro. Se resuelve en el servidor para que el primer
 * render del formulario ya lo tenga.
 */
export default async function NuevoCreditoPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const { cliente } = await searchParams;
  return <NuevoCreditoView clienteInicial={cliente ?? null} />;
}
