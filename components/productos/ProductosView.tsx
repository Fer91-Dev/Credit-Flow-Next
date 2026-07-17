"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, ImagePlus, Loader2, X, Link as LinkIcon, LayoutGrid, List, ArrowDownToLine, SlidersHorizontal, Image as ImageIcon, ChevronLeft, ChevronRight, Info, GripVertical, Star } from "lucide-react";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { useProductos, useProducto, KEYS, type Producto, type MovimientoStock } from "@/lib/swr";
import { parseMontoInput, formatFecha, formatFechaHora, formatCreditoNumero } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Emoji } from "@/components/ui/Emoji";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ModalHeader, MoneyInput, FormActions, FieldLabel } from "@/components/ui/form-kit";
import { MAX_FOTOS_PRODUCTO } from "@/lib/productos";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

/** Estado de stock de un producto → badge semántico. */
function stockBadge(p: Producto): { label: string; variant: "success" | "warning" | "destructive" | "muted" } {
  if (p.stock <= 0) return { label: "Sin stock", variant: "destructive" };
  if (p.stock_minimo != null && p.stock <= p.stock_minimo) return { label: `Bajo · ${p.stock} u.`, variant: "warning" };
  return { label: `${p.stock} u.`, variant: "success" };
}

/** Tipo de movimiento de stock → etiqueta + badge (para el kardex). */
function kardexBadge(tipo: MovimientoStock["tipo"]): { label: string; variant: "success" | "warning" | "destructive" | "muted" | "primary" } {
  switch (tipo) {
    case "alta_inicial": return { label: "Alta inicial", variant: "muted" };
    case "entrada": return { label: "Entrada", variant: "success" };
    case "venta_credito": return { label: "Venta a crédito", variant: "primary" };
    case "devolucion_anulacion": return { label: "Devolución", variant: "warning" };
    case "ajuste": return { label: "Ajuste", variant: "warning" };
    default: return { label: tipo, variant: "muted" };
  }
}

/** Estado de un crédito → badge (para la lista de créditos en la ficha). */
function creditoEstadoBadge(estado: string): { label: string; variant: "success" | "warning" | "destructive" | "muted" | "primary" } {
  switch (estado) {
    case "activo": return { label: "Activo", variant: "primary" };
    case "pagado": return { label: "Pagado", variant: "success" };
    case "anulado": return { label: "Anulado", variant: "muted" };
    case "vencido": return { label: "Vencido", variant: "destructive" };
    case "refinanciado": return { label: "Refinanciado", variant: "warning" };
    default: return { label: estado, variant: "muted" };
  }
}

export function ProductosView() {
  const { productos, categorias, unidadesStock, valorInventario, isLoading, error, mutate } = useProductos();
  const confirm = useConfirm();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Producto | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Tarjeta clickeada: muestra skeleton mientras la ficha carga (feedback inmediato).
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const abrirDetalle = (p: Producto) => { setLoadingId(p.id); setDetailId(p.id); };
  const [q, setQ] = useState("");
  const [catFiltro, setCatFiltro] = useState("");
  const [soloActivos, setSoloActivos] = useState(false);
  // Vista tarjetas/tabla (preferencia del operador, persistida).
  const [vista, setVista] = useState<"cards" | "tabla">("cards");
  useEffect(() => {
    const v = localStorage.getItem("cf:productosVista");
    if (v === "cards" || v === "tabla") setVista(v);
  }, []);
  const cambiarVista = (v: "cards" | "tabla") => { setVista(v); localStorage.setItem("cf:productosVista", v); };

  const bajoStock = useMemo(
    () => productos.filter((p) => p.activo && (p.stock <= 0 || (p.stock_minimo != null && p.stock <= p.stock_minimo))).length,
    [productos],
  );

  const filtrados = useMemo(() => {
    const term = q.trim().toLowerCase();
    return productos.filter((p) => {
      if (soloActivos && !p.activo) return false;
      if (catFiltro && p.categoria !== catFiltro) return false;
      if (term && !p.nombre.toLowerCase().includes(term) && !(p.sku ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [productos, q, catFiltro, soloActivos]);

  const refrescar = () => { mutate(); globalMutate(KEYS.productos); };

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (p: Producto) => { setEditing(p); setFormOpen(true); };

  const handleFormClose = (ok?: boolean) => {
    setFormOpen(false); setEditing(null);
    if (ok) refrescar();
  };

  const handleDelete = async (p: Producto) => {
    const ok = await confirm({
      title: "¿Eliminar producto?",
      description: `Se eliminará "${p.nombre}" del catálogo. Si tiene créditos asociados, no se podrá borrar (desactivalo).`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/productos/${p.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) { toast.error(json?.error || "No se pudo eliminar el producto"); return; }
    refrescar();
    toast.success(`Producto "${p.nombre}" eliminado`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="package"
        title="Productos"
        subtitle="Inventario de productos vendidos a crédito"
        accent="primary"
      />

      {/* Toolbar (la regla: el header solo lleva SystemControls; los CTA van acá) */}
      <div className="flex flex-wrap items-start gap-2">
        <BuscadorF3
          value={q}
          onChange={setQ}
          placeholder="Buscar por nombre o SKU…"
          onF3={() => setQ("")}
          f3Hint="para limpiar el filtro y ver todos"
          className="flex-1 min-w-[200px] sm:max-w-sm"
        />
        {/* Filtros inline (son pocos y entran cómodos) + acciones, alineados a la derecha */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={catFiltro}
            onChange={(e) => setCatFiltro(e.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => setSoloActivos((v) => !v)}
            className={`h-10 rounded-lg border px-3 text-sm font-medium transition-colors ${soloActivos ? "border-primary/30 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted/20"}`}
          >
            Solo activos
          </button>
          {/* Toggle tarjetas / tabla */}
          <div className="flex h-10 items-center rounded-lg border border-border p-0.5">
            <button
              onClick={() => cambiarVista("cards")}
              title="Ver como tarjetas"
              className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${vista === "cards" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/20"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => cambiarVista("tabla")}
              title="Ver como tabla"
              className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${vista === "tabla" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/20"}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={openNew}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" /> Nuevo producto
          </button>
        </div>
      </div>

      {isLoading ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar productos: {error.message}
        </div>
      ) : (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="package" label="Productos" value={String(productos.length)} accent="primary" />
            <KpiCard icon="counterclockwise-arrows-button" label="Unidades en stock" value={n0(unidadesStock)} accent="primary" mono />
            <KpiCard icon="money-bag" label="Valor de inventario" value={`$${n0(valorInventario)}`} accent="success" mono sub="precio × stock" />
            <KpiCard icon="warning" label="Bajo / sin stock" value={String(bajoStock)} accent={bajoStock > 0 ? "warning" : "muted"} />
          </div>

          {productos.length === 0 ? (
            <EmptyState onNew={openNew} />
          ) : (
          <section className="space-y-3">
            {/* Título de la lista: deja claro que esto es el stock/inventario */}
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Emoji name="package" className="h-4 w-4" />
              <h2 className="text-sm font-semibold text-foreground">Stock de productos</h2>
            </div>

            {filtrados.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
              Ningún producto coincide con la búsqueda.
            </div>
          ) : vista === "cards" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtrados.map((p) => (
                <ProductoCard
                  key={p.id}
                  producto={p}
                  loading={loadingId === p.id}
                  onOpen={() => abrirDetalle(p)}
                  onEdit={() => openEdit(p)}
                  onDelete={() => handleDelete(p)}
                />
              ))}
            </div>
          ) : (
            <ProductosTabla
              productos={filtrados}
              loadingId={loadingId}
              onOpen={abrirDetalle}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          )}
          </section>
          )}
        </div>
      )}

      <ProductoForm open={formOpen} producto={editing} categorias={categorias} onClose={handleFormClose} />
      <ProductoDetailDialog
        id={detailId}
        onClose={() => { setDetailId(null); setLoadingId(null); }}
        onReady={() => setLoadingId(null)}
        onEdit={(p) => { setDetailId(null); setLoadingId(null); openEdit(p); }}
        onDeleted={() => { setDetailId(null); setLoadingId(null); refrescar(); }}
        onStockChange={refrescar}
      />
    </div>
  );
}

/* ── Tarjeta de producto (estilo credencial con foto) ─────────────────────── */

function ProductoCard({ producto, loading, onOpen, onEdit, onDelete }: { producto: Producto; loading?: boolean; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const badge = stockBadge(producto);
  const fotosCount = producto.imagenes?.length || (producto.imagen_url ? 1 : 0);
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={`group relative rounded-xl bg-card border border-border overflow-hidden flex flex-col cursor-pointer transition-all duration-200 ease-out hover:-translate-y-1 hover:border-primary/50 hover:shadow-xl hover:shadow-black/25 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${!producto.activo ? "opacity-50" : ""}`}
    >
      {/* Skeleton de carga (al clickear, mientras se abre la ficha) */}
      {loading && (
        <div className="absolute inset-0 z-20 flex flex-col bg-card">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="p-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-6 w-1/3" />
          </div>
        </div>
      )}

      {/* Foto */}
      <div className="relative aspect-[4/3] bg-gradient-to-br from-muted/30 to-muted/5 flex items-center justify-center overflow-hidden">
        {producto.imagen_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={producto.imagen_url} alt={producto.nombre} className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110" />
        ) : (
          <Emoji name="package" className="h-12 w-12 opacity-40 transition-transform duration-500 ease-out group-hover:scale-110" />
        )}
        <div className="absolute top-2 right-2">
          <StatusBadge label={badge.label} variant={badge.variant} />
        </div>
        {!producto.activo && (
          <div className="absolute top-2 left-2">
            <StatusBadge label="Inactivo" variant="muted" />
          </div>
        )}
        {fotosCount > 1 && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur-sm">
            <ImageIcon className="h-3 w-3" /> {fotosCount}
          </span>
        )}
      </div>
      {/* Datos */}
      <div className="p-4 flex flex-col gap-1 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-foreground leading-tight transition-colors group-hover:text-primary">{producto.nombre}</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {producto.categoria && <span>{producto.categoria}</span>}
          {producto.sku && <span className="font-mono">· {producto.sku}</span>}
        </div>
        <p className="mt-1 font-mono font-bold text-lg text-foreground">${n0(producto.precio)}</p>
        {producto.descripcion && (
          <p className="text-xs text-muted-foreground/80 line-clamp-2 mt-0.5">{producto.descripcion}</p>
        )}
        {/* Acciones (no propagan el click de la tarjeta) */}
        <div className="mt-auto pt-3 flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} title="Editar" className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} title="Eliminar" className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Vista de tabla (operativa, densa) ────────────────────────────────────── */

function ProductosTabla({
  productos, loadingId, onOpen, onEdit, onDelete,
}: { productos: Producto[]; loadingId: string | null; onOpen: (p: Producto) => void; onEdit: (p: Producto) => void; onDelete: (p: Producto) => void }) {
  const columns: Column<Producto>[] = [
    {
      header: "Producto",
      cell: (p) => (
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-lg border border-border bg-muted/30 overflow-hidden flex items-center justify-center">
            {p.imagen_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imagen_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Emoji name="package" className="h-5 w-5 opacity-40" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{p.nombre}</p>
            {p.sku && <p className="text-[11px] font-mono text-muted-foreground">{p.sku}</p>}
          </div>
        </div>
      ),
    },
    { header: "Categoría", className: "hidden lg:table-cell", cell: (p) => <span className="text-muted-foreground">{p.categoria || "—"}</span> },
    { header: "Precio", mono: true, cell: (p) => <span className="text-foreground">${n0(p.precio)}</span> },
    { header: "Stock", align: "center", cell: (p) => { const b = stockBadge(p); return <StatusBadge label={b.label} variant={b.variant} />; } },
    { header: "Estado", align: "center", className: "hidden md:table-cell", cell: (p) => <StatusBadge label={p.activo ? "Activo" : "Inactivo"} variant={p.activo ? "success" : "muted"} /> },
    {
      header: "Acciones", align: "right",
      cell: (p) => (
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onEdit(p)} title="Editar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(p)} title="Eliminar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={productos}
      rowKey={(p) => p.id}
      onRowClick={onOpen}
      loadingRowKey={loadingId}
      zebra
    />
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Emoji name="package" className="h-8 w-8 opacity-70" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Todavía no cargaste productos</p>
        <p className="text-xs text-muted-foreground/60 max-w-sm leading-relaxed">
          Cargá los productos de tu inventario para venderlos a crédito. El precio se toma como capital y el stock se descuenta al otorgar.
        </p>
      </div>
      <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
        <Plus className="h-4 w-4" /> Nuevo producto
      </button>
    </div>
  );
}

/* ── Ficha de detalle del producto (operativa) ────────────────────────────── */

function ProductoDetailDialog({
  id, onClose, onReady, onEdit, onDeleted, onStockChange,
}: { id: string | null; onClose: () => void; onReady: () => void; onEdit: (p: Producto) => void; onDeleted: () => void; onStockChange: () => void }) {
  const { producto, isLoading, mutate } = useProducto(id);
  const confirm = useConfirm();
  const toast = useToast();
  const [movMode, setMovMode] = useState<"entrada" | "ajuste" | null>(null);
  const [carrusel, setCarrusel] = useState<number | null>(null);
  // Galería para el carrusel (imagenes; fallback a la portada de productos viejos).
  const galeria = producto?.imagenes?.length ? producto.imagenes : (producto?.imagen_url ? [producto.imagen_url] : []);

  // Avisa al padre cuando la ficha terminó de cargar → apaga el skeleton de la tarjeta.
  useEffect(() => {
    if (id && producto && !isLoading) onReady();
  }, [id, producto, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!producto) return;
    const ok = await confirm({
      title: "¿Eliminar producto?",
      description: `Se eliminará "${producto.nombre}" del catálogo.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/productos/${producto.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) { toast.error(json?.error || "No se pudo eliminar el producto"); return; }
    toast.success(`Producto "${producto.nombre}" eliminado`);
    onDeleted();
  };

  const badge = producto ? stockBadge(producto) : null;

  return (
    <>
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{producto?.nombre ?? "Producto"}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading || !producto ? (
            <div className="space-y-3">
              <Skeleton className="h-44 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Cabecera: foto (click → carrusel) + datos clave */}
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  type="button"
                  onClick={() => { if (galeria.length) setCarrusel(0); }}
                  disabled={!galeria.length}
                  className="group/cover relative h-40 w-full sm:w-40 shrink-0 rounded-xl border border-border bg-gradient-to-br from-muted/30 to-muted/5 overflow-hidden flex items-center justify-center enabled:cursor-zoom-in"
                >
                  {producto.imagen_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={producto.imagen_url} alt={producto.nombre} className="h-full w-full object-cover transition-transform duration-300 group-hover/cover:scale-105" />
                  ) : (
                    <Emoji name="package" className="h-14 w-14 opacity-40" />
                  )}
                  {galeria.length > 1 && (
                    <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground">
                      <ImageIcon className="h-3 w-3" /> {galeria.length}
                    </span>
                  )}
                </button>
                <div className="flex flex-col gap-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {badge && <StatusBadge label={badge.label} variant={badge.variant} />}
                    <StatusBadge label={producto.activo ? "Activo" : "Inactivo"} variant={producto.activo ? "success" : "muted"} />
                    {producto.categoria && <StatusBadge label={producto.categoria} variant="muted" />}
                  </div>
                  <p className="text-2xl font-bold font-mono text-foreground">${n0(producto.precio)}</p>
                  <p className="text-[11px] text-muted-foreground">Precio = capital del crédito · el cliente se lleva el producto</p>
                  {producto.sku && <p className="text-xs text-muted-foreground font-mono">SKU: {producto.sku}</p>}
                  {producto.descripcion && <p className="text-sm text-muted-foreground/90 mt-1">{producto.descripcion}</p>}
                </div>
              </div>

              {/* Métricas operativas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <DetailStat label="Stock disponible" value={`${n0(producto.stock)} u.`} accent={producto.stock <= 0 ? "destructive" : "foreground"} />
                <DetailStat label="Stock mínimo" value={producto.stock_minimo != null ? `${n0(producto.stock_minimo)} u.` : "—"} />
                <DetailStat label="Valor en stock" value={`$${n0(producto.precio * producto.stock)}`} accent="success" />
                <DetailStat label="Créditos asociados" value={String(producto.creditos_count ?? 0)} />
              </div>

              <p className="text-[11px] text-muted-foreground">Alta: {formatFecha(producto.created_at)}</p>

              {/* Stock: acciones (entrada / ajuste) + kardex */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Movimientos de stock ({producto.movimientos?.length ?? 0})
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setMovMode("entrada")}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/20 transition-colors"
                    >
                      <ArrowDownToLine className="h-3.5 w-3.5 text-success" /> Entrada
                    </button>
                    <button
                      onClick={() => setMovMode("ajuste")}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/20 transition-colors"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5 text-warning" /> Ajustar
                    </button>
                  </div>
                </div>
                {!producto.movimientos || producto.movimientos.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground/60">
                    Sin movimientos registrados.
                  </p>
                ) : (
                  <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/60 max-h-64 overflow-y-auto">
                    {producto.movimientos.map((m) => {
                      const km = kardexBadge(m.tipo);
                      const signo = m.cantidad > 0 ? "+" : "";
                      return (
                        <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <StatusBadge label={km.label} variant={km.variant} />
                              {m.motivo && <span className="text-xs text-muted-foreground truncate">{m.motivo}</span>}
                            </div>
                            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                              {formatFechaHora(m.created_at)}{m.usuario_nombre ? ` · ${m.usuario_nombre}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-right">
                            <span className={`font-mono font-semibold ${m.cantidad > 0 ? "text-success" : "text-destructive"}`}>
                              {signo}{m.cantidad}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground w-14">saldo {m.stock_resultante}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Créditos donde se vendió este producto */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Créditos con este producto ({producto.creditos?.length ?? 0})
                </p>
                {!producto.creditos || producto.creditos.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground/60">
                    Todavía no se vendió a crédito.
                  </p>
                ) : (
                  <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/60">
                    {producto.creditos.map((c) => {
                      const est = creditoEstadoBadge(c.estado);
                      return (
                        <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                          <div className="min-w-0">
                            <p className="text-foreground truncate">{c.cliente}</p>
                            <p className="text-[11px] text-muted-foreground font-mono">
                              {formatCreditoNumero(c.numero)} · {formatFecha(c.fecha)}{c.cantidad && c.cantidad > 1 ? ` · ×${c.cantidad}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-foreground">${n0(c.monto)}</span>
                            <StatusBadge label={est.label} variant={est.variant} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Acciones */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
                <button
                  onClick={() => onEdit(producto)}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <Pencil className="h-4 w-4" /> Editar
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {producto && (
      <MovimientoStockModal
        mode={movMode}
        producto={producto}
        onClose={(changed) => { setMovMode(null); if (changed) { mutate(); onStockChange(); } }}
      />
    )}

    <FotoCarrusel
      imagenes={galeria}
      startIndex={carrusel}
      alt={producto?.nombre ?? ""}
      onClose={() => setCarrusel(null)}
    />
    </>
  );
}

/* ── Carrusel / lightbox de fotos del producto ────────────────────────────── */

function FotoCarrusel({
  imagenes, startIndex, alt, onClose,
}: { imagenes: string[]; startIndex: number | null; alt: string; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const open = startIndex != null;

  // Posiciona en la foto clickeada al abrir.
  useEffect(() => { if (startIndex != null) setIdx(startIndex); }, [startIndex]);

  const total = imagenes.length;
  const ir = (delta: number) => setIdx((i) => (i + delta + total) % total);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") ir(1);
      else if (e.key === "ArrowLeft") ir(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, total]); // eslint-disable-line react-hooks/exhaustive-deps

  if (total === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[96vw] sm:max-w-4xl p-0 gap-0 overflow-hidden bg-card flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>Fotos de {alt}</DialogTitle>
        </DialogHeader>
        <div className="relative flex items-center justify-center bg-black/60 h-[55vh] sm:h-[65vh]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imagenes[idx]} alt={alt} className="max-h-full max-w-full object-contain select-none" draggable={false} />

          {total > 1 && (
            <>
              <button
                type="button" onClick={() => ir(-1)} title="Anterior"
                className="absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-background/70 text-foreground hover:bg-background transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button" onClick={() => ir(1)} title="Siguiente"
                className="absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-background/70 text-foreground hover:bg-background transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium text-foreground">
                {idx + 1} / {total}
              </span>
            </>
          )}
        </div>

        {/* Miniaturas */}
        {total > 1 && (
          <div className="flex justify-center gap-2 overflow-x-auto border-t border-border p-3">
            {imagenes.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setIdx(i)}
                className={`h-14 w-14 shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${i === idx ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Modal de movimiento de stock (entrada / ajuste) ──────────────────────── */

function MovimientoStockModal({
  mode, producto, onClose,
}: { mode: "entrada" | "ajuste" | null; producto: Producto; onClose: (changed?: boolean) => void }) {
  const toast = useToast();
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = mode ? `${mode}:${producto.id}` : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setValor(mode === "ajuste" ? String(producto.stock) : "");
    setMotivo("");
    setError(null);
  }

  const esAjuste = mode === "ajuste";
  const valorNum = parseInt(valor || "", 10);
  const resultante = esAjuste ? (isNaN(valorNum) ? producto.stock : valorNum) : producto.stock + (isNaN(valorNum) ? 0 : valorNum);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNaN(valorNum) || (esAjuste ? valorNum < 0 : valorNum <= 0)) {
      setError(esAjuste ? "Ingresá el nuevo conteo (0 o más)" : "Ingresá una cantidad mayor a 0");
      return;
    }
    if (esAjuste && !motivo.trim()) { setError("El ajuste requiere un motivo"); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/productos/${producto.id}/movimientos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: mode, cantidad: valorNum, motivo: motivo.trim() || undefined }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(esAjuste ? `Stock ajustado a ${json.data.stock} u.` : `Entrada registrada · stock ${json.data.stock} u.`);
        onClose(true);
      } else setError(json.error);
    } catch {
      setError("No se pudo registrar el movimiento");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!mode} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="w-[95vw] sm:max-w-lg sm:p-7">
        <ModalHeader
          icon={esAjuste ? "counterclockwise-arrows-button" : "package"}
          title={esAjuste ? "Ajustar stock" : "Registrar entrada"}
          subtitle={esAjuste
            ? `Corregí el stock de "${producto.nombre}" por conteo físico. Queda registrado con motivo.`
            : `Sumá unidades al inventario de "${producto.nombre}".`}
        />
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>}

          <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Stock actual</span>
            <span className="font-mono font-semibold text-foreground">{producto.stock} u.</span>
          </div>

          <Field label={esAjuste ? "Nuevo conteo (unidades)" : "Cantidad que ingresa"} required>
            <Input
              type="number" min={esAjuste ? "0" : "1"} value={valor}
              onChange={(e) => { setError(null); setValor(e.target.value); }}
              autoFocus className="font-mono tabular-nums text-lg" placeholder={esAjuste ? String(producto.stock) : "0"}
            />
          </Field>

          <Field label="Motivo" required={esAjuste} hint={esAjuste ? "Ej: conteo físico, rotura, merma" : "Ej: compra a proveedor (opcional)"}>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={esAjuste ? "Motivo del ajuste" : "Nota / proveedor (opcional)"} />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Stock resultante</span>
            <span className={`font-mono font-bold ${resultante < 0 ? "text-destructive" : "text-foreground"}`}>{resultante} u.</span>
          </div>

          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            disabled={resultante < 0}
            submitLabel={esAjuste ? "Ajustar stock" : "Registrar entrada"}
            loadingLabel="Registrando…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailStat({ label, value, accent }: { label: string; value: string; accent?: "foreground" | "success" | "destructive" }) {
  const color = accent === "success" ? "text-success" : accent === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-xl bg-card border border-border p-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
      <p className={`text-base font-bold font-mono mt-1 ${color}`}>{value}</p>
    </div>
  );
}

/* ── Alta / edición de producto ───────────────────────────────────────────── */

function ProductoForm({
  open, producto, categorias, onClose,
}: { open: boolean; producto: Producto | null; categorias: string[]; onClose: (ok?: boolean) => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const editing = !!producto;
  const fileRef = useRef<HTMLInputElement>(null);

  // Al editar, avisar si el producto ya tiene créditos vivos: cambiar el precio afecta
  // SOLO a créditos futuros (los otorgados usan su monto snapshot, no cambian).
  const { producto: fichaEdit } = useProducto(editing ? (producto?.id ?? null) : null);
  const creditosVivos = (fichaEdit?.creditos ?? []).filter((c) => c.estado === "activo" || c.estado === "vencido").length;

  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [sku, setSku] = useState("");
  const [precio, setPrecio] = useState("");
  const [stock, setStock] = useState("");
  const [stockMin, setStockMin] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [activo, setActivo] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? (producto?.id ?? "new") : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setNombre(producto?.nombre ?? "");
    setCategoria(producto?.categoria ?? "");
    setSku(producto?.sku ?? "");
    setPrecio(producto ? new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(producto.precio) : "");
    setStock(producto != null ? String(producto.stock) : "");
    setStockMin(producto?.stock_minimo != null ? String(producto.stock_minimo) : "");
    setDescripcion(producto?.descripcion ?? "");
    // Galería: usa imagenes; fallback a la portada suelta (productos viejos).
    setImagenes(producto?.imagenes?.length ? producto.imagenes : (producto?.imagen_url ? [producto.imagen_url] : []));
    setUrlInput("");
    setActivo(producto?.activo ?? true);
    setUploading(false);
    setError(null);
  }

  const precioNum = parseMontoInput(precio);
  const stockNum = parseInt(stock || "0", 10);
  const lleno = imagenes.length >= MAX_FOTOS_PRODUCTO;

  const agregarImagen = (url: string) => {
    const u = url.trim();
    if (!u) return;
    setImagenes((prev) => (prev.includes(u) || prev.length >= MAX_FOTOS_PRODUCTO ? prev : [...prev, u]));
  };
  const quitarImagen = (idx: number) => setImagenes((prev) => prev.filter((_, i) => i !== idx));
  const hacerPortada = (idx: number) => setImagenes((prev) => (idx === 0 ? prev : [prev[idx], ...prev.filter((_, i) => i !== idx)]));
  // Reordena moviendo el elemento `from` a la posición `to` (drag & drop). La posición 0 es la portada.
  const moverImagen = (from: number, to: number) => setImagenes((prev) => {
    if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
    const next = [...prev];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  const handleFiles = async (files: FileList) => {
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (imagenes.length >= MAX_FOTOS_PRODUCTO) break;
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/productos/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (json.ok) agregarImagen(json.data.url);
        else { setError(json.error || "No se pudo subir la imagen"); break; }
      }
    } catch {
      setError("No se pudo subir la imagen");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) { setError("El nombre es requerido"); return; }
    if (precioNum <= 0) { setError("Ingresá un precio válido"); return; }
    const ok = await confirm({
      title: editing ? "¿Guardar cambios?" : "¿Crear producto?",
      description: editing ? `Se actualizará "${nombre.trim()}".` : `Se agregará "${nombre.trim()}" al inventario.`,
      confirmLabel: editing ? "Guardar cambios" : "Crear producto",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        nombre, categoria, sku, descripcion,
        precio: precioNum,
        stock_minimo: stockMin.trim() === "" ? null : parseInt(stockMin, 10),
        imagenes,
        activo,
      };
      // El stock solo se fija al CREAR (stock inicial). En edición cambia vía kardex.
      if (!editing) body.stock = isNaN(stockNum) ? 0 : stockNum;
      const res = await fetch(editing ? `/api/productos/${producto!.id}` : "/api/productos", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) { toast.success(editing ? `Producto "${nombre.trim()}" actualizado` : `Producto "${nombre.trim()}" creado`); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="w-[95vw] sm:max-w-2xl sm:p-7 max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="shrink-0">
          <ModalHeader
            icon="package"
            title={editing ? "Editar producto" : "Nuevo producto"}
            subtitle={editing ? "Actualizá los datos del producto." : "Cargá un producto del inventario para venderlo a crédito."}
          />
        </div>
        <form onSubmit={submit} className="space-y-4 overflow-y-auto pt-1">
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>}

          {/* Fotos — galería de hasta 5 (la 1ª es la portada) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <FieldLabel>Fotos ({imagenes.length}/{MAX_FOTOS_PRODUCTO})</FieldLabel>
              {imagenes.length > 1 && (
                <span className="text-[11px] text-muted-foreground">Arrastrá para ordenar · ⭐ elige la portada</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2.5">
              {imagenes.map((url, idx) => (
                <div
                  key={url}
                  draggable
                  onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDrop={(e) => { e.preventDefault(); const from = dragIdx ?? Number(e.dataTransfer.getData("text/plain")); moverImagen(from, idx); setDragIdx(null); }}
                  onDragEnd={() => setDragIdx(null)}
                  title="Arrastrá para reordenar"
                  className={`group/foto relative h-24 w-24 rounded-lg border bg-muted/30 overflow-hidden cursor-grab active:cursor-grabbing transition-all ${
                    dragIdx === idx ? "opacity-40 ring-2 ring-primary" : dragIdx !== null ? "ring-1 ring-primary/30" : ""
                  } ${idx === 0 ? "border-primary/50 ring-1 ring-primary/40" : "border-border"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover pointer-events-none select-none" />

                  {/* Handle de arrastre (hint) */}
                  <span className="absolute top-0.5 left-0.5 flex h-5 w-5 items-center justify-center rounded bg-background/70 text-muted-foreground opacity-0 group-hover/foto:opacity-100 transition-opacity">
                    <GripVertical className="h-3 w-3" />
                  </span>

                  {/* Quitar */}
                  <button
                    type="button"
                    onClick={() => quitarImagen(idx)}
                    title="Quitar"
                    className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>

                  {/* Portada (idx 0) o botón elegir portada (hover) */}
                  {idx === 0 ? (
                    <span className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-1 bg-primary/85 text-[9px] font-semibold text-primary-foreground py-0.5">
                      <Star className="h-2.5 w-2.5 fill-current" /> Portada
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => hacerPortada(idx)}
                      title="Elegir como portada"
                      className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-1 bg-background/85 text-[9px] font-medium text-foreground py-0.5 opacity-0 group-hover/foto:opacity-100 transition-all hover:bg-primary/85 hover:text-primary-foreground"
                    >
                      <Star className="h-2.5 w-2.5" /> Portada
                    </button>
                  )}
                </div>
              ))}
              {/* Botón agregar (subir archivo) */}
              {!lleno && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <ImagePlus className="h-5 w-5" />}
                  <span className="text-[10px]">Subir</span>
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
            />
            {/* Agregar por URL */}
            {!lleno && (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarImagen(urlInput); setUrlInput(""); } }}
                    placeholder="…o pegá la URL de una imagen"
                    className="h-10 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { agregarImagen(urlInput); setUrlInput(""); }}
                  className="rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted/20 transition-colors"
                >
                  Agregar
                </button>
              </div>
            )}
          </div>

          <Field label="Nombre" required>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del producto" required />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Categoría">
              <Input
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Electrodomésticos…"
                list="prod-categorias"
              />
              <datalist id="prod-categorias">
                {categorias.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="SKU / código">
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="opcional" />
            </Field>
          </div>

          <Field label="Precio ($)" required hint="Se toma como capital del crédito">
            <MoneyInput value={precio} onChange={setPrecio} required />
          </Field>
          {editing && creditosVivos > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              <Info className="h-4 w-4 shrink-0 mt-px" />
              <span>
                Este producto tiene <strong>{creditosVivos}</strong> crédito{creditosVivos !== 1 ? "s" : ""} activo{creditosVivos !== 1 ? "s" : ""}.
                Cambiar el precio aplica solo a créditos <strong>futuros</strong>; los ya otorgados conservan su monto.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {editing ? (
              <Field label="Stock actual" hint="Se ajusta desde la ficha (entrada/ajuste)">
                <div className="flex h-12 items-center rounded-lg border border-border bg-muted/20 px-3 font-mono tabular-nums text-foreground">
                  {producto?.stock ?? 0} u.
                </div>
              </Field>
            ) : (
              <Field label="Stock inicial (unidades)" required>
                <Input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" className="font-mono tabular-nums" />
              </Field>
            )}
            <Field label="Stock mínimo" hint="Alerta de bajo stock">
              <Input type="number" min="0" value={stockMin} onChange={(e) => setStockMin(e.target.value)} placeholder="opcional" className="font-mono tabular-nums" />
            </Field>
          </div>

          <Field label="Descripción">
            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle, modelo, características…" />
          </Field>

          <Field label="Estado">
            <Select value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </Select>
          </Field>

          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            disabled={!nombre.trim() || precioNum <= 0 || uploading}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
    </div>
  );
}
