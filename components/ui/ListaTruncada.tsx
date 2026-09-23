"use client";

import { Emoji } from "@/components/ui/Emoji";

/**
 * AVISO DE QUE LA LISTA NO ESTÁ ENTERA.
 *
 * 🔴 POR QUÉ EXISTE. Las listas grandes se piden con un tope (créditos y clientes 1.000,
 * pagos 500) y hasta el 23/09/2026 el front ni siquiera leía el `total` que el endpoint ya
 * devolvía: pasado el registro 1.001 la pantalla mostraba una parte de la cartera y **nada lo
 * decía**. Una lista corta que se presenta como completa es peor que una pantalla lenta —
 * sobre ella se decide a quién visitar y a quién reclamarle.
 *
 * No propone nada que el operador no pueda hacer: dice cuántos se están viendo, cuántos hay,
 * y con qué acotar. Si `total` no supera a `mostrados`, no se renderiza nada.
 */
export function ListaTruncada({
  mostrados,
  total,
  /** Plural del sustantivo: "créditos", "clientes", "pagos". */
  sustantivo,
  /** Una línea extra cuando algo de la pantalla SÍ mira el total (ej. los KPI de Cobranzas). */
  nota,
}: {
  mostrados: number;
  total: number;
  sustantivo: string;
  nota?: string;
}) {
  if (total <= mostrados) return null;
  const n = (x: number) => x.toLocaleString("es-AR");
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2 text-xs text-foreground"
    >
      <Emoji name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        <span className="font-semibold">
          Se están viendo {n(mostrados)} de {n(total)} {sustantivo}.
        </span>{" "}
        <span className="text-muted-foreground">
          El resto queda afuera de la lista y de lo que se seleccione desde acá; buscá o filtrá para llegar a ellos.
          {nota ? ` ${nota}` : ""}
        </span>
      </p>
    </div>
  );
}
