"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { Wallet, Search, User, Phone, IdCard, ArrowLeft, Plus, ChevronRight, X } from "lucide-react";
import { useClientes, KEYS, type Cliente } from "@/lib/swr";
import { ClienteDetail } from "@/components/clientes/ClienteDetail";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { PagoForm } from "./PagoForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nombreCompleto } from "@/lib/utils";

/**
 * Terminal de pagos: flujo "buscar primero". No se lista nada hasta que el
 * operador ingresa un DNI o nombre; al elegir el cliente se muestra su ficha
 * 360 a pantalla completa, desde donde se registra el cobro.
 */
export function PagosTable() {
  const { clientes, isLoading } = useClientes();
  const { mutate: globalMutate } = useSWRConfig();

  const [query, setQuery] = useState("");
  const [verTodos, setVerTodos] = useState(false); // F3: lista completa de clientes A→Z
  const [selected, setSelected] = useState<Cliente | null>(null);
  const [pagoOpen, setPagoOpen] = useState(false);

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

  // ── Vista de ficha (cliente seleccionado) ──
  if (selected) {
    const acciones = (
      <>
        <button
          onClick={() => setSelected(null)}
          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="h-4 w-4" /> Buscar otro cliente
        </button>
        <button
          onClick={() => setPagoOpen(true)}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          <Plus className="h-4 w-4" /> Registrar pago
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
        <div className="flex flex-wrap items-center justify-end gap-2">{acciones}</div>

        {/* Ficha principal del cliente */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <ClienteDetail clienteId={selected.id} variant="pagos" />
        </div>

        <Dialog open={pagoOpen} onOpenChange={(o) => { if (!o) setPagoOpen(false); }}>
          <DialogContent className="w-[95vw] sm:max-w-xl max-h-[90dvh] flex flex-col overflow-hidden">
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

      {/* Buscador */}
      <BuscadorF3
        value={query}
        onChange={setQuery}
        placeholder="DNI o nombre del cliente…"
        size="lg"
        autoFocus
        onF3={() => setVerTodos((v) => !v)}
        onEnter={() => { if (resultados.length === 1) elegir(resultados[0]); }}
        onEscape={() => { if (verTodos) setVerTodos(false); else setQuery(""); }}
        f3Hint={`para ${verTodos ? "cerrar" : "ver"} la lista completa de clientes`}
        className="max-w-2xl"
      />

      {/* Estados */}
      {!q && !verTodos ? (
        <HeroVacio />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Buscando…</p>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-2 text-center">
          <User className="h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm font-semibold text-muted-foreground">{q ? "Sin coincidencias" : "Sin clientes"}</p>
          <p className="text-xs text-muted-foreground/50">{q ? `No se encontró ningún cliente para «${q}».` : "Todavía no hay clientes cargados."}</p>
        </div>
      ) : (
        <div className="space-y-2 max-w-2xl">
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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-sm font-bold text-primary">
                {c.nombre.slice(0, 1).toUpperCase()}
              </div>
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
