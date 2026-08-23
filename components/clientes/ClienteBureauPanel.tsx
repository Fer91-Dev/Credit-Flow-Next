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
  /** Respuesta cruda del proveedor. Trae el detalle por entidad que el resumen aplana. */
  crudo?: unknown;
}

/** Una línea del informe del BCRA: qué entidad, en qué situación y con qué banderas. */
interface EntidadBureau {
  entidad: string;
  situacion: number;
  monto: number;
  diasAtrasoPago?: number;
  refinanciaciones?: boolean;
  situacionJuridica?: boolean;
  procesoJud?: boolean;
  enRevision?: boolean;
}

/**
 * Historial de 24 meses: la PEOR situación informada en cada período.
 *
 * 🔴 Sin esto, alguien que estuvo siempre en situación 1 y alguien que estuvo en 4 hace
 * ocho meses y se recuperó se veían IDÉNTICOS — los dos muestran "1" en el mes actual. Es
 * justo la diferencia que uno quiere saber antes de prestar.
 */
function historialDe(crudo: unknown): Array<{ periodo: string; situacion: number }> {
  const periodos = (crudo as { historicas?: { results?: { periodos?: unknown[] } } } | null)?.historicas?.results?.periodos;
  if (!Array.isArray(periodos)) return [];
  return periodos
    .map((p) => {
      const per = p as { periodo?: string; entidades?: Array<{ situacion?: number }> };
      const ents = Array.isArray(per.entidades) ? per.entidades : [];
      const peor = ents.reduce((m, e) => Math.max(m, Number(e?.situacion) || 0), 0);
      return { periodo: String(per.periodo ?? ""), situacion: peor };
    })
    .filter((x) => x.periodo.length === 6)
    // Del más viejo al más nuevo: la línea se lee de izquierda a derecha.
    .sort((a, b) => a.periodo.localeCompare(b.periodo));
}

/** "202606" → "06/26" */
function periodoCorto(p: string): string {
  return `${p.slice(4, 6)}/${p.slice(2, 4)}`;
}

/**
 * 🔴 El detalle POR ENTIDAD ya viajaba en `crudo` y no se mostraba en ningún lado.
 *
 * El panel resumía todo a "peor situación" y "deuda total": no se veía QUIÉN le prestó,
 * cuánto le debe a cada uno, ni cuál de todos es el que lo tiene en juicio. Con cuatro
 * entidades en situación 1 y una en 4, el informe decía "4" y no había forma de saber si
 * eran $2.000 de una tarjeta o $2.000.000 de un banco.
 */
function entidadesDe(crudo: unknown): EntidadBureau[] {
  const periodos = (crudo as { deudas?: { results?: { periodos?: unknown[] } } } | null)?.deudas?.results?.periodos;
  if (!Array.isArray(periodos) || periodos.length === 0) return [];
  const ents = (periodos[0] as { entidades?: unknown[] })?.entidades;
  if (!Array.isArray(ents)) return [];
  return ents
    .map((e) => e as EntidadBureau)
    .filter((e) => e && typeof e.entidad === "string")
    // El que peor está, primero: es el que define el caso.
    .sort((a, b) => (b.situacion ?? 0) - (a.situacion ?? 0) || (b.monto ?? 0) - (a.monto ?? 0));
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
            {/* Una consulta que SALIÓ BIEN pero sin registros no puede leerse igual que una
                que falló: se marca en verde para que el operador sepa que el dato llegó. */}
            {ultima.mensaje && (
              <p className={`mt-3 text-xs ${ultima.situacion_bcra == null && ultima.cheques_rechazados == null && /no figura/i.test(ultima.mensaje) ? "text-success" : "text-muted-foreground/80"}`}>
                {ultima.mensaje}
              </p>
            )}
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
          
            {/* Historial de 24 meses: se lee de un vistazo si alguna vez estuvo mal. */}
            {(() => {
              const hist = historialDe(ultima.crudo);
              if (hist.length === 0) return null;
              const peorHistorico = hist.reduce((m, h) => Math.max(m, h.situacion), 0);
              return (
                <div className="mt-4 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Historial · {hist.length} meses
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Peor situación del período:{" "}
                      <span className={peorHistorico >= 3 ? "font-semibold text-destructive" : "text-foreground"}>
                        {peorHistorico > 0 ? peorHistorico : "sin deuda informada"}
                      </span>
                    </p>
                  </div>
                  <div className="mt-2 flex gap-[3px] overflow-x-auto pb-1">
                    {hist.map((h) => (
                      <div
                        key={h.periodo}
                        title={`${periodoCorto(h.periodo)} · situación ${h.situacion || "—"}`}
                        className={`h-7 min-w-[14px] flex-1 rounded-[3px] ${
                          h.situacion >= 5 ? "bg-destructive"
                          : h.situacion >= 3 ? "bg-destructive/60"
                          : h.situacion === 2 ? "bg-warning"
                          : h.situacion === 1 ? "bg-success/70"
                          : "bg-muted-foreground/15"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground/50">
                    <span>{periodoCorto(hist[0].periodo)}</span>
                    <span>{periodoCorto(hist[hist.length - 1].periodo)}</span>
                  </div>
                </div>
              );
            })()}

            {/* Detalle por entidad — el dato que el resumen aplana. */}
            {(() => {
              const ents = entidadesDe(ultima.crudo);
              if (ents.length === 0) return null;
              return (
                <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Entidad</th>
                        <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sit.</th>
                        <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Monto</th>
                        <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Atraso</th>
                        <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Alertas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ents.map((e, i) => (
                        <tr key={`${e.entidad}-${i}`} className={`border-t border-border/50 ${i % 2 === 1 ? "bg-muted/5" : ""}`}>
                          <td className="px-3 py-2 text-foreground">{e.entidad}</td>
                          <td className="px-3 py-2 text-center">
                            <StatusBadge label={String(e.situacion)} variant={sitVariant(e.situacion)} />
                          </td>
                          {/* El BCRA informa en MILES: 2049 son $2.049.000. */}
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">{formatMonto((e.monto ?? 0) * 1000, 0)}</td>
                          <td className={`px-3 py-2 text-right font-mono tabular-nums ${(e.diasAtrasoPago ?? 0) > 0 ? "text-warning" : "text-muted-foreground/40"}`}>
                            {(e.diasAtrasoPago ?? 0) > 0 ? `${e.diasAtrasoPago} d` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex flex-wrap gap-1">
                              {(e.procesoJud || e.situacionJuridica) && <StatusBadge label="Juicio" variant="destructive" />}
                              {e.refinanciaciones && <StatusBadge label="Refinanció" variant="warning" />}
                              {e.enRevision && <StatusBadge label="En revisión" variant="muted" />}
                              {!e.procesoJud && !e.situacionJuridica && !e.refinanciaciones && !e.enRevision && (
                                <span className="text-muted-foreground/30">—</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
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
