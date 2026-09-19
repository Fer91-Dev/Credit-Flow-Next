"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
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
    // La misma card del resto de la ficha (borde, luz cenital, sombra). Fernando (18/09/2026):
    // "a la parte de observaciones mejorale el front".
    <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_30px_-16px_rgba(0,0,0,0.7)] sm:p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-transparent" />

      {/* Alta: un renglón propio, en su panel hundido. La fecha primero, porque es la
          decisión que hay que tomar; el texto ocupa lo que sobra; Agregar sólido. */}
      <div className="relative rounded-xl border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <label className="flex shrink-0 flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">Fecha</span>
            <input
              type="date"
              value={fecha}
              max={hoyISO}
              onChange={(e) => setFecha(e.target.value)}
              className="h-10 rounded-lg border border-border bg-input px-3 text-sm tabular-nums text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">Observación</span>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Qué pasó con este cliente"
              className="w-full resize-y rounded-lg border border-border bg-input px-3 py-2 text-sm leading-snug text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all placeholder:text-muted-foreground/40 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <button
            type="button"
            onClick={guardar}
            disabled={!texto.trim() || guardando}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-colors hover:bg-primary/90 disabled:opacity-40 sm:mt-[21px]"
          >
            <Plus className="h-4 w-4" /> {guardando ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </div>

      {/* Lista: una línea de tiempo. Fecha en píldora mono, quién la escribió al lado, el
          texto con la letra de la ficha, y el tacho siempre a la vista (apagado). */}
      <div className="relative mt-4">
        {isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
        ) : observaciones.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-7 text-center">
            <Emoji name="clipboard" className="h-8 w-8 opacity-40" />
            <p className="text-sm text-muted-foreground">Sin observaciones</p>
            <p className="text-xs text-muted-foreground/60">Lo que no entra en ningún campo se anota acá, con su fecha.</p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
              {observaciones.length} observaci{observaciones.length === 1 ? "ón" : "ones"} · la más reciente primero
            </p>
            <ul className="space-y-2">
              {observaciones.map((o) => (
                <li key={o.id} className="group flex items-start gap-3 rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/20">
                  <span className="mt-0.5 inline-flex shrink-0 items-center rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-primary ring-1 ring-inset ring-primary/20">
                    {formatFecha(o.fecha)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-sm leading-snug text-foreground">{o.texto}</p>
                    {o.autor_nombre && (
                      <p className="mt-1 text-xs text-muted-foreground/70">
                        <span className="text-muted-foreground/50">anotó</span> {o.autor_nombre}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => borrar(o.id)}
                    aria-label="Eliminar la observación"
                    title="Eliminar la observación"
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
