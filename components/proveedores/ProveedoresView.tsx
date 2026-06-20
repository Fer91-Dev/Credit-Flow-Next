"use client";

import { useMemo, useState } from "react";
import { mutate as globalMutate } from "swr";
import {
  Truck, Plus, Building2, Wallet, ArrowDownLeft, ArrowUpRight, Pencil, Trash2,
  Mail, Phone, IdCard, X,
} from "lucide-react";
import {
  useProveedores, useProveedor, KEYS,
  type Proveedor, type MovimientoProveedor,
} from "@/lib/swr";
import { formatFecha } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
const fmtDate = (s: string) => formatFecha(s);

export function ProveedoresView() {
  const { proveedores, deudaTotal, isLoading, error, mutate } = useProveedores();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Proveedor | null>(null);
  const [fichaId, setFichaId] = useState<string | null>(null);

  const totales = useMemo(() => {
    const activos = proveedores.filter(p => p.activo).length;
    const conDeuda = proveedores.filter(p => (p.saldo ?? 0) > 0).length;
    return { total: proveedores.length, activos, conDeuda };
  }, [proveedores]);

  const refrescar = () => { mutate(); globalMutate(KEYS.proveedores); };

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (p: Proveedor) => { setEditing(p); setFormOpen(true); };

  const handleFormClose = (ok?: boolean) => {
    setFormOpen(false); setEditing(null);
    if (ok) refrescar();
  };

  const handleDelete = async (p: Proveedor) => {
    if (!confirm(`¿Eliminar a ${p.nombre}? Se borrará también su cuenta corriente.`)) return;
    await fetch(`/api/proveedores/${p.id}`, { method: "DELETE" });
    if (fichaId === p.id) setFichaId(null);
    refrescar();
  };

  const cta = (
    <button
      onClick={openNew}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      <Plus className="h-4 w-4" /> Nuevo proveedor
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Truck}
        title="Proveedores"
        subtitle="Gastos, fondeo y cuenta corriente"
        accent="primary"
        actions={cta}
      />

      {isLoading ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar proveedores: {error.message}
        </div>
      ) : (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Building2} label="Proveedores" value={String(totales.total)} sub={`${totales.activos} activos`} accent="primary" />
            <KpiCard icon={Wallet} label="Deuda total" value={`$${n0(deudaTotal)}`} accent={deudaTotal > 0 ? "warning" : "success"} mono sub="saldo a pagar" />
            <KpiCard icon={ArrowUpRight} label="Con saldo pendiente" value={String(totales.conDeuda)} accent={totales.conDeuda > 0 ? "warning" : "muted"} />
            <KpiCard icon={Building2} label="Activos" value={String(totales.activos)} accent="primary" />
          </div>

          {proveedores.length === 0 ? (
            <EmptyState onNew={openNew} />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Proveedor</th>
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border hidden lg:table-cell">Rubro</th>
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Contacto</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Saldo</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proveedores.map((p, idx) => {
                      const saldo = p.saldo ?? 0;
                      return (
                        <tr key={p.id} onClick={() => setFichaId(p.id)} className={`cursor-pointer hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""} ${!p.activo ? "opacity-50" : ""}`}>
                          <td className="px-4 py-3 border-b border-border/70">
                            <p className="font-medium text-foreground">{p.nombre}</p>
                            {p.cuit && <p className="text-[11px] font-mono text-muted-foreground mt-0.5 flex items-center gap-1"><IdCard className="h-3 w-3" />{p.cuit}</p>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground border-b border-border/70 hidden lg:table-cell">{p.rubro || "—"}</td>
                          <td className="px-4 py-3 border-b border-border/70">
                            <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                              {p.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{p.email}</span>}
                              {p.telefono && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{p.telefono}</span>}
                              {!p.email && !p.telefono && <span className="text-muted-foreground/30">—</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold border-b border-border/70">
                            <span className={saldo > 0 ? "text-warning" : saldo < 0 ? "text-success" : "text-muted-foreground"}>
                              ${n0(saldo)}
                            </span>
                          </td>
                          <td className="px-4 py-3 pr-5 border-b border-border/70" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => openEdit(p)} title="Editar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDelete(p)} title="Eliminar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="block md:hidden space-y-3">
                {proveedores.map((p) => {
                  const saldo = p.saldo ?? 0;
                  return (
                    <div key={p.id} onClick={() => setFichaId(p.id)} className={`rounded-xl bg-card border border-border p-4 space-y-2 cursor-pointer active:bg-muted/20 ${!p.activo ? "opacity-50" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{p.nombre}</p>
                          {p.rubro && <p className="text-[11px] text-muted-foreground">{p.rubro}</p>}
                        </div>
                        <span className={`font-mono font-bold ${saldo > 0 ? "text-warning" : saldo < 0 ? "text-success" : "text-muted-foreground"}`}>${n0(saldo)}</span>
                      </div>
                      <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEdit(p)} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs text-muted-foreground"><Pencil className="h-3.5 w-3.5" /> Editar</button>
                        <button onClick={() => handleDelete(p)} className="flex items-center justify-center h-9 w-9 rounded-lg border border-border text-destructive"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      <ProveedorForm open={formOpen} proveedor={editing} onClose={handleFormClose} />
      <FichaDialog id={fichaId} onClose={() => setFichaId(null)} onChanged={refrescar} />
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Truck className="h-7 w-7 text-primary/60" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Todavía no cargaste proveedores</p>
        <p className="text-xs text-muted-foreground/60 max-w-sm leading-relaxed">
          Registrá proveedores y acreedores para llevar su cuenta corriente de gastos y fondeo.
        </p>
      </div>
      <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
        <Plus className="h-4 w-4" /> Nuevo proveedor
      </button>
    </div>
  );
}

/* ── Ficha + cuenta corriente ─────────────────────────────────────────────── */

function FichaDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { proveedor, isLoading, mutate } = useProveedor(id);
  const [movOpen, setMovOpen] = useState(false);

  const refrescar = () => { mutate(); onChanged(); };

  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{proveedor?.nombre ?? "Proveedor"}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
          {isLoading || !proveedor ? (
            <div className="space-y-3">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          ) : (
            <>
              {/* Datos */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                {proveedor.cuit && <span className="flex items-center gap-1"><IdCard className="h-3.5 w-3.5" />{proveedor.cuit}</span>}
                {proveedor.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{proveedor.email}</span>}
                {proveedor.telefono && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{proveedor.telefono}</span>}
                {proveedor.rubro && <StatusBadge label={proveedor.rubro} variant="muted" />}
              </div>

              {/* Totales */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-card border border-border p-3 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center justify-center gap-1"><ArrowUpRight className="h-3 w-3" /> Cargos</p>
                  <p className="text-base font-bold font-mono text-foreground mt-1">${n0(proveedor.totales.cargos)}</p>
                </div>
                <div className="rounded-xl bg-card border border-border p-3 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center justify-center gap-1"><ArrowDownLeft className="h-3 w-3" /> Pagos</p>
                  <p className="text-base font-bold font-mono text-success mt-1">${n0(proveedor.totales.pagos)}</p>
                </div>
                <div className="rounded-xl bg-card border border-border p-3 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Saldo</p>
                  <p className={`text-base font-bold font-mono mt-1 ${proveedor.totales.saldo > 0 ? "text-warning" : proveedor.totales.saldo < 0 ? "text-success" : "text-muted-foreground"}`}>${n0(proveedor.totales.saldo)}</p>
                </div>
              </div>

              {/* Acción */}
              <div className="flex justify-end">
                <button onClick={() => setMovOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                  <Plus className="h-4 w-4" /> Nuevo movimiento
                </button>
              </div>

              {/* Movimientos */}
              <div className="rounded-xl border border-border overflow-hidden">
                {proveedor.movimientos.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 py-10 text-center">Sin movimientos en la cuenta.</p>
                ) : (
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Fecha</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Concepto</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-4">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proveedor.movimientos.map((m, idx) => <MovRow key={m.id} mov={m} idx={idx} />)}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>

        {proveedor && (
          <MovimientoDialog
            open={movOpen}
            proveedorId={proveedor.id}
            onClose={(ok) => { setMovOpen(false); if (ok) refrescar(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MovRow({ mov, idx }: { mov: MovimientoProveedor; idx: number }) {
  const ingreso = mov.monto < 0; // pago = sale plata (cancela deuda)
  return (
    <tr className={idx % 2 === 1 ? "bg-muted/5" : ""}>
      <td className="px-3 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap border-b border-border/70">{fmtDate(mov.fecha)}</td>
      <td className="px-3 py-2.5 border-b border-border/70">
        <span className="text-foreground">{mov.concepto}</span>
        {mov.comprobante && <span className="ml-2 text-[11px] text-muted-foreground/70 font-mono">#{mov.comprobante}</span>}
        <span className="ml-2"><StatusBadge label={mov.tipo === "pago" ? "Pago" : "Cargo"} variant={mov.tipo === "pago" ? "success" : "warning"} /></span>
      </td>
      <td className={`px-3 py-2.5 pr-4 text-right font-mono font-semibold border-b border-border/70 ${ingreso ? "text-success" : "text-warning"}`}>
        {ingreso ? "−" : "+"}${n2(Math.abs(mov.monto))}
      </td>
    </tr>
  );
}

function MovimientoDialog({ open, proveedorId, onClose }: { open: boolean; proveedorId: string; onClose: (ok?: boolean) => void }) {
  const [tipo, setTipo] = useState<"cargo" | "pago">("cargo");
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [metodo, setMetodo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setTipo("cargo"); setMonto(""); setConcepto(""); setComprobante(""); setMetodo(""); setError(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/proveedores/${proveedorId}/movimientos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, monto: parseFloat(monto), concepto, comprobante, metodo }),
      });
      const json = await res.json();
      if (json.ok) { reset(); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el movimiento");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo" required>
              <Select value={tipo} onChange={(e) => setTipo(e.target.value as "cargo" | "pago")}>
                <option value="cargo">Cargo (deuda)</option>
                <option value="pago">Pago (cancela)</option>
              </Select>
            </Field>
            <Field label="Monto ($)" required>
              <Input type="number" min="1" step="any" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 50000" required />
            </Field>
          </div>
          <Field label="Concepto" required>
            <Textarea value={concepto} onChange={(e) => setConcepto(e.target.value)} rows={2} placeholder="Factura, gasto, fondeo, pago…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Comprobante">
              <Input value={comprobante} onChange={(e) => setComprobante(e.target.value)} placeholder="N° factura" />
            </Field>
            <Field label="Método">
              <Select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                <option value="">—</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
                <option value="otro">Otro</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <button type="button" onClick={() => { reset(); onClose(false); }} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={loading || !monto || !concepto.trim()} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity">
              {loading ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Alta / edición de proveedor ──────────────────────────────────────────── */

function ProveedorForm({ open, proveedor, onClose }: { open: boolean; proveedor: Proveedor | null; onClose: (ok?: boolean) => void }) {
  const editing = !!proveedor;
  const [nombre, setNombre] = useState("");
  const [cuit, setCuit] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [rubro, setRubro] = useState("");
  const [notas, setNotas] = useState("");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? (proveedor?.id ?? "new") : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setNombre(proveedor?.nombre ?? "");
    setCuit(proveedor?.cuit ?? "");
    setEmail(proveedor?.email ?? "");
    setTelefono(proveedor?.telefono ?? "");
    setDireccion(proveedor?.direccion ?? "");
    setRubro(proveedor?.rubro ?? "");
    setNotas(proveedor?.notas ?? "");
    setActivo(proveedor?.activo ?? true);
    setError(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) { setError("El nombre es requerido"); return; }
    setLoading(true); setError(null);
    try {
      const body = { nombre, cuit, email, telefono, direccion, rubro, notas, activo };
      const res = await fetch(editing ? `/api/proveedores/${proveedor!.id}` : "/api/proveedores", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) onClose(true);
      else setError(json.error);
    } catch {
      setError("No se pudo guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{editing ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 overflow-y-auto">
          {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">{error}</div>}
          <Field label="Nombre / Razón social" required>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del proveedor" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CUIT">
              <Input value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="opcional" />
            </Field>
            <Field label="Rubro">
              <Input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="servicios, fondeo…" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
            </Field>
            <Field label="Teléfono">
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="opcional" />
            </Field>
          </div>
          <Field label="Dirección">
            <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="opcional" />
          </Field>
          <Field label="Notas">
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Observaciones…" />
          </Field>
          <Field label="Estado">
            <Select value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <button type="button" onClick={() => onClose(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={loading || !nombre.trim()} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity">
              {loading ? "Guardando…" : editing ? "Guardar cambios" : "Crear"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
