"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { Search, User, Phone, Mail, ArrowLeft, Plus, ChevronRight, X, Clock } from "lucide-react";
import { ClienteForm } from "./ClienteForm";
import { ClienteDetail } from "./ClienteDetail";
import { useClientes, KEYS, type Cliente } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader } from "@/components/ui/form-kit";
import { nombreCompleto } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

type Sel = { id: string; nombre: string };

const DIAS_INACTIVIDAD = 90;
const MS_INACTIVIDAD = DIAS_INACTIVIDAD * 24 * 60 * 60 * 1000;

/** Un cliente está inactivo si su último movimiento supera los 90 días. */
function esInactivo(c: Cliente): boolean {
  if (!c.ultimo_movimiento) return false;
  return Date.now() - new Date(c.ultimo_movimiento).getTime() > MS_INACTIVIDAD;
}

/**
 * Clientes con flujo "buscar primero" (igual que Pagos): no se lista nada hasta
 * ingresar un DNI o nombre; al elegir, se ve la ficha 360 a pantalla completa,
 * con editar/eliminar. El alta de clientes está siempre disponible.
 */
export function ClientesTable() {
  const { clientes, isLoading, mutate } = useClientes({ scored: true });
  const { mutate: globalMutate } = useSWRConfig();
  const confirm = useConfirm();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [soloInactivos, setSoloInactivos] = useState(false);
  const [verTodos, setVerTodos] = useState(false); // F3 en el buscador: lista completa A→Z
  const [selected, setSelected] = useState<Sel | null>(null);
  const [dialogOpen, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Búsqueda DNI-aware: nombre o documento (también en forma "solo dígitos").
  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, "");
    return clientes.filter((c) => {
      const nombre = nombreCompleto(c).toLowerCase();
      const doc = (c.documento || "").toLowerCase();
      const docDigits = doc.replace(/\D/g, "");
      const match = nombre.includes(q) || doc.includes(q) || (qDigits.length > 0 && docDigits.includes(qDigits));
      return match && (!soloInactivos || esInactivo(c));
    });
  }, [clientes, query, soloInactivos]);

  // Lista de inactivos (+90 días sin movimiento), independiente de la búsqueda.
  const inactivos = useMemo(
    () => clientes.filter(esInactivo).sort((a, b) =>
      new Date(a.ultimo_movimiento ?? 0).getTime() - new Date(b.ultimo_movimiento ?? 0).getTime()
    ),
    [clientes],
  );

  // Todos los clientes ordenados alfabéticamente (para la vista "ver todos" con F3).
  // Respeta el filtro de inactivos si está activo.
  const todosOrdenados = useMemo(
    () =>
      clientes
        .filter((c) => !soloInactivos || esInactivo(c))
        .sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), "es", { sensitivity: "base" })),
    [clientes, soloInactivos],
  );

  const elegir = (c: Cliente) => { setSelected({ id: c.id, nombre: nombreCompleto(c) }); setQuery(""); setVerTodos(false); };

  const openNew = () => { setEditingId(null); setDialog(true); };
  const openEdit = (id: string) => { setEditingId(id); setDialog(true); };

  const handleFormClose = (success?: boolean, creado?: { id: string; nombre: string }) => {
    const wasEditing = editingId;
    setDialog(false); setEditingId(null);
    if (!success) return;
    mutate(); globalMutate(KEYS.dashboard);
    if (wasEditing) globalMutate(`/api/clientes/${wasEditing}`); // refrescar la ficha abierta
    if (creado) setSelected({ id: creado.id, nombre: nombreCompleto(creado) }); // saltar a la ficha del nuevo
  };

  const handleDelete = async (id: string, nombre: string) => {
    const ok = await confirm({
      title: "¿Eliminar cliente?",
      description: `Se marcará a ${nombre} como inactivo. Sus créditos asociados se conservan.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;

    let fallo = false;
    let motivo: string | null = null;
    await mutate(
      async (current) => {
        const res = await fetch(`/api/clientes/${id}`, { method: "DELETE" });
        if (!res.ok) {
          fallo = true;
          // Rescatar el mensaje del backend (ej. 409: tiene N créditos activos).
          motivo = (await res.json().catch(() => null))?.error ?? null;
          throw new Error("delete failed");
        }
        return { clientes: (current?.clientes ?? []).filter((c) => c.id !== id) };
      },
      { optimisticData: { clientes: clientes.filter((c) => c.id !== id) }, rollbackOnError: true },
    ).catch(() => {});
    if (fallo) { toast.error(motivo ?? "No se pudo eliminar el cliente"); return; }
    globalMutate(KEYS.dashboard);
    toast.success(`Cliente ${nombre} eliminado`);
    setSelected(null);
  };

  // Diálogo de alta/edición (compartido por ambas vistas).
  const formDialog = (
    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleFormClose(false); }}>
      <DialogContent className="w-[95vw] sm:max-w-3xl sm:p-7">
        <ModalHeader
          icon="bust-in-silhouette"
          title={editingId ? "Editar cliente" : "Nuevo cliente"}
          subtitle={editingId ? "Actualizá la ficha del cliente." : "Cargá los datos del nuevo cliente."}
        />
        <ClienteForm clienteId={editingId} onClose={handleFormClose} />
      </DialogContent>
    </Dialog>
  );

  // ── Vista de ficha (cliente seleccionado) ──
  if (selected) {
    // "Volver al listado": arriba a la izquierda, alineado al contenedor de la ficha.
    const volver = (
      <button
        onClick={() => setSelected(null)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver al listado
      </button>
    );

    return (
      <div className="space-y-6">
        {/* Header contextual de la página + acción secundaria */}
        <PageHeader
          icon="busts-in-silhouette"
          title="Clientes"
          subtitle="Ficha del cliente"
          accent="primary"
        />

        {/* Ficha centrada y con ancho controlado — protagonista de la vista */}
        <div className="mx-auto w-full max-w-4xl space-y-3">
          {volver}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ClienteDetail
              clienteId={selected.id}
              variant="cliente"
              onEditar={() => openEdit(selected.id)}
              onEliminar={() => handleDelete(selected.id, selected.nombre)}
            />
          </div>
        </div>
        {formDialog}
      </div>
    );
  }

  // ── Vista de búsqueda ──
  const q = query.trim();
  return (
    <div className="space-y-6">
      <PageHeader
        icon="busts-in-silhouette"
        title="Clientes"
        subtitle="Buscá un cliente por DNI o nombre para ver su ficha, o creá uno nuevo."
        accent="primary"
      />

      {/* Buscador */}
      <div className="relative max-w-2xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <input
          autoFocus
          type="text"
          inputMode="search"
          placeholder="DNI o nombre del cliente…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "F3") { e.preventDefault(); setVerTodos((v) => !v); return; }
            if (e.key === "Escape" && verTodos) { setVerTodos(false); return; }
            if (e.key === "Enter" && resultados.length === 1) elegir(resultados[0]);
          }}
          className="h-14 w-full rounded-xl border border-border bg-card pl-12 pr-12 text-base text-foreground placeholder:text-muted-foreground/50 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Limpiar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Hint: F3 abre la lista completa */}
      <p className="-mt-3 text-xs text-muted-foreground/60">
        Tip: presioná{" "}
        <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">F3</kbd>{" "}
        en el buscador para {verTodos ? "cerrar" : "ver"} la lista completa de clientes.
      </p>

      {/* Filtro: solo inactivos (+90 días sin movimiento) */}
      <button
        onClick={() => setSoloInactivos((v) => !v)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors w-fit ${
          soloInactivos
            ? "bg-warning/15 text-warning border border-warning/40"
            : "border border-border text-muted-foreground hover:bg-muted"
        }`}
      >
        <Clock className="h-3.5 w-3.5" />
        Solo inactivos (+{DIAS_INACTIVIDAD} días sin movimiento)
        {inactivos.length > 0 && (
          <span className={`font-mono font-bold ${soloInactivos ? "" : "text-foreground"}`}>
            {inactivos.length}
          </span>
        )}
      </button>

      {/* Estados */}
      {soloInactivos && !q ? (
        isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : inactivos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-3 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm font-semibold text-muted-foreground">Sin clientes inactivos</p>
            <p className="text-xs text-muted-foreground/50">Ningún cliente supera los {DIAS_INACTIVIDAD} días sin movimiento.</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs text-muted-foreground">
              {inactivos.length} cliente{inactivos.length !== 1 ? "s" : ""} inactivo{inactivos.length !== 1 ? "s" : ""}
            </p>
            {inactivos.slice(0, 50).map((c) => (
              <ClienteRow key={c.id} cliente={c} onClick={() => elegir(c)} mostrarInactividad />
            ))}
          </div>
        )
      ) : !q ? (
        verTodos ? (
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {todosOrdenados.length} cliente{todosOrdenados.length !== 1 ? "s" : ""} · orden alfabético
              </p>
              <button
                onClick={() => setVerTodos(false)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Cerrar
              </button>
            </div>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : todosOrdenados.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-3 text-center">
                <User className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-sm font-semibold text-muted-foreground">No hay clientes cargados todavía</p>
                <button onClick={openNew} className="mt-1 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
                  <Plus className="h-4 w-4" /> Dar de alta un cliente
                </button>
              </div>
            ) : (
              <>
                {todosOrdenados.slice(0, 100).map((c) => (
                  <ClienteRow key={c.id} cliente={c} onClick={() => elegir(c)} mostrarInactividad={soloInactivos} />
                ))}
                {todosOrdenados.length > 100 && (
                  <p className="pt-1 text-center text-xs text-muted-foreground/60">
                    Mostrando 100 de {todosOrdenados.length}. Escribí en el buscador para filtrar.
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <HeroVacio onNew={openNew} />
        )
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Buscando…</p>
      ) : resultados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-3 text-center">
          <User className="h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm font-semibold text-muted-foreground">Sin coincidencias</p>
          <p className="text-xs text-muted-foreground/50">
            {soloInactivos ? `Ningún cliente inactivo coincide con «${q}».` : `No se encontró ningún cliente para «${q}».`}
          </p>
          {!soloInactivos && (
            <button onClick={openNew} className="mt-1 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
              <Plus className="h-4 w-4" /> Dar de alta «{q}»
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs text-muted-foreground">
            {resultados.length} resultado{resultados.length !== 1 ? "s" : ""}
          </p>
          {resultados.slice(0, 20).map((c) => (
            <ClienteRow key={c.id} cliente={c} onClick={() => elegir(c)} mostrarInactividad={soloInactivos} />
          ))}
        </div>
      )}

      {formDialog}
    </div>
  );
}

/** Días transcurridos desde el último movimiento (para el detalle de inactividad). */
function diasSinMovimiento(c: Cliente): number | null {
  if (!c.ultimo_movimiento) return null;
  return Math.floor((Date.now() - new Date(c.ultimo_movimiento).getTime()) / (24 * 60 * 60 * 1000));
}

function ClienteRow({
  cliente: c,
  onClick,
  mostrarInactividad,
}: {
  cliente: Cliente;
  onClick: () => void;
  mostrarInactividad?: boolean;
}) {
  const dias = mostrarInactividad ? diasSinMovimiento(c) : null;
  const activo = c.estado === "activo";
  return (
    <button
      onClick={onClick}
      className="group relative flex w-full items-center gap-3.5 overflow-hidden rounded-xl border border-border bg-card py-2.5 pl-4 pr-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/10"
    >
      {/* Acento de color a la izquierda */}
      <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-success" />

      {/* Avatar TailGrids (con dot de estado activo/inactivo) */}
      <Avatar name={nombreCompleto(c)} size="md" status={activo ? "online" : "offline"} />

      {/* Datos del titular */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-foreground">{nombreCompleto(c)}</p>
          <StatusBadge label={c.estado} variant={activo ? "success" : "muted"} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          {c.documento && (
            <span className="flex items-baseline gap-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-primary/70">DNI</span>
              <span className="font-mono font-medium text-foreground">{c.documento}</span>
            </span>
          )}
          {c.telefono && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{c.telefono}</span>}
          {!c.documento && !c.telefono && c.email && <span className="flex items-center gap-1 truncate text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</span>}
          {dias !== null && <span className="flex items-center gap-1 text-warning"><Clock className="h-3 w-3" />{dias}d</span>}
        </div>
      </div>

      {/* Score + chevron */}
      <ScoreBadge score={c.score} size="sm" />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

function HeroVacio({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Search className="h-7 w-7 text-primary/60" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Buscá un cliente para empezar</p>
        <p className="text-xs text-muted-foreground/60 max-w-sm leading-relaxed">
          Ingresá el DNI o el nombre para ver su ficha completa, o creá un cliente nuevo.
        </p>
      </div>
      <button onClick={onNew} className="flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:scale-105 hover:shadow-xl hover:shadow-primary/40 active:scale-95">
        <Plus className="h-5 w-5" /> Nuevo cliente
      </button>
    </div>
  );
}
