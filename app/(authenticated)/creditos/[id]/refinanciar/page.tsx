import { RefinanciarView } from "@/components/creditos/RefinanciarView";

/**
 * Refinanciar un crédito, a pantalla completa.
 *
 * Es una RUTA y no un modal por dos razones. La primera: la operación se decide comparando la
 * deuda que se da de baja contra las cuotas que nacen, y en un diálogo los dos bloques
 * competían por el mismo scroll. La segunda: con URL propia, el bloqueo de cobro de la
 * terminal de Pagos ("este crédito ya no se cobra, hay que refinanciarlo") puede llevar
 * DIRECTO acá, en vez de dejar al operador buscando el crédito de nuevo en la lista.
 *
 * Mismo criterio que el simulador de crédito, el alta de acuerdos y el alta de campañas.
 */
export default async function RefinanciarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RefinanciarView creditoId={id} />;
}
