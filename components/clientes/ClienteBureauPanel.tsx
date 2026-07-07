"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, Search } from "lucide-react";
import { useHasFeature } from "@/components/providers/FeaturesProvider";
import { useToast } from "@/components/ui/toast";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { formatFechaHora, formatMonto } from "@/lib/utils";

interface Consulta {
  id: string;
  proveedor: string;
  created_at: string;
  ok: boolean;
  mensaje: string | null;
  situacion_bcra: number | null;
  score_externo: number | null;
  cheques_rechazados: number | null;
  deuda_sistema: number | null;
}

const SIT_BCRA_LABEL: Record<number, string> = {
  1: "Normal", 2: "Riesgo bajo", 3: "Con problemas", 4: "Riesgo alto", 5: "Irrecuperable", 6: "Irrecuperable (téc.)",
};
function sitVariant(s: number | null): BadgeVariant {
  if (s == null) return "muted";
  if (s <= 1) return "success";
  if (s === 2) return "warning";
  return "destructive";
}
const PROVEEDOR_LABEL: Record<string, string> = { bcra: "BCRA", nosis: "Nosis", veraz: "Veraz", manual: "Manual" };

/**
 * Perfil crediticio del cliente vía bureau (feature premium). Muestra la última consulta y
 * permite lanzar una nueva (BCRA real; Nosis/Veraz stubs; manual). Se auto-oculta si el
 * tenant no tiene la feature.
 */
export function ClienteBureauPanel({ clienteId }: { clienteId: string }) {
  const tiene = useHasFeature("bureau_credito");
  const toast = useToast();
  const [ultima, setUltima] = useState<Consulta | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ situacionBcra: "", scoreExterno: "", chequesRechazados: "", deudaSistemaFinanciero: "" });

  useEffect(() => {
    if (!tiene) return;
    let cancel = false;
    fetch(`/api/clientes/${clienteId}/bureau`)
      .then((r) => r.json())
      .then((j) => { if (!cancel && j.ok) setUltima(j.data.ultima); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [tiene, clienteId]);

  if (!tiene) return null;

  const consultar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/bureau`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const j = await res.json();
      if (j.ok) {
        setUltima(j.data.consulta);
        if (j.data.resultado.ok) toast.success("Consulta al bureau realizada");
        else toast.error(j.data.resultado.mensaje || "El bureau no devolvió datos");
      } else {
        toast.error(j.error || "No se pudo consultar");
      }
    } catch {
      toast.error("Error al consultar el bureau");
    } finally {
      setLoading(false);
    }
  };

  const guardarManual = async () => {
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    setLoading(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/bureau`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor: "manual",
          senalesManual: {
            situacionBcra: num(manual.situacionBcra),
            scoreExterno: num(manual.scoreExterno),
            chequesRechazados: num(manual.chequesRechazados),
            deudaSistemaFinanciero: num(manual.deudaSistemaFinanciero),
          },
        }),
      });
      const j = await res.json();
      if (j.ok) { setUltima(j.data.consulta); setManualOpen(false); toast.success("Señales cargadas manualmente"); }
      else toast.error(j.error || "No se pudo guardar");
    } catch {
      toast.error("Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Perfil crediticio (bureau)</h3>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {ultima
              ? <>Última consulta: <span className="font-medium text-foreground">{PROVEEDOR_LABEL[ultima.proveedor] ?? ultima.proveedor}</span> · {formatFechaHora(ultima.created_at)}</>
              : "Sin consultas registradas para este cliente."}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setManualOpen((o) => !o)}
              disabled={loading}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Cargar manual
            </button>
            <button
              onClick={consultar}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/25 transition-colors hover:bg-primary/15 disabled:opacity-50"
            >
              {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {loading ? "Consultando…" : "Consultar bureau"}
            </button>
          </div>
        </div>

        {manualOpen && (
          <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">Cargá las señales a mano (dejá vacío lo que no tengas).</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-[11px] text-muted-foreground">Situación BCRA
                <select value={manual.situacionBcra} onChange={(e) => setManual((m) => ({ ...m, situacionBcra: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-input px-2 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none focus:border-primary">
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-muted-foreground">Score (0–1000)
                <input type="number" min="0" max="1000" value={manual.scoreExterno} onChange={(e) => setManual((m) => ({ ...m, scoreExterno: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-input px-2 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none focus:border-primary" />
              </label>
              <label className="text-[11px] text-muted-foreground">Cheques rech.
                <input type="number" min="0" value={manual.chequesRechazados} onChange={(e) => setManual((m) => ({ ...m, chequesRechazados: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-input px-2 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none focus:border-primary" />
              </label>
              <label className="text-[11px] text-muted-foreground">Deuda sistema ($)
                <input type="number" min="0" value={manual.deudaSistemaFinanciero} onChange={(e) => setManual((m) => ({ ...m, deudaSistemaFinanciero: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-input px-2 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none focus:border-primary" />
              </label>
            </div>
            <div className="mt-2 flex justify-end">
              <button onClick={guardarManual} disabled={loading}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                Guardar señales
              </button>
            </div>
          </div>
        )}

        {ultima && (
          <>
            {ultima.mensaje && <p className="mt-3 text-xs text-muted-foreground/80">{ultima.mensaje}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Dato label="Situación BCRA">
                {ultima.situacion_bcra != null
                  ? <StatusBadge label={`${ultima.situacion_bcra} — ${SIT_BCRA_LABEL[ultima.situacion_bcra] ?? ""}`} variant={sitVariant(ultima.situacion_bcra)} />
                  : <span className="text-muted-foreground">—</span>}
              </Dato>
              <Dato label="Score externo">
                <span className="font-mono font-semibold text-foreground">{ultima.score_externo ?? "—"}</span>
              </Dato>
              <Dato label="Cheques rech.">
                <span className={`font-mono font-semibold ${(ultima.cheques_rechazados ?? 0) > 0 ? "text-destructive" : "text-foreground"}`}>{ultima.cheques_rechazados ?? "—"}</span>
              </Dato>
              <Dato label="Deuda sistema">
                <span className="font-mono font-semibold text-foreground">{ultima.deuda_sistema != null ? formatMonto(ultima.deuda_sistema) : "—"}</span>
              </Dato>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/30 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}
