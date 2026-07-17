"use client";

import { useMemo, useState } from "react";
import { mutate as globalMutate } from "swr";
import {
  Plus, Building2, Wallet, ArrowDownLeft, ArrowUpRight, Pencil, Trash2,
  Mail, Phone, IdCard, X, FileText, MapPin, Tag, Power,
} from "lucide-react";
import {
  useProveedores, useProveedor, KEYS,
  type Proveedor, type MovimientoProveedor,
} from "@/lib/swr";
import { formatFecha, parseMontoInput } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Emoji } from "@/components/ui/Emoji";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ModalHeader, MoneyInput, IconInput, IconSelect, IconTextarea, FormActions, Segmented, FieldLabel, MODAL_CONTENT } from "@/components/ui/form-kit";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
const fmtDate = (s: string) => formatFecha(s);

export function ProveedoresView() {
  const { proveedores, deudaTotal, isLoading, error, mutate } = useProveedores();
  const confirm = useConfirm();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Proveedor | null>(null);
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [recientes, setRecientes] = useState<"hoy" | "mes" | "anio" | null>(null); // filtro por fecha de alta

  const totales = useMemo(() => {
    const activos = proveedores.filter(p => p.activo).length;
    const conDeuda = proveedores.filter(p => (p.saldo ?? 0) > 0).length;
    return { total: proveedores.length, activos, conDeuda };
  }, [proveedores]);

  const filtrados = useMemo(() => {
    let base = proveedores;
    if (recientes) {
      const now = new Date();
      const desde =
        recientes === "hoy" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        : recientes === "mes" ? new Date(now.getFullYear(), now.getMonth(), 1).getTime()
        : new Date(now.getFullYear(), 0, 1).getTime();
      base = base.filter((p) => p.created_at && new Date(p.created_at).getTime() >= desde);
    }
    const t = q.trim().toLowerCase();
    if (!t) return base;
    return base.filter((p) =>
      p.nombre.toLowerCase().includes(t) ||
      (p.cuit ?? "").toLowerCase().includes(t) ||
      (p.email ?? "").toLowerCase().includes(t) ||
      (p.rubro ?? "").toLowerCase().includes(t)
    );
  }, [proveedores, q, recientes]);

  const refrescar = () => { mutate(); globalMutate(KEYS.proveedores); };

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (p: Proveedor) => { setEditing(p); setFormOpen(true); };

  const handleFormClose = (ok?: boolean) => {
    setFormOpen(false); setEditing(null);
    if (ok) refrescar();
  };

  const handleDelete = async (p: Proveedor) => {
    const ok = await confirm({
      title: "¿Eliminar proveedor?",
      description: `Se eliminará a ${p.nombre} y se borrará también su cuenta corriente.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/proveedores/${p.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("No se pudo eliminar el proveedor"); return; }
    if (fichaId === p.id) setFichaId(null);
    refrescar();
    toast.success(`Proveedor ${p.nombre} eliminado`);
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
        icon="delivery-truck"
        title="Proveedores"
        subtitle="Gastos, fondeo y cuenta corriente"
        accent="primary"
      />
      {/* Toolbar: buscador (tamaño Productos) + CTA */}
      <div className="flex flex-wrap items-start gap-2">
        <BuscadorF3
          value={q}
          onChange={setQ}
          placeholder="Buscar por nombre, CUIT, email o rubro…"
          onF3={() => setQ("")}
          f3Hint="para limpiar el filtro y ver todos"
          className="flex-1 min-w-[200px] sm:max-w-sm"
        />
        <div className="sm:ml-auto">{cta}</div>
      </div>

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
            <KpiCard icon="office-building" label="Proveedores" value={String(totales.total)} sub={`${totales.activos} activos`} accent="primary" />
            <KpiCard icon="money-bag" label="Deuda total" value={`$${n0(deudaTotal)}`} accent={deudaTotal > 0 ? "warning" : "success"} mono sub="saldo a pagar" />
            <KpiCard icon="outbox-tray" label="Con saldo pendiente" value={String(totales.conDeuda)} accent={totales.conDeuda > 0 ? "warning" : "muted"} />
            <KpiCard icon="office-building" label="Activos" value={String(totales.activos)} accent="primary" />
          </div>

          {/* Título de la lista + filtro "recién cargados" */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
            <Emoji name="delivery-truck" className="h-4 w-4" />
            <h2 className="text-sm font-semibold text-foreground">
              {recientes ? `Proveedores cargados ${recientes === "hoy" ? "hoy" : recientes === "mes" ? "este mes" : "este año"}` : "Listado de Proveedores"}
            </h2>
            {recientes && <span className="text-xs text-muted-foreground/60">· {filtrados.length}</span>}
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
              <span className="pl-2 pr-1 text-[11px] font-medium text-muted-foreground">Recién cargados:</span>
              {([["hoy", "Hoy"], ["mes", "Este mes"], ["anio", "Este año"]] as const).map(([key, lbl]) => (
                <button
                  key={key}
                  onClick={() => setRecientes((r) => (r === key ? null : key))}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    recientes === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <DataTable<Proveedor>
            rows={filtrados}
            rowKey={(p) => p.id}
            onRowClick={(p) => setFichaId(p.id)}
            rowClassName={(p) => (p.activo ? "" : "opacity-50")}
            zebra
            empty={{
              icon: "delivery-truck",
              title: "Todavía no cargaste proveedores",
              hint: "Registrá proveedores y acreedores para llevar su cuenta corriente de gastos y fondeo.",
              action: cta,
            }}
            columns={[
              {
                header: "Proveedor",
                cell: (p) => (
                  <div>
                    <p className="font-medium text-foreground">{p.nombre}</p>
                    {p.cuit && <p className="text-[11px] font-mono text-muted-foreground mt-0.5 flex items-center gap-1"><IdCard className="h-3 w-3" />{p.cuit}</p>}
                  </div>
                ),
              },
              {
                header: "Rubro", className: "hidden lg:table-cell",
                cell: (p) => <span className="text-muted-foreground">{p.rubro || "—"}</span>,
              },
              {
                header: "Contacto",
                cell: (p) => (
                  <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                    {p.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{p.email}</span>}
                    {p.telefono && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{p.telefono}</span>}
                    {!p.email && !p.telefono && <span className="text-muted-foreground/30">—</span>}
                  </div>
                ),
              },
              {
                header: "Saldo", mono: true,
                cell: (p) => {
                  const saldo = p.saldo ?? 0;
                  return <span className={`font-bold ${saldo > 0 ? "text-warning" : saldo < 0 ? "text-success" : "text-muted-foreground"}`}>${n0(saldo)}</span>;
                },
              },
              {
                header: "Acciones", align: "right",
                cell: (p) => (
                  <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => openEdit(p)} title="Editar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(p)} title="Eliminar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              },
            ]}
            renderMobileCard={(p) => {
              const saldo = p.saldo ?? 0;
              return (
                <div onClick={() => setFichaId(p.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFichaId(p.id); } }} className={`rounded-xl bg-card border border-border p-4 space-y-2 cursor-pointer active:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${!p.activo ? "opacity-50" : ""}`}>
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
            }}
          />
        </div>
      )}

      <ProveedorForm open={formOpen} proveedor={editing} onClose={handleFormClose} />
      <FichaDialog id={fichaId} onClose={() => setFichaId(null)} onChanged={refrescar} />
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
              <div className="rounded-xl border border-border overflow-x-auto">
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
  const confirm = useConfirm();
  const toast = useToast();
  const [tipo, setTipo] = useState<"cargo" | "pago">("cargo");
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [metodo, setMetodo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setTipo("cargo"); setMonto(""); setConcepto(""); setComprobante(""); setMetodo(""); setError(null); };

  const montoNum = parseMontoInput(monto);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirm({
      title: tipo === "pago" ? "¿Registrar pago?" : "¿Registrar cargo?",
      description: `Se registrará un ${tipo === "pago" ? "pago" : "cargo"} de $${n2(montoNum)} en la cuenta corriente.`,
      confirmLabel: "Registrar",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/proveedores/${proveedorId}/movimientos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, monto: montoNum, concepto, comprobante, metodo }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success("Movimiento registrado"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el movimiento");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className={MODAL_CONTENT}>
        <ModalHeader
          icon="money-bag"
          title="Nuevo movimiento"
          subtitle="Cargá un cargo (deuda) o un pago en la cuenta corriente del proveedor."
        />
        <form onSubmit={submit} className="space-y-5">
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>}

          {/* Tipo */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Tipo</FieldLabel>
            <Segmented
              value={tipo}
              onChange={setTipo}
              options={[
                { value: "cargo", label: "Cargo (deuda)", icon: "outbox-tray" },
                { value: "pago", label: "Pago (cancela)", icon: "inbox-tray" },
              ]}
            />
          </div>

          {/* Monto */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Monto</FieldLabel>
            <MoneyInput value={monto} onChange={setMonto} autoFocus required />
          </div>

          {/* Concepto */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Concepto</FieldLabel>
            <IconTextarea icon="receipt" value={concepto} onChange={(e) => setConcepto(e.target.value)} rows={2} placeholder="Factura, gasto, fondeo, pago…" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!montoNum || !concepto.trim()}
            submitLabel="Registrar"
            loadingLabel="Registrando…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Alta / edición de proveedor ──────────────────────────────────────────── */

// Validaciones de formato del proveedor.
const RE_PROV = {
  cuit: /^\d{2}-?\d{8}-?\d$/,            // CUIT/CUIL: 11 dígitos (guiones opcionales)
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  tel: /^\d{10}$/,                      // teléfono AR: 10 dígitos exactos
};
/** Máscara de CUIT en vivo: solo dígitos, formateados XX-XXXXXXXX-X (bloquea letras). */
function maskCuit(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}
/** Teléfono: SOLO dígitos, 10 (formato AR). */
function maskTel(v: string) {
  return v.replace(/\D/g, "").slice(0, 10);
}

function ProveedorForm({ open, proveedor, onClose }: { open: boolean; proveedor: Proveedor | null; onClose: (ok?: boolean) => void }) {
  const confirm = useConfirm();
  const toast = useToast();
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
  const [errs, setErrs] = useState<Record<string, string>>({});
  const clearErr = (k: string) => setErrs((p) => (p[k] ? { ...p, [k]: "" } : p));

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
    setErrs({});
  }

  /** Valida formato; devuelve el mapa de errores (vacío = OK). */
  const validar = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!nombre.trim()) e.nombre = "El nombre es requerido";
    if (cuit.trim() && !RE_PROV.cuit.test(cuit.trim())) e.cuit = "CUIT inválido (11 dígitos)";
    if (email.trim() && !RE_PROV.email.test(email.trim())) e.email = "Email con formato inválido";
    if (telefono.trim() && !RE_PROV.tel.test(telefono.trim())) e.telefono = "Debe tener 10 dígitos";
    return e;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validar();
    setErrs(v);
    if (Object.keys(v).length) return;
    const ok = await confirm({
      title: editing ? "¿Guardar cambios?" : "¿Crear proveedor?",
      description: editing
        ? `Se actualizarán los datos de ${nombre.trim()}.`
        : `Se dará de alta al proveedor ${nombre.trim()}.`,
      confirmLabel: editing ? "Guardar cambios" : "Crear proveedor",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const body = { nombre, cuit, email, telefono, direccion, rubro, notas, activo };
      const res = await fetch(editing ? `/api/proveedores/${proveedor!.id}` : "/api/proveedores", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) { toast.success(editing ? `Proveedor ${nombre.trim()} actualizado` : `Proveedor ${nombre.trim()} creado`); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="w-[95vw] sm:max-w-lg sm:p-7 max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="shrink-0">
          <ModalHeader
            icon="delivery-truck"
            title={editing ? "Editar proveedor" : "Nuevo proveedor"}
            subtitle={editing ? "Actualizá los datos del proveedor." : "Registrá un proveedor para su cuenta corriente."}
          />
        </div>
        <form onSubmit={submit} className="space-y-4 overflow-y-auto pt-1" noValidate>
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>}

          {/* Identidad */}
          <Field label="Nombre / Razón social" required error={errs.nombre}>
            <IconInput icon="office-building" value={nombre} onChange={(e) => { setNombre(e.target.value); clearErr("nombre"); }} placeholder="Nombre del proveedor" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="CUIT" hint="11 dígitos" error={errs.cuit}>
              <IconInput icon="credit-card" inputMode="numeric" value={cuit} onChange={(e) => { setCuit(maskCuit(e.target.value)); clearErr("cuit"); }} placeholder="30-71234567-9" />
            </Field>
            <Field label="Rubro">
              <IconInput icon="briefcase" value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="servicios, fondeo…" />
            </Field>
          </div>

          {/* Contacto */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Email" error={errs.email}>
              <IconInput icon="envelope" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); clearErr("email"); }} placeholder="ventas@proveedor.com" />
            </Field>
            <Field label="Teléfono" error={errs.telefono}>
              <IconInput icon="mobile-phone" inputMode="tel" value={telefono} onChange={(e) => { setTelefono(maskTel(e.target.value)); clearErr("telefono"); }} placeholder="1145678900" />
            </Field>
          </div>
          <Field label="Dirección">
            <IconInput icon="round-pushpin" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle, número, localidad" />
          </Field>
          <Field label="Notas">
            <IconTextarea icon="receipt" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Observaciones…" />
          </Field>
          <Field label="Estado">
            <IconSelect icon="check-mark-button" value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </IconSelect>
          </Field>

          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            disabled={!nombre.trim()}
            submitLabel={editing ? "Guardar cambios" : "Crear"}
          />
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
