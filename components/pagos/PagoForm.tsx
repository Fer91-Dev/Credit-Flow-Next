"use client";

import { useState, useEffect } from "react";
import { ArrowRight, Check, Loader2, Search, X } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { formatNumero, maskMontoInput, parseMontoInput, formatFecha, formatCreditoNumero, cn } from "@/lib/utils";
import type { CuotaPersistida, EstadoCuota } from "@/lib/swr";

interface Credito {
  id: string;
  numero: number | null;
  cliente_id: string;
  cliente: { nombre: string; documento?: string | null };
  saldo_pendiente: number;
  tasa: number;
  plazo_meses: number;
  dias_mora?: number;
  proximo_pago?: string | null;
}

interface PagoFormProps {
  /** Si viene, el form arranca con ese crédito preseleccionado y bloqueado. */
  creditoId?: string;
  /** Si viene, la lista de créditos se acota a este cliente. */
  clienteId?: string;
  onClose: (success?: boolean) => void;
}

const fmt  = (n: number) => formatNumero(n, 0);
const fmt2 = (n: number) => formatNumero(n, 2);
const fmtDate = (s: string) => formatFecha(s);
const round2   = (x: number) => Math.round(x * 100) / 100;

const CUOTA_BADGE: Record<EstadoCuota, { label: string; variant: BadgeVariant }> = {
  pagada:    { label: "Pagada",    variant: "success" },
  parcial:   { label: "Parcial",   variant: "warning" },
  vencida:   { label: "Vencida",   variant: "destructive" },
  pendiente: { label: "Pendiente", variant: "muted" },
};

function importePendiente(c: CuotaPersistida): number {
  const pagadoProg = c.pagado_capital + (c.pagado_interes ?? 0) + (c.pagado_cargos ?? 0);
  return Math.max(0, round2(c.cuota_total - pagadoProg));
}

/** Filtra la lista de créditos por N° de crédito o DNI del cliente. */
function buscarCreditos(query: string, lista: Credito[]): Credito[] {
  const q = query.trim();
  if (!q) return [];
  const qUp     = q.toUpperCase().replace(/\s/g, "");
  const qDigits = q.replace(/\D/g, "");
  return lista.filter(c => {
    if (c.numero != null) {
      const formatted = formatCreditoNumero(c.numero).toUpperCase(); // "CRD-000001"
      if (formatted.includes(qUp) || String(c.numero) === qDigits) return true;
    }
    if (qDigits.length >= 6) {
      const doc = (c.cliente.documento ?? "").replace(/\D/g, "");
      if (doc && doc === qDigits) return true;
    }
    return false;
  });
}

/** Días (calendario, UTC-safe) hasta el próximo vencimiento. Negativo si ya pasó. */
function diasHastaVencimiento(fecha?: string | null): number | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  const venc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const hoy = new Date();
  const ref = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((venc - ref) / 86_400_000);
}

type EstadoCred = { label: string; variant: BadgeVariant; bar: string };

/** Estado semántico del crédito para el selector: vencido / próximo / al día. */
function estadoCredito(c: Credito): EstadoCred {
  const mora = c.dias_mora ?? 0;
  if (mora > 0) {
    return { label: `Vencido · ${mora}d`, variant: "destructive", bar: "bg-destructive" };
  }
  const dias = diasHastaVencimiento(c.proximo_pago);
  if (dias !== null && dias >= 0 && dias <= 5) {
    return { label: dias === 0 ? "Vence hoy" : `Vence en ${dias}d`, variant: "warning", bar: "bg-warning" };
  }
  return { label: "Al día", variant: "success", bar: "bg-success" };
}

/** Devuelve una función que marca como prioritario el crédito más atrasado de la lista. */
function detectorPrioridad(lista: Credito[]): (c: Credito) => boolean {
  const maxMora = lista.reduce((m, c) => Math.max(m, c.dias_mora ?? 0), 0);
  return (c) => lista.length > 1 && (c.dias_mora ?? 0) > 0 && (c.dias_mora ?? 0) === maxMora;
}

/** Tarjeta clickeable del selector de crédito (lista de opciones). */
function CreditoOption({ c, onClick, showCliente, prioritario }: {
  c: Credito; onClick: () => void; showCliente?: boolean; prioritario?: boolean;
}) {
  const est = estadoCredito(c);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-all hover:border-primary/50 hover:bg-muted/20"
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", est.bar)} aria-hidden />
      <div className="flex items-center gap-3 pl-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-foreground">{formatCreditoNumero(c.numero)}</span>
            <StatusBadge label={est.label} variant={est.variant} />
            {prioritario && (
              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                Prioritario
              </span>
            )}
          </div>
          {showCliente && (
            <p className="truncate text-xs text-muted-foreground">
              {c.cliente.nombre}{c.cliente.documento ? ` · DNI ${c.cliente.documento}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Saldo</span>
          <span className="font-mono text-sm font-bold text-foreground tabular-nums">${fmt(c.saldo_pendiente)}</span>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
      </div>
    </button>
  );
}

/** Tarjeta del crédito ya elegido (o bloqueado): muestra selección explícita. */
function CreditoSeleccionado({ c, onCambiar }: { c: Credito; onCambiar?: () => void }) {
  const est = estadoCredito(c);
  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/50 bg-primary/10 px-4 py-3.5 ring-1 ring-primary/30">
      <span className={cn("absolute inset-y-0 left-0 w-1", est.bar)} aria-hidden />
      <div className="flex items-start gap-3 pl-2">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-foreground">{formatCreditoNumero(c.numero)}</span>
            <StatusBadge label={est.label} variant={est.variant} />
          </div>
          <p className="truncate text-xs text-muted-foreground">{c.cliente.nombre}</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Saldo pendiente</span>
            <span className="font-mono text-sm font-bold text-foreground tabular-nums">${fmt(c.saldo_pendiente)}</span>
          </div>
        </div>
        {onCambiar && (
          <button
            type="button"
            onClick={onCambiar}
            className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" /> Cambiar
          </button>
        )}
      </div>
    </div>
  );
}

export function PagoForm({ creditoId, clienteId, onClose }: PagoFormProps) {
  const [creditos, setCreditos]     = useState<Credito[]>([]);
  const [selected, setSelected]     = useState<Credito | null>(null);
  const [creditoSel, setCreditoSel] = useState(creditoId ?? "");

  // Búsqueda (activo solo cuando no hay creditoId ni clienteId preseleccionado)
  const [query,      setQuery]      = useState("");
  const [searched,   setSearched]   = useState<string | null>(null);
  const [resultados, setResultados] = useState<Credito[]>([]);

  const [cuotas, setCuotas]               = useState<CuotaPersistida[]>([]);
  const [loadingCuotas, setLoadingCuotas] = useState(false);
  const [hasta, setHasta]                 = useState<number | null>(null);

  const [manual,       setManual]       = useState(false);
  const [montoManual,  setMontoManual]  = useState("");
  const [metodo,       setMetodo]       = useState("efectivo");
  const [notas,        setNotas]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  // Carga inicial de créditos activos
  useEffect(() => {
    fetch("/api/creditos?estado=activo&limit=1000")
      .then(r => r.json())
      .then(j => {
        if (!j.ok) return;
        const todos: Credito[] = j.data.creditos || [];
        const list = clienteId ? todos.filter(c => c.cliente_id === clienteId) : todos;
        setCreditos(list);
        if (creditoId) {
          const c = list.find(x => x.id === creditoId) ?? null;
          setSelected(c);
          if (c) setCreditoSel(c.id);
        }
      });
  }, [creditoId, clienteId]);

  // Cuotas del crédito seleccionado
  useEffect(() => {
    if (!creditoSel) { setCuotas([]); setHasta(null); return; }
    setLoadingCuotas(true);
    fetch(`/api/creditos/${creditoSel}/cuotas`)
      .then(r => r.json())
      .then(j => {
        if (!j.ok) return;
        const cs: CuotaPersistida[] = j.data.cuotas || [];
        setCuotas(cs);
        const proxima = cs.find(c => c.estado !== "pagada");
        setHasta(proxima ? proxima.nro : null);
      })
      .finally(() => setLoadingCuotas(false));
  }, [creditoSel]);

  const selectCredito = (c: Credito) => {
    setSelected(c);
    setCreditoSel(c.id);
    setResultados([]);
    setManual(false);
    setMontoManual("");
  };

  const handleCambiar = () => {
    setSelected(null);
    setCreditoSel("");
    setQuery("");
    setSearched(null);
    setResultados([]);
    setCuotas([]);
    setHasta(null);
    setManual(false);
    setMontoManual("");
  };

  const doSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSearched(q);
    const matches = buscarCreditos(q, creditos);
    setResultados(matches);
    if (matches.length === 1) selectCredito(matches[0]);
  };

  const esPrioritarioCliente = detectorPrioridad(creditos);
  const esPrioritarioResult  = detectorPrioridad(resultados);

  const cobrables    = cuotas.filter(c => c.estado !== "pagada");
  const seleccionadas = hasta != null ? cobrables.filter(c => c.nro <= hasta) : [];
  const montoCuotas  = round2(seleccionadas.reduce((s, c) => s + importePendiente(c), 0));
  const monto        = manual ? parseMontoInput(montoManual) : montoCuotas;
  const excede       = selected ? monto > selected.saldo_pendiente : false;
  const hayMora      = cobrables.some(c => c.estado === "vencida");

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
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 gap-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-5 px-1">

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* ── Paso 1: Selección de crédito ── */}
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Crédito a cobrar</p>
            {!creditoId && selected && (
              <span className="text-[11px] text-success font-medium">Seleccionado</span>
            )}
          </div>

          {creditoId ? (
            /* Bloqueado (abierto desde el detalle del crédito) */
            selected && <CreditoSeleccionado c={selected} />
          ) : selected ? (
            /* Crédito elegido — tarjeta seleccionada con botón Cambiar */
            <CreditoSeleccionado c={selected} onCambiar={handleCambiar} />

          ) : clienteId ? (
            /* Créditos del cliente — picker (1 o más, siempre explícito) */
            creditos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground/60">
                Este cliente no tiene créditos activos.
              </p>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Elegí el crédito a cobrar · {creditos.length} activo{creditos.length !== 1 ? "s" : ""}
                </p>
                {creditos.map(c => (
                  <CreditoOption key={c.id} c={c} onClick={() => selectCredito(c)} prioritario={esPrioritarioCliente(c)} />
                ))}
              </div>
            )

          ) : (
            /* Buscador por N° de crédito o DNI */
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="N° de crédito (CRD-000001) o DNI"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSearched(null); setResultados([]); }}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={doSearch}
                  disabled={!query.trim()}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  <Search className="h-4 w-4" />
                  Buscar
                </button>
              </div>

              {/* Sin resultados */}
              {searched !== null && resultados.length === 0 && (
                <p className="text-sm text-muted-foreground/70 text-center py-3">
                  Sin resultados para <span className="font-mono text-foreground">&quot;{searched}&quot;</span>
                </p>
              )}

              {/* Múltiples resultados — picker */}
              {resultados.length > 1 && (
                <div className="space-y-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    {resultados.length} crédito{resultados.length !== 1 ? "s" : ""} encontrado{resultados.length !== 1 ? "s" : ""} · elegí cuál cobrar
                  </p>
                  {resultados.map(c => (
                    <CreditoOption key={c.id} c={c} onClick={() => selectCredito(c)} showCliente prioritario={esPrioritarioResult(c)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Paso 2: Cuotas a cobrar ── */}
        {creditoSel && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cuotas a cobrar</p>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} className="accent-primary" />
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
                        <th className="px-3 py-2 text-right  font-semibold text-foreground       border-b border-border">Importe</th>
                        <th className="px-3 py-2 text-left   font-semibold text-muted-foreground border-b border-border pr-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cobrables.map(c => {
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

            {!manual && seleccionadas.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Cobrando {seleccionadas.length === 1 ? "la cuota" : `${seleccionadas.length} cuotas (hasta la`} #{hasta}{seleccionadas.length === 1 ? "" : ")"} ·
                importe programado <span className="font-mono text-foreground">${fmt2(montoCuotas)}</span>
                {hayMora && <span className="text-destructive"> · la mora por atraso se suma al imputar</span>}
              </p>
            )}
          </div>
        )}

        {/* ── Paso 3: Monto + método ── */}
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
                    name="monto" type="text" inputMode="decimal" placeholder="85.000,00"
                    value={montoManual} onChange={e => setMontoManual(maskMontoInput(e.target.value))}
                    required
                    className={`text-right font-mono tabular-nums ${excede ? "border-warning focus:ring-warning/20" : ""}`}
                  />
                ) : (
                  <div className="flex h-10 items-center rounded-md border border-border bg-muted/20 px-3 font-mono font-semibold text-foreground">
                    ${fmt2(montoCuotas)}
                  </div>
                )}
              </Field>
              <Field label="Método de pago">
                <Select name="metodo" value={metodo} onChange={e => setMetodo(e.target.value)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="otro">Otro</option>
                </Select>
              </Field>
            </div>

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
          <Textarea name="notas" placeholder="Observaciones del pago…" value={notas} onChange={e => setNotas(e.target.value)} rows={2} />
        </Field>
      </div>

      {/* Acciones fijas */}
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
