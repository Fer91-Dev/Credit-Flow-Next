"use client";

import { SWRConfig } from "swr";
import { apiFetcher } from "@/lib/swr";

/**
 * Configuración global de SWR para todo el grupo autenticado.
 *
 * - fetcher: desempaqueta el envelope { ok, data } y lanza en error.
 * - dedupingInterval: colapsa peticiones idénticas dentro de 30s (evita el
 *   doble fetch al navegar de ida y vuelta, y el doble de StrictMode en dev).
 * - keepPreviousData: al volver a una sección ya visitada, muestra los datos
 *   cacheados al instante mientras revalida en segundo plano.
 * - revalidateOnFocus: desactivado — es un panel operativo, no un feed.
 */
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiFetcher,
        dedupingInterval: 30_000,
        keepPreviousData: true,
        revalidateOnFocus: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
