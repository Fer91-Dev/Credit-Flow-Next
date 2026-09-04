"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useSWRConfig } from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { Search, User, Phone, Mail, ArrowLeft, Plus, ChevronRight, X, Clock, ChevronDown, History } from "lucide-react";
import { ClienteForm } from "./ClienteForm";
import { ClienteDetail } from "./ClienteDetail";
import { useClientes, KEYS, type Cliente, useDiasLegales } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Avatar } from "@/components/ui/Avatar";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { FiltrosPanel } from "@/components/ui/FiltrosPanel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader } from "@/components/ui/form-kit";
import { nombreCompleto, formatFecha, formatDias } from "@/lib/utils";
import { normalizarEstadoCliente, ESTADO_CLIENTE_LABEL, ESTADO_CLIENTE_VARIANT } from "@/lib/domain";
import type { Role } from "@/lib/auth/roles";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

type Sel = { id: string; nombre: string };

/** Select del panel de filtros — el mismo de las demás secciones. */
const SEL_FILTRO =
  "h-10 rounded-lg border border-border bg-muted/40 pl-3 pr-8 text-sm text-foreground " +
  "outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

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
export function ClientesTable({ role }: { role?: Role } = {}) {
  const { clientes, isLoading, mutate } = useClientes({ scored: true });
  /** A cuántos días de atraso un crédito pasa a Legales (Configuración → Cobranza). */
  const diasLegales = useDiasLegales();
  const { mutate: globalMutate } = useSWRConfig();
  const confirm = useConfirm();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [soloInactivos, setSoloInactivos] = useState(false);
  const [verTodos, setVerTodos] = useState(false); // F3 en el buscador: lista completa A→Z
  const [recientes, setRecientes] = useState<"hoy" | "mes" | "anio" | null>(null); // filtro por fecha de alta
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

  // Clientes cargados recientemente (por fecha de alta), según el filtro elegido.
  const recientesClientes = useMemo(() => {
    if (!recientes) return [];
    const now = new Date();
    const desde =
      recientes === "hoy" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      : recientes === "mes" ? new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      : new Date(now.getFullYear(), 0, 1).getTime();
    return clientes
      .filter((c) => c.created_at && new Date(c.created_at).getTime() >= desde)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [clientes, recientes]);

  const elegir = (c: Cliente) => { setSelected({ id: c.id, nombre: nombreCompleto(c) }); setQuery(""); setVerTodos(false); };

  // La lista completa (F3) se cierra al hacer click afuera (o con Escape en el buscador).
  const listaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!verTodos) return;
    const onDown = (e: MouseEvent) => {
      if (listaRef.current && !listaRef.current.contains(e.target as Node)) setVerTodos(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [verTodos]);

  // Columnas de la tabla de "recién cargados" (filas clickeables → ficha).
  const recientesColumns: Column<Cliente>[] = [
    { header: "Cliente", cell: (c) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={nombreCompleto(c)} seed={c.id} size="sm" status={c.estado === "activo" ? "online" : "offline"} />
        <span className="font-medium text-foreground truncate">{nombreCompleto(c)}</span>
      </div>
    ) },
    { header: "DNI", className: "hidden md:table-cell", cell: (c) => <span className="font-mono text-muted-foreground">{c.documento ?? "—"}</span> },
    { header: "Teléfono", className: "hidden lg:table-cell", cell: (c) => <span className="text-muted-foreground">{c.telefono ?? "—"}</span> },
    { header: "Estado", align: "center", cell: (c) => {
        const e = normalizarEstadoCliente(c.estado);
        return (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <StatusBadge label={ESTADO_CLIENTE_LABEL[e]} variant={ESTADO_CLIENTE_VARIANT[e]} />
            {/* Que el cliente tenga un crédito en LEGALES se ve acá, sin abrir su ficha: es
                lo que hay que saber ANTES de llamarlo, no después. El estado de la persona
                (activo/fallecido) y el de su deuda son cosas distintas y van separadas. */}
            {diasLegales > 0 && (c.dias_mora_max ?? 0) >= diasLegales && (
              <StatusBadge label="Legales" variant="info" />
            )}
          </div>
        );
      } },
    { header: "Cargado", align: "right", cell: (c) => <span className="text-muted-foreground tabular-nums">{formatFecha(c.created_at)}</span> },
  ];

  /**
   * El criterio de ESTA sección: quién dejó de operar (inactivos) y quién entró hace poco.
   * Es lo que dice el botón "Filtrar" cuando hay algo puesto, en vez de la palabra fija.
   */
  const etiquetasFiltro = [
    soloInactivos ? `Inactivos (+${DIAS_INACTIVIDAD} días)` : null,
    recientes ? (recientes === "hoy" ? "Cargados hoy" : recientes === "mes" ? "Cargados este mes" : "Cargados este año") : null,
  ].filter((x): x is string => !!x);
  const filtrosActivos = etiquetasFiltro.length;
  const resumenFiltros =
    filtrosActivos === 1 ? etiquetasFiltro[0] :
    filtrosActivos > 1   ? `${filtrosActivos} filtros` : undefined;

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

        {/*
          La ficha ocupa TODO el ancho disponible.
          Estaba topeada en `max-w-4xl` y centrada, así que en un monitor ancho quedaban dos
          franjas vacías a los costados mientras los bloques de adentro se apretaban. Es la
          pantalla donde va a vivir el historial del cliente: acá el espacio se usa, no se
          decora. El `AppShell` ya no centra el contenido, así que alcanza con soltar el tope.
        */}
        <div className="w-full space-y-3">
          {volver}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ClienteDetail
              clienteId={selected.id}
              /* 🔴 Era "cliente", que apaga `showCreditos`: la ficha NO mostraba sus
                 créditos, ni el estado de cuenta, ni las promesas, ni el perfil de bureau,
                 ni los pagos. Quedaban solo los datos personales — un formulario de alta en
                 modo lectura, no una ficha. La vista 360 vivía en el componente y la única
                 pantalla que la necesita entera era justo la que la tenía apagada. */
              variant="full"
              role={role}
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

      {/*
        Mismo aspecto que el buscador de Pagos, a pedido del usuario. No es cosmética: los dos
        hacen lo MISMO —buscar una persona para operar sobre ella— y estaban con tamaños
        distintos, así que la misma acción se veía como dos cosas según la pantalla.

        El botón "lista completa" es el atajo con el mouse: el hint prometía F3 y en una
        terminal se opera con el mouse. Es el mismo `verTodos` que el teclado, no un segundo
        camino.
      */}
      {/*
        🔴 ACÁ EL FILTRO NO VA ADENTRO DE LA CAJA, y es a propósito.

        En el resto de las secciones el botón "Filtrar" vive dentro del buscador. Este ya
        tiene adentro su propia acción —"F3 · lista completa"—, que es la que define a esta
        pantalla: acá no se filtra una tabla, se BUSCA una persona. Meter los dos controles
        adentro los apretaba contra el texto. Así que el filtro va pegado a la derecha, en el
        mismo renglón: una sola fila de controles, que es lo que importa del patrón.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <BuscadorF3
          size="lg"
          value={query}
          onChange={setQuery}
          placeholder="DNI o nombre del cliente…"
          onF3={() => setVerTodos((v) => !v)}
          hint="Escaneá el DNI o escribí el nombre — desde la ficha se edita, se otorga y se cobra."
          onEnter={() => { if (resultados.length === 1) elegir(resultados[0]); }}
          onEscape={() => { if (verTodos) setVerTodos(false); else setQuery(""); }}
          autoFocus
          className="w-full sm:max-w-2xl"
          accionDerecha={
            <button
              type="button"
              onClick={() => setVerTodos((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">F3</kbd>
              <span className="text-primary">{verTodos ? "cerrar lista" : "lista completa"}</span>
            </button>
          }
        />
        {/* El criterio de ESTA sección: quién dejó de operar y quién entró hace poco. */}
        <FiltrosPanel
          label="Filtrar"
          resumen={resumenFiltros}
          activos={filtrosActivos}
          onLimpiar={() => { setSoloInactivos(false); setRecientes(null); }}
          align="right"
          width={300}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Actividad</span>
            <div className="relative">
              <select
                value={soloInactivos ? "inactivos" : ""}
                onChange={(e) => setSoloInactivos(e.target.value === "inactivos")}
                className={SEL_FILTRO}
              >
                <option value="">Todos los clientes</option>
                <option value="inactivos">
                  Solo inactivos (más de {DIAS_INACTIVIDAD} días){inactivos.length > 0 ? ` · ${inactivos.length}` : ""}
                </option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Recién cargados</span>
            <div className="relative">
              <select
                value={recientes ?? ""}
                onChange={(e) => setRecientes((e.target.value || null) as typeof recientes)}
                className={SEL_FILTRO}
              >
                <option value="">Cualquier fecha de alta</option>
                <option value="hoy">Hoy</option>
                <option value="mes">Este mes</option>
                <option value="anio">Este año</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </label>
        </FiltrosPanel>
      </div>

      {/* Tabla de recién cargados (aparece/desaparece con fade; se oculta si hay búsqueda) */}
      <AnimatePresence initial={false}>
        {recientes && !q && !verTodos && (
          <motion.section
            key="recientes"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="space-y-3"
          >
            {/* Encabezado con el conteo pegado al título, como en el resto del SaaS. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  Clientes cargados {recientes === "hoy" ? "hoy" : recientes === "mes" ? "este mes" : "este año"}
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                  {recientesClientes.length}
                </span>
              </div>
              <button
                onClick={() => { setSoloInactivos(false); setRecientes(null); }}
                title="Limpiar los filtros"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" /> Limpiar filtros
              </button>
            </div>
            {recientesClientes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                No hay clientes cargados en este período.
              </p>
            ) : (
              <DataTable
                columns={recientesColumns}
                rows={recientesClientes}
                rowKey={(c) => c.id}
                pageSize={12}
                onRowClick={(c) => elegir(c)}
                zebra
              />
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/*
        Estados. Se ocultan en modo "recién cargados" sin búsqueda para que no se apilen dos
        listas de clientes.

        🔴 PERO `verTodos` MANDA. Con un filtro de recién cargados puesto, F3 no hacía NADA:
        el atajo prendía el estado, la lista se armaba, y esta condición la tapaba. Desde
        afuera se veía como un atajo roto — y ya se había hecho el trabajo de traerla.
        Ahora la lista completa gana: es una acción explícita del usuario, contra un filtro
        que dejó puesto antes.
      */}
      {(!recientes || q || verTodos) && (soloInactivos && !q ? (
        isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : inactivos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-3 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm font-semibold text-muted-foreground">Sin clientes inactivos</p>
            <p className="text-xs text-muted-foreground/50">Ningún cliente supera los {DIAS_INACTIVIDAD} días sin movimiento.</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-[22rem]">
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
          <div ref={listaRef} className="space-y-2 max-w-[22rem]">
            <p className="text-xs text-muted-foreground">
              {todosOrdenados.length} cliente{todosOrdenados.length !== 1 ? "s" : ""} · orden alfabético
            </p>
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
        ) : recientes ? null : (
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
        <div className="space-y-2 max-w-[22rem]">
          <p className="text-xs text-muted-foreground">
            {resultados.length} resultado{resultados.length !== 1 ? "s" : ""}
          </p>
          {resultados.slice(0, 20).map((c) => (
            <ClienteRow key={c.id} cliente={c} onClick={() => elegir(c)} mostrarInactividad={soloInactivos} />
          ))}
        </div>
      ))}

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
      <Avatar name={nombreCompleto(c)} seed={c.id} size="md" status={activo ? "online" : "offline"} />

      {/* Datos del titular (el estado activo/inactivo ya lo muestra el dot del avatar) */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-foreground">{nombreCompleto(c)}</p>
          {c.migrado && (
            <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning" title="Importado del sistema anterior">
              Migrado
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {c.documento && (
            <span className="flex items-baseline gap-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-primary/70">DNI</span>
              <span className="font-mono font-medium text-foreground">{c.documento}</span>
            </span>
          )}
          {c.telefono && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{c.telefono}</span>}
          {!c.documento && !c.telefono && c.email && <span className="flex items-center gap-1 truncate text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</span>}
          {dias !== null && <span className="flex items-center gap-1 text-warning"><Clock className="h-3 w-3" />{formatDias(dias)}</span>}
          <ScoreBadge score={c.score} size="sm" />
        </div>
      </div>

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
