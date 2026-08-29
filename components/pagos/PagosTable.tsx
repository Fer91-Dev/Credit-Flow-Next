"use client";

import { useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { Wallet, Search, User, Phone, IdCard, ArrowLeft, Plus, ChevronRight, X, Clock } from "lucide-react";
import { useClientes, usePagos, KEYS, type Cliente, type Pago } from "@/lib/swr";
import { ClienteDetail } from "@/components/clientes/ClienteDetail";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable } from "@/components/ui/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { PagoForm } from "./PagoForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nombreCompleto, formatFecha, formatMonto, formatCreditoNumero } from "@/lib/utils";

/**
 * Terminal de pagos: flujo "buscar primero". No se lista nada hasta que el
 * operador ingresa un DNI o nombre; al elegir el cliente se muestra su ficha
 * 360 a pantalla completa, desde donde se registra el cobro.
 */
export function PagosTable() {
  const { clientes, isLoading } = useClientes();
  const { pagos, isLoading: pagosLoading } = usePagos();
  const { mutate: globalMutate } = useSWRConfig();

  const [query, setQuery] = useState("");
  const [verTodos, setVerTodos] = useState(false); // F3: lista completa de clientes A→Z
  const [selected, setSelected] = useState<Cliente | null>(null);
  const [pagoOpen, setPagoOpen] = useState(false);
  const [nuevoPagoOpen, setNuevoPagoOpen] = useState(false); // pago genérico (busca crédito/cliente en el form)

  // Búsqueda DNI-aware: matchea por nombre o por documento (también en su forma
  // "solo dígitos", para que 20.123.456 encuentre al guardado como 20123456).
  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, "");
    return clientes.filter((c) => {
      const nombre = nombreCompleto(c).toLowerCase();
      const doc = (c.documento || "").toLowerCase();
      const docDigits = doc.replace(/\D/g, "");
      return nombre.includes(q) || doc.includes(q) || (qDigits.length > 0 && docDigits.includes(qDigits));
    });
  }, [clientes, query]);

  // Lista completa ordenada (para "ver todos" con F3).
  const todosOrdenados = useMemo(
    () => [...clientes].sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), "es", { sensitivity: "base" })),
    [clientes],
  );

  const elegir = (c: Cliente) => { setSelected(c); setQuery(""); setVerTodos(false); };

  /**
   * LLEGAR CON EL CLIENTE YA CARGADO: `/pagos?cliente=<id>`.
   *
   * Desde que el cobro vive SOLO acá, el detalle del crédito y la ficha de Clientes tienen un
   * botón "Cobrar" que trae para acá. Sin esto el operador veía la cuota en una pantalla y
   * tenía que volver a buscar al mismo cliente por DNI en otra — un paso de más en la acción
   * que más se repite del día.
   *
   * Se lee del `location` y no con `useSearchParams` para no arrastrar la pantalla entera a
   * un Suspense por un parámetro opcional (mismo criterio que el `?tab=` de Cobranzas).
   * Corre una sola vez: si el operador después elige otro cliente, el parámetro no lo pisa.
   */
  const [linkResuelto, setLinkResuelto] = useState(false);
  useEffect(() => {
    if (linkResuelto || clientes.length === 0) return;
    setLinkResuelto(true);
    const id = new URLSearchParams(window.location.search).get("cliente");
    if (!id) return;
    const c = clientes.find((x) => x.id === id);
    if (c) elegir(c);
    // La URL vuelve a /pagos: si queda el parámetro, un F5 más tarde reabre una ficha que el
    // operador ya había cerrado.
    window.history.replaceState(null, "", "/pagos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes, linkResuelto]);

  // Desde un pago reciente → abrir la ficha de su cliente (donde se anula el pago).
  const abrirPorPago = (p: Pago) => {
    const c = clientes.find((x) => x.id === p.credito.cliente_id);
    if (c) elegir(c);
  };

  const handlePagoClose = (success?: boolean) => {
    setPagoOpen(false);
    if (success && selected) {
      // Refrescar la ficha + cachés de cartera/pagos/caja.
      globalMutate(`/api/clientes/${selected.id}`);
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.pagos);
      globalMutate(KEYS.dashboard);
      globalMutate("/api/caja");
    }
  };

  // Pago genérico desde la vista de entrada (el operador busca el crédito/cliente en el form).
  const handleNuevoPagoClose = (success?: boolean) => {
    setNuevoPagoOpen(false);
    if (success) {
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.pagos);
      globalMutate(KEYS.dashboard);
      globalMutate("/api/caja");
    }
  };

  // ── Vista de ficha (cliente seleccionado) ──
  if (selected) {
    /**
     * Las dos acciones de la terminal. Van DENTRO del encabezado de la ficha (ver la prop
     * `acciones` de `ClienteDetail`): antes ocupaban una franja propia arriba, que empujaba
     * la credencial y las cuotas hacia abajo sin aportar nada.
     */
    const acciones = (
      <>
        {/* Volver al buscador. Fantasma, para que no compita con el cobro: la flecha se
            corre al pasar el mouse, que ya dice "vas hacia atrás" sin más peso visual. */}
        <button
          onClick={() => setSelected(null)}
          className="group inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-border/70 bg-card/60 px-4 py-2.5 text-sm font-medium text-muted-foreground backdrop-blur transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
          Buscar otro cliente
        </button>

        {/*
          COBRAR. Es la acción por la que existe esta pantalla, así que se ve como plata: verde
          —el mismo de los botones de cuota, para que se lean como lo mismo—, el signo $ en su
          propia ficha circular, y un brillo que la recorre al pasar el mouse. El realce va acá
          y en ningún otro lado de la terminal.
        */}
        <button
          onClick={() => setPagoOpen(true)}
          className="group relative inline-flex items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-xl bg-gradient-to-b from-success to-success/85 px-5 py-2.5 text-sm font-bold text-success-foreground shadow-[0_8px_20px_-10px_color-mix(in_srgb,var(--success)_70%,transparent)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-10px_color-mix(in_srgb,var(--success)_85%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success-foreground/20 font-mono text-base leading-none">$</span>
          Registrar pago
          {/* El brillo: un barrido diagonal que cruza el botón al pasar el mouse. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-full w-1/2 skew-x-[-20deg] bg-success-foreground/25 transition-[left] duration-500 ease-out group-hover:left-[150%] motion-reduce:hidden"
          />
        </button>
      </>
    );

    return (
      <div className="space-y-6">
        {/* Header contextual de la página + acciones */}
        <PageHeader
          icon="dollar-banknote"
          title="Pagos"
          subtitle="Ficha del cliente · registrar cobro"
          accent="primary"
        />
        {/* Ficha principal del cliente, con las acciones en su encabezado */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <ClienteDetail clienteId={selected.id} variant="pagos" accionesPantalla={acciones} />
        </div>

        <Dialog open={pagoOpen} onOpenChange={(o) => { if (!o) setPagoOpen(false); }}>
          <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle>Registrar pago · {nombreCompleto(selected)}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {pagoOpen && <PagoForm clienteId={selected.id} onClose={handlePagoClose} />}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Vista de búsqueda (sin cliente seleccionado) ──
  const q = query.trim();
  const lista = q ? resultados : todosOrdenados; // con F3 (verTodos) se muestra la lista completa
  return (
    <div className="space-y-6">
      <PageHeader
        icon="dollar-banknote"
        title="Pagos"
        subtitle="Buscá un cliente por DNI o nombre para ver su estado de cuenta y registrar el cobro."
        accent="primary"
      />

      {/* Buscador + acción */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <BuscadorF3
          value={query}
          onChange={setQuery}
          placeholder="DNI o nombre del cliente…"
          autoFocus
          onF3={() => setVerTodos((v) => !v)}
          onEnter={() => { if (resultados.length === 1) elegir(resultados[0]); }}
          onEscape={() => { if (verTodos) setVerTodos(false); else setQuery(""); }}
          f3Hint={`para ${verTodos ? "cerrar" : "ver"} la lista completa de clientes`}
          className="w-full sm:max-w-sm"
        />
        <button
          onClick={() => setNuevoPagoOpen(true)}
          className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          <Plus className="h-4 w-4" /> Registrar pago
        </button>
      </div>

      {/* Estados */}
      {!q && !verTodos ? (
        <UltimosPagos pagos={pagos} loading={pagosLoading} onRow={abrirPorPago} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Buscando…</p>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-2 text-center">
          <User className="h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm font-semibold text-muted-foreground">{q ? "Sin coincidencias" : "Sin clientes"}</p>
          <p className="text-xs text-muted-foreground/50">{q ? `No se encontró ningún cliente para «${q}».` : "Todavía no hay clientes cargados."}</p>
        </div>
      ) : (
        <div className="space-y-2 max-w-[22rem]">
          <p className="text-xs text-muted-foreground">
            {q
              ? `${lista.length} resultado${lista.length !== 1 ? "s" : ""}`
              : `${lista.length} cliente${lista.length !== 1 ? "s" : ""} · orden alfabético`}
          </p>
          {lista.slice(0, q ? 20 : 300).map((c) => (
            <button
              key={c.id}
              onClick={() => elegir(c)}
              className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-card/80"
            >
              <Avatar name={nombreCompleto(c)} seed={c.id} size="md" status={c.estado === "activo" ? "online" : "offline"} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{nombreCompleto(c)}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {c.documento && <span className="flex items-center gap-1 font-mono"><IdCard className="h-3 w-3" />{c.documento}</span>}
                  {c.telefono && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.telefono}</span>}
                </div>
              </div>
              <StatusBadge label={c.estado} variant={c.estado === "activo" ? "success" : "muted"} />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
            </button>
          ))}
        </div>
      )}

      {/* Registrar pago genérico: el operador busca el crédito/cliente dentro del form */}
      <Dialog open={nuevoPagoOpen} onOpenChange={(o) => { if (!o) setNuevoPagoOpen(false); }}>
        <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Registrar pago</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {nuevoPagoOpen && <PagoForm onClose={handleNuevoPagoClose} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Registro de los últimos pagos ingresados. Se muestra al entrar a Pagos (sin búsqueda
 * activa) para dar acceso rápido: tocar una fila abre la ficha del cliente, desde donde
 * se puede anular el cobro. Si no hay pagos aún, cae al hero de "buscá un cliente".
 */
function UltimosPagos({ pagos, loading, onRow }: { pagos: Pago[]; loading: boolean; onRow: (p: Pago) => void }) {
  if (loading) {
    return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }
  if (pagos.length === 0) return <HeroVacio />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Últimos pagos ingresados</h2>
          <p className="text-xs text-muted-foreground">Tocá un pago para abrir la ficha del cliente y anularlo si hace falta.</p>
        </div>
      </div>
      <DataTable
        rows={pagos}
        rowKey={(p) => p.id}
        pageSize={10}
        onRowClick={onRow}
        zebra
        columns={[
          { header: "Fecha", className: "whitespace-nowrap",
            cell: (p) => <span className="text-xs text-muted-foreground">{formatFecha(p.fecha)}</span> },
          { header: "Cliente",
            cell: (p) => (
              <div className="flex items-center gap-2.5">
                <Avatar name={nombreCompleto(p.credito.cliente)} seed={p.credito.cliente_id} size="sm" />
                <span className={`font-medium ${p.anulado ? "text-muted-foreground line-through" : "text-foreground"}`}>{nombreCompleto(p.credito.cliente)}</span>
              </div>
            ) },
          { header: "Crédito", className: "whitespace-nowrap",
            cell: (p) => <span className="font-mono text-xs text-muted-foreground">{formatCreditoNumero(p.credito.numero, p.credito.refinancia_a_numero)}</span> },
          { header: "Monto", mono: true, align: "right",
            cell: (p) => <span className={`font-semibold ${p.anulado ? "text-muted-foreground" : "text-foreground"}`}>{formatMonto(p.monto, 0)}</span> },
          { header: "Método",
            cell: (p) => <StatusBadge label={p.metodo} variant="muted" /> },
          { header: "Estado", align: "center",
            cell: (p) => p.anulado
              ? <StatusBadge label="Anulado" variant="destructive" />
              : <StatusBadge label="Registrado" variant="success" /> },
        ]}
      />
    </div>
  );
}

function HeroVacio() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Search className="h-7 w-7 text-primary/60" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Buscá un cliente para empezar</p>
        <p className="text-xs text-muted-foreground/60 max-w-sm leading-relaxed">
          Ingresá el DNI o el nombre del cliente. Vas a ver su estado de cuenta completo y vas a poder registrar el cobro desde su ficha.
        </p>
      </div>
    </div>
  );
}
