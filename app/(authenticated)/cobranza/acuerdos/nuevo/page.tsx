import { NuevoAcuerdoView } from "@/components/cobranza/NuevoAcuerdoView";

/**
 * Armar un acuerdo de pago, a pantalla completa.
 *
 * `?credito=<id>` llega resuelto desde el servidor, igual que en `/pagos` y en el simulador:
 * el primer render ya es el formulario del crédito correcto, sin pasar por un estado vacío.
 *
 * Es una RUTA y no un modal porque la operación tiene tres bloques que se miran entre sí — la
 * deuda, los parámetros y el plan que resulta — y en un diálogo competían por el mismo scroll.
 */
export default async function NuevoAcuerdoPage({
  searchParams,
}: {
  searchParams: Promise<{ credito?: string }>;
}) {
  const { credito } = await searchParams;
  return <NuevoAcuerdoView creditoId={credito ?? null} />;
}
