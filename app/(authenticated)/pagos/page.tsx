import { PagosTable } from "@/components/pagos/PagosTable";

/**
 * `?cliente=<id>` llega COMO PROP, resuelto en el servidor.
 *
 * 🔴 El componente lo leía de `window.location` dentro de un efecto, después de esperar la
 * lista de clientes: entrar desde el botón "Cobrar" mostraba el buscador unos segundos y
 * recién ahí saltaba a la ficha. Leyéndolo acá, el primer render del cliente ya es el
 * correcto — no hay pantalla intermedia que dibujar.
 */
export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const { cliente } = await searchParams;
  return <PagosTable clienteInicial={cliente ?? null} />;
}
