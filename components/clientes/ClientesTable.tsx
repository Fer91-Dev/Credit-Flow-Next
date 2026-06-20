"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { Users, Search, User, Phone, IdCard, Mail, ArrowLeft, Plus, ChevronRight, X, Clock } from "lucide-react";
import { ClienteForm } from "./ClienteForm";
import { ClienteDetail } from "./ClienteDetail";
import { useClientes, KEYS, type Cliente } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  const { clientes, isLoading, mutate } = useClientes();
  const { mutate: globalMutate } = useSWRConfig();

  const [query, setQuery] = useState("");
  const [soloInactivos, setSoloInactivos] = useState(false);
  const [selected, setSelected] = useState<Sel | null>(null);
  const [dialogOpen, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Búsqueda DNI-aware: nombre o documento (también en forma "solo dígitos").
  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, "");
    return clientes.filter((c) => {
      const nombre = c.nombre.toLowerCase();
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

  const elegir = (c: Cliente) => { setSelected({ id: c.id, nombre: c.nombre }); setQuery(""); };

  const openNew = () => { setEditingId(null); setDialog(true); };
  const openEdit = (id: string) => { setEditingId(id); setDialog(true); };

  const handleFormClose = (success?: boolean, creado?: { id: string; nombre: string }) => {
    const wasEditing = editingId;
    setDialog(false); setEditingId(null);
    if (!success) return;
    mutate(); globalMutate(KEYS.dashboard);
    if (wasEditing) globalMutate(`/api/clientes/${wasEditing}`); // refrescar la ficha abierta
    if (creado) setSelected({ id: creado.id, nombre: creado.nombre }); // saltar a la ficha del nuevo
  };

  const handleDelete = async (id: string) => {
    await mutate(
      async (current) => {
        await fetch(`/api/clientes/${id}`, { method: "DELETE" });
        return { clientes: (current?.clientes ?? []).filter((c) => c.id !== id) };
      },
      { optimisticData: { clientes: clientes.filter((c) => c.id !== id) }, rollbackOnError: true },
    ).catch(() => {});
    globalMutate(KEYS.dashboard);
    setSelected(null);
  };

  const cta = (
    <button
      onClick={openNew}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      <Plus className="h-4 w-4" /> Nuevo cliente
    </button>
  );

  // Diálogo de alta/edición (compartido por ambas vistas).
  const formDialog = (
    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleFormClose(false); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingId ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
        </DialogHeader>
        <ClienteForm clienteId={editingId} onClose={handleFormClose} />
      </DialogContent>
    </Dialog>
  );

  // ── Vista de ficha (cliente seleccionado) ──
  if (selected) {
    return (
      <div className="space-y-5">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Buscar otro cliente
        </button>

        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <ClienteDetail
            clienteId={selected.id}
            variant="cliente"
            onEditar={() => openEdit(selected.id)}
            onEliminar={() => handleDelete(selected.id)}
          />
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
        icon={Users}
        title="Clientes"
        subtitle="Buscá un cliente por DNI o nombre para ver su ficha, o creá uno nuevo."
        accent="primary"
        actions={cta}
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
          onKeyDown={(e) => { if (e.key === "Enter" && resultados.length === 1) elegir(resultados[0]); }}
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
        <HeroVacio onNew={openNew} />
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
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-card/80"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-sm font-bold text-primary">
        {c.nombre.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground truncate">{c.nombre}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {c.documento && <span className="flex items-center gap-1 font-mono"><IdCard className="h-3 w-3" />{c.documento}</span>}
          {c.telefono && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.telefono}</span>}
          {!c.documento && !c.telefono && c.email && <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{c.email}</span>}
          {dias !== null && (
            <span className="flex items-center gap-1 text-warning"><Clock className="h-3 w-3" />{dias}d sin mov.</span>
          )}
        </div>
      </div>
      <ScoreBadge score={c.score} size="sm" />
      <StatusBadge label={c.estado} variant={c.estado === "activo" ? "success" : "muted"} />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
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
      <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
        <Plus className="h-4 w-4" /> Nuevo cliente
      </button>
    </div>
  );
}
