import { CreditoPagina } from "@/components/creditos/CreditoPagina";
import { requireAuth } from "@/lib/auth";

/**
 * Detalle de un crédito, con dirección propia.
 *
 * Hasta acá el detalle era un diálogo de la lista y un crédito no tenía a dónde enlazar: las
 * pantallas que lo nombran —refinanciar, la ficha del cliente, la comparación de una
 * refinanciación, el bloqueo de cobro— solo podían escribir el número y dejar al operador
 * buscarlo a mano en Créditos.
 *
 * El rol se resuelve en el servidor, igual que en el resto de las páginas: es el que decide
 * qué acciones ofrece el detalle (anular, eliminar, autorizar), y el anti-IDOR de verdad lo
 * hace la API.
 */
export default async function CreditoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role } = await requireAuth();
  return <CreditoPagina id={id} role={role} />;
}
