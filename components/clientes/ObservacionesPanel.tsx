"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useObservacionesCliente } from "@/lib/swr";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { formatFecha, hoyComercial } from "@/lib/utils";

/**
 * Observaciones libres sobre el cliente: lo que no entra en ningún campo y hace falta que
 * quede escrito ("se mudó a lo de la hermana", "trabaja de noche, llamar de mañana").
 *
 * 🔴 LA FECHA SE PIDE, no se asume. Es CUÁNDO PASÓ lo que se anota, no cuándo se cargó —
 * se anota el lunes algo que pasó el viernes. Por eso el campo viene con hoy puesto pero se
 * puede mover hacia atrás, y la lista se ordena por esa fecha. Futuro no se acepta: acá se
 * escribe lo que pasó; lo que va a pasar es el próximo contacto de la gestión de cobranza.
 */
export function ObservacionesPanel({ clienteId }: { clienteId: string }) {
  const { observaciones, isLoading, mutate } = useObservacionesCliente(clienteId);
  const toast = useToast();
  const confirm = useConfirm();

  const hoyISO = hoyComercial().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(hoyISO);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (!texto.trim() || guardando) return;
    setGuardando(true);
    try {
      const r = await fetch(`/api/clientes/${clienteId}/observaciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, texto: texto.trim() }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { toast.error(j?.error ?? "No se pudo guardar la observación."); return; }
      setTexto("");
      setFecha(hoyISO);
      await mutate();
      toast.success("Observación guardada");
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (id: string) => {
    if (!(await confirm({ title: "Eliminar la observación", description: "Queda registrada en la auditoría con su texto.", tone: "danger", confirmLabel: "Eliminar" }))) return;
    const r = await fetch(`/api/clientes/${clienteId}/observaciones?obsId=${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => null);
    if (!r.ok) { toast.error(j?.error ?? "No se pudo eliminar."); return; }
    await mutate();
    toast.success("Observación eliminada");
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Alta: la fecha primero, porque es la decisión que hay que tomar. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <label className="flex shrink-0 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fecha</span>
          <input
            type="date"
            value={fecha}
            max={hoyISO}
            onChange={(e) => setFecha(e.target.value)}
            className="h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Observación</span>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Qué pasó con este cliente"
            className="w-full resize-y rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all placeholder:text-muted-foreground/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <button
          type="button"
          onClick={guardar}
          disabled={!texto.trim() || guardando}
          className="mt-0 h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 sm:mt-[1.35rem]"
        >
          {guardando ? "Guardando…" : "Agregar"}
        </button>
      </div>

      {/* Lista */}
      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : observaciones.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-6 text-center">
            <Emoji name="clipboard" className="h-7 w-7 opacity-30" />
            <p className="text-xs text-muted-foreground">Sin observaciones</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {observaciones.map((o) => (
              <li key={o.id} className="group flex items-start gap-3 py-2.5">
                {/* La fecha, en mono y tabular, para que la columna se lea derecha. */}
                <span className="w-[5.5rem] shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatFecha(o.fecha)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">{o.texto}</p>
                  {o.autor_nombre && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">{o.autor_nombre}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => borrar(o.id)}
                  aria-label="Eliminar la observación"
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
