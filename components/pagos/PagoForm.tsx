"use client";

import { useState, useEffect } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { Field, Select, Input, Textarea } from "@/components/ui/field";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import type { CuotaPersistida, EstadoCuota } from "@/lib/swr";

interface Credito {
  id: string;
  cliente: { nombre: string };
  saldo_pendiente: number;
  tasa: number;
  plazo_meses: number;
}

interface PagoFormProps {
  /** Si viene, el form arranca con ese crédito preseleccionado y bloqueado. */
  creditoId?: string;
  onClose: (success?: boolean) => void;
}

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function fmt2(n: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}
const round2 = (x: number) => Math.round(x * 100) / 100;

const CUOTA_BADGE: Record<EstadoCuota, { label: string; variant: BadgeVariant }> = {
  pagada:    { label: "Pagada",    variant: "success" },
  parcial:   { label: "Parcial",   variant: "warning" },
  vencida:   { label: "Vencida",   variant: "destructive" },
  pendiente: { label: "Pendiente", variant: "muted" },
};

/** Importe programado pendiente de la cuota (capital+interés+cargos sin contar mora). */
function importePendiente(c: CuotaPersistida): number {
  const pagadoProg = c.pagado_capital + (c.pagado_interes ?? 0) + (c.pagado_cargos ?? 0);
  return Math.max(0, round2(c.cuota_total - pagadoProg));
}

export function PagoForm({ creditoId, onClose }: PagoFormProps) {
  const [creditos, setCreditos] = useState<Credito[]>([]);
  const [selected, setSelected] = useState<Credito | null>(null);
  const [creditoSel, setCreditoSel] = useState(creditoId ?? "");

  const [cuotas, setCuotas] = useState<CuotaPersistida[]>([]);
  const [loadingCuotas, setLoadingCuotas] = useState(false);
  const [hasta, setHasta] = useState<number | null>(null); // cobrar hasta esta cuota (inclusive)

  const [manual, setManual] = useState(false);
  const [montoManual, setMontoManual] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [notas, setNotas] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lista de créditos activos.
  useEffect(() => {
    fetch("/api/creditos?estado=activo&limit=1000")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          const list: Credito[] = j.data.creditos || [];
          setCreditos(list);
          if (creditoId) setSelected(list.find((c) => c.id === creditoId) || null);
        }
      });
  }, [creditoId]);

  // Cuotas del crédito seleccionado.
  useEffect(() => {
    if (!creditoSel) { setCuotas([]); setHasta(null); return; }
    setLoadingCuotas(true);
    fetch(`/api/creditos/${creditoSel}/cuotas`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          const cs: CuotaPersistida[] = j.data.cuotas || [];
          setCuotas(cs);
          // Preseleccionar la próxima cuota a cobrar (la más vieja no saldada).
          const proxima = cs.find((c) => c.estado !== "pagada");
          setHasta(proxima ? proxima.nro : null);
        }
      })
      .finally(() => setLoadingCuotas(false));
  }, [creditoSel]);

  const handleCreditoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setCreditoSel(id);
    setSelected(creditos.find((c) => c.id === id) || null);
    setManual(false);
    setMontoManual("");
  };

  // Cuotas cobrables (no saldadas), en orden.
  const cobrables = cuotas.filter((c) => c.estado !== "pagada");
  // Importe sugerido = suma de pendientes desde la más vieja hasta `hasta` (inclusive).
  const seleccionadas = hasta != null ? cobrables.filter((c) => c.nro <= hasta) : [];
  const montoCuotas = round2(seleccionadas.reduce((s, c) => s + importePendiente(c), 0));

  const monto = manual ? (parseFloat(montoManual) || 0) : montoCuotas;
  const excede = selected ? monto > selected.saldo_pendiente : false;
  const hayMora = cobrables.some((c) => c.estado === "vencida");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditoSel || monto <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credito_id: creditoSel, monto, metodo, notas }),
      });
      const json = await res.json();
      if (json.ok) onClose(true);
      else setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 gap-0">
      {/* Contenido scrolleable */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1 -mr-1">
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Sección: Crédito */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Crédito</p>
        {creditoId ? (
          selected && (
            <div className="rounded-lg bg-muted/30 border border-border px-3 py-2.5 text-sm text-foreground">
              {selected.cliente.nombre} — Saldo: <span className="font-mono font-semibold text-warning">${fmt(selected.saldo_pendiente)}</span>
            </div>
          )
        ) : (
          <Field label="Seleccionar crédito activo" required>
            <Select name="credito_id" value={creditoSel} onChange={handleCreditoChange} required>
              <option value="">Elegir crédito…</option>
              {creditos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cliente.nombre} — Saldo: ${fmt(c.saldo_pendiente)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {/* Sección: Cuotas a cobrar */}
      {creditoSel && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cuotas a cobrar</p>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="accent-primary" />
              Monto personalizado
            </label>
          </div>

          {loadingCuotas ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando cuotas…
            </div>
          ) : cobrables.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground/60">
              Este crédito no tiene cuotas pendientes.
            </p>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="max-h-[34vh] overflow-y-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-card">
                    <th className="px-2 py-2 text-center font-semibold text-muted-foreground border-b border-border w-8"></th>
                    <th className="px-2 py-2 text-left   font-semibold text-muted-foreground border-b border-border w-8">#</th>
                    <th className="px-3 py-2 text-left   font-semibold text-muted-foreground border-b border-border">Vencimiento</th>
                    <th className="px-3 py-2 text-right  font-semibold text-foreground          border-b border-border">Importe</th>
                    <th className="px-3 py-2 text-left   font-semibold text-muted-foreground border-b border-border pr-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cobrables.map((c) => {
                    const incluida = !manual && hasta != null && c.nro <= hasta;
                    const b = CUOTA_BADGE[c.estado];
                    return (
                      <tr
                        key={c.nro}
                        onClick={() => !manual && setHasta(c.nro)}
                        className={`${manual ? "opacity-50" : "cursor-pointer hover:bg-muted/20"} ${incluida ? "bg-primary/5" : ""}`}
                        title={manual ? "Desactivá «Monto personalizado» para elegir cuotas" : "Cobrar hasta esta cuota"}
                      >
                        <td className="px-2 py-2 text-center border-b border-border/40">
                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${incluida ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                            {incluida && <Check className="h-3 w-3" />}
                          </span>
                        </td>
                        <td className="px-2 py-2 font-mono text-muted-foreground/60 border-b border-border/40">{c.nro}</td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums border-b border-border/40">{fmtDate(c.fecha_vencimiento)}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground tabular-nums border-b border-border/40">${fmt2(importePendiente(c))}</td>
                        <td className="px-3 py-2 pr-3 border-b border-border/40"><StatusBadge label={b.label} variant={b.variant} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Hint: hasta dónde se cobra */}
          {!manual && seleccionadas.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Cobrando {seleccionadas.length === 1 ? "la cuota" : `${seleccionadas.length} cuotas (hasta la`} #{hasta}{seleccionadas.length === 1 ? "" : ")"} ·
              importe programado <span className="font-mono text-foreground">${fmt2(montoCuotas)}</span>
              {hayMora && <span className="text-destructive"> · la mora por atraso se suma al imputar</span>}
            </p>
          )}
        </div>
      )}

      {/* Sección: Monto + método */}
      {creditoSel && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Monto a cobrar ($)"
              required={manual}
              hint={excede ? "⚠ Supera el saldo — el excedente quedará a favor" : (manual ? undefined : "calculado desde las cuotas")}
            >
              {manual ? (
                <Input
                  name="monto" type="number" placeholder="Ej: 85000"
                  value={montoManual} onChange={(e) => setMontoManual(e.target.value)}
                  min="1" step="100" required
                  className={excede ? "border-warning focus:ring-warning/20" : undefined}
                />
              ) : (
                <div className="flex h-10 items-center rounded-md border border-border bg-muted/20 px-3 font-mono font-semibold text-foreground">
                  ${fmt2(montoCuotas)}
                </div>
              )}
            </Field>
            <Field label="Método de pago">
              <Select name="metodo" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
                <option value="otro">Otro</option>
              </Select>
            </Field>
          </div>

          {/* Indicador de imputación */}
          {monto > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/20 border border-border px-3 py-2.5 text-xs text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>Imputación, cuota por cuota:</span>
              <span className="text-destructive font-medium">Mora</span><span>→</span>
              <span className="text-warning font-medium">Interés</span><span>→</span>
              <span className="text-muted-foreground font-medium">Cargos</span><span>→</span>
              <span className="text-primary font-medium">Capital</span>
            </div>
          )}
        </div>
      )}

      {/* Notas */}
      <Field label="Notas (opcional)">
        <Textarea name="notas" placeholder="Observaciones del pago…" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
      </Field>
      </div>

      {/* Acciones (fijas, no scrollean) */}
      <div className="shrink-0 flex items-center justify-end gap-2 pt-3 mt-3 border-t border-border">
        <button
          type="button" onClick={() => onClose(false)}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit" disabled={loading || !creditoSel || monto <= 0}
          className="px-5 py-2 rounded-lg bg-success text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity inline-flex items-center gap-1.5"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading ? "Registrando..." : "Registrar pago"}
        </button>
      </div>
    </form>
  );
}
