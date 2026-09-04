"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useSWRConfig } from "swr";
import { Search, User, Phone, Mail, ArrowLeft, Plus, ChevronRight, Clock } from "lucide-react";
import { ClienteForm } from "./ClienteForm";
import { ClienteDetail } from "./ClienteDetail";
import { useClientes, KEYS, type Cliente, useDiasLegales } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Avatar } from "@/components/ui/Avatar";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader } from "@/components/ui/form-kit";
import { nombreCompleto, formatDias } from "@/lib/utils";
import { useDebounce } from "@/lib/use-debounce";
import type { Role } from "@/lib/auth/roles";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

type Sel = { id: string; nombre: string };

/**
 * Clientes con flujo "buscar primero" (igual que Pagos): no se lista nada hasta
 * ingresar un DNI o nombre; al elegir, se ve la ficha 360 a pantalla completa,
 * con editar/eliminar. El alta de clientes está siempre disponible.
 */
export function ClientesTable({ role }: { role?: Role } = {}) {
  /**
   * 🔴 El término se DEBOUNCEA antes de viajar: cada tecla dispara una consulta al servidor y
   * escribir un DNI son ocho. 250 ms alcanzan para que no salga una por dígito y no se sienta
   * lento al tipear.
   */
  const [query, setQuery] = useState("");
  const qServidor = useDebounce(query.trim(), 250);
  /**
   * La búsqueda corre en el SERVIDOR (`?q=`). Antes la lista llegaba entera y se filtraba en
   * memoria: el filtro solo veía lo que hubiera entrado en la página, así que un cliente fuera
   * de ella no aparecía y la pantalla decía "Sin coincidencias" como si no existiera.
   * `total` es cuántos matchean de verdad, no cuántos entraron en la respuesta.
   */
  const { clientes, total, isLoading, mutate } = useClientes({ scored: true, q: qServidor, limit: 1000 });
  /** A cuántos días de atraso un crédito pasa a Legales (Configuración → Cobranza). */
  const diasLegales = useDiasLegales();
  const { mutate: globalMutate } = useSWRConfig();
  const confirm = useConfirm();
  const toast = useToast();

  const [verTodos, setVerTodos] = useState(false); // F3 en el buscador: lista completa A→Z
  const [selected, setSelected] = useState<Sel | null>(null);
  const [dialogOpen, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  /**
   * Los resultados YA vienen filtrados por el servidor (nombre, apellido y documento, este
   * último también en su forma "solo dígitos"). Acá no se vuelve a filtrar: hacerlo escondería
   * matches que el servidor sí encontró.
   *
   * Mientras el debounce no alcanzó al input, `clientes` todavía trae lo del término anterior:
   * se muestra vacío en vez de una lista que no corresponde a lo que se está viendo escrito.
   */
  const enSincro = query.trim() === qServidor;
  const resultados = qServidor && enSincro ? clientes : [];

  // Todos los clientes ordenados alfabéticamente (para la vista "ver todos" con F3).
  const todosOrdenados = useMemo(
    () => [...clientes].sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), "es", { sensitivity: "base" })),
    [clientes],
  );


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
        // Se descuenta también del total: si no, el conteo sigue diciendo el número viejo
        // hasta que revalide, y el operador ve una lista con uno menos y un total que no cambió.
        const restantes = (current?.clientes ?? []).filter((c) => c.id !== id);
        return { clientes: restantes, total: Math.max(0, (current?.total ?? 0) - 1) };
      },
      { optimisticData: { clientes: clientes.filter((c) => c.id !== id), total: Math.max(0, total - 1) }, rollbackOnError: true },
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
        🔴 SIN BOTÓN DE FILTRO, a diferencia del resto de las secciones.

        Acá no hay una tabla que recortar: la pantalla no lista nada hasta que se escribe un
        DNI o un nombre. Un filtro sobre una lista que todavía no existe es un control que no
        hace nada hasta que se hace otra cosa primero. Lo único que vive dentro de la caja es
        "F3 · lista completa", que es la acción propia de este buscador.
      */}
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


      {/* Sin búsqueda: la lista completa si la pidió con F3, y si no el estado inicial. */}
      {!q ? (
        verTodos ? (
          <div ref={listaRef} className="space-y-2 max-w-[22rem]">
            <p className="text-xs text-muted-foreground">
              {total} cliente{total !== 1 ? "s" : ""} · orden alfabético
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
                  <ClienteRow key={c.id} cliente={c} onClick={() => elegir(c)} mostrarInactividad={false} />
                ))}
                {total > 100 && (
                  <p className="pt-1 text-center text-xs text-muted-foreground/60">
                    Mostrando 100 de {total}. Escribí en el buscador para encontrar a alguien puntual.
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
            No se encontró ningún cliente para «{q}».
          </p>
          {/* Si no aparece, lo más probable es que todavía no esté cargado: el alta va acá
              mismo, con el término tipeado, para no perder lo escrito. */}
          <button onClick={openNew} className="mt-1 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
            <Plus className="h-4 w-4" /> Dar de alta «{q}»
          </button>
        </div>
      ) : (
        <div className="space-y-2 max-w-[22rem]">
          <p className="text-xs text-muted-foreground">
            {/* El total lo cuenta el SERVIDOR sobre toda la tabla; abajo se muestran los
                primeros 20. Decir "20 resultados" cuando hay 340 sería mentir por recorte. */}
            {total} resultado{total !== 1 ? "s" : ""}
            {total > 20 && <span className="text-muted-foreground/60"> · se muestran los primeros 20</span>}
          </p>
          {resultados.slice(0, 20).map((c) => (
            <ClienteRow key={c.id} cliente={c} onClick={() => elegir(c)} mostrarInactividad={false} />
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
