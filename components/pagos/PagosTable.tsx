"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, Search, User, Phone, IdCard, ArrowLeft, ChevronRight, X, Clock, TrendingUp, TrendingDown } from "lucide-react";
import { useClientes, usePagos, KEYS, type Cliente, type Pago, type ResumenPagos } from "@/lib/swr";
import { ClienteDetail } from "@/components/clientes/ClienteDetail";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable } from "@/components/ui/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { nombreCompleto, formatFecha, formatMonto, formatCreditoNumero } from "@/lib/utils";
import { round2 } from "@/lib/domain";

/**
 * Terminal de pagos: flujo "buscar primero". No se lista nada hasta que el
 * operador ingresa un DNI o nombre; al elegir el cliente se muestra su ficha
 * 360 a pantalla completa, desde donde se registra el cobro.
 */
export function PagosTable({ clienteInicial = null }: { clienteInicial?: string | null }) {
  const { clientes, isLoading } = useClientes();
  const { pagos, resumen, isLoading: pagosLoading } = usePagos();

  const [query, setQuery] = useState("");
  const [verTodos, setVerTodos] = useState(false); // F3: lista completa de clientes A→Z
  /**
   * 🔴 EL CLIENTE ELEGIDO ES UN **ID**, Y ARRANCA CON EL QUE VINO DEL SERVIDOR.
   *
   * Guardaba el objeto `Cliente` entero, sacado de la lista de `useClientes()`, y el
   * `?cliente=` se resolvía en un efecto DESPUÉS de que esa lista llegara por fetch. Entrar
   * desde el botón "Cobrar" mostraba entonces el BUSCADOR unos segundos —con sus skeletons y
   * todo— y recién después saltaba a la ficha: un cambio de pantalla a la vista, en la acción
   * que más se repite del día.
   *
   * No hacía falta esperar nada: lo único que la ficha necesita es el id, porque
   * `ClienteDetail` trae sus propios datos. El id llega resuelto por el server component
   * (`clienteInicial`), así que el PRIMER render ya es la ficha.
   */
  const [clienteId, setClienteId] = useState<string | null>(clienteInicial);
  /**
   * Los KPI que son un SUBCONJUNTO de la lista de abajo filtran esa lista al tocarlos.
   * Acota lo que se muestra; el número de la tarjeta sigue siendo el del período completo,
   * agregado en la base, y no cambia con el filtro.
   */
  const [filtro, setFiltro] = useState<"hoy" | "anulados" | null>(null);

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

  const elegir = (c: Cliente) => { setClienteId(c.id); setQuery(""); setVerTodos(false); };

  /**
   * Si se entra de nuevo a `/pagos?cliente=<otro>` con la pantalla ya montada, React conserva
   * el componente y el inicializador del `useState` NO vuelve a correr. Este efecto sincroniza
   * ese caso; como depende del valor, no se vuelve a disparar tras limpiar la URL (la prop no
   * cambia) ni pisa al cliente que el operador elija después a mano.
   */
  useEffect(() => {
    if (clienteInicial) setClienteId(clienteInicial);
  }, [clienteInicial]);

  /**
   * Limpiar `?cliente=` de la URL: si queda, un F5 más tarde reabre una ficha que el operador
   * ya había cerrado. `replaceState` no re-renderiza ni pierde el estado.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("cliente")) {
      window.history.replaceState(null, "", "/pagos");
    }
  }, [clienteInicial]);

  // Desde un pago reciente → abrir la ficha de su cliente (donde se anula el pago).
  const abrirPorPago = (p: Pago) => {
    setClienteId(p.credito.cliente_id);
    setQuery("");
    setVerTodos(false);
  };

  // ── Vista de ficha (cliente seleccionado) ──
  if (clienteId) {
    /**
     * La única acción de pantalla: volver al buscador.
     *
     * 🔴 Acá había además un botón "Registrar pago" que abría el mismo formulario, pero sin
     * crédito ni cuota elegidos. Era un SEGUNDO camino para cobrar, compitiendo con los
     * botones verdes de cada cuota —que ya llegan con el crédito y la cuota puestos y también
     * permiten monto personalizado—. Se fue: el cobro se pide sobre la cuota que se cobra.
     *
     * El cobro que no cuelga de ninguna cuota (un crédito sin cronograma, un pago a cuenta)
     * sigue existiendo en el "Registrar pago" de la vista de búsqueda, que busca el crédito
     * por N° o DNI dentro del formulario.
     */
    const acciones = (
      /* Fantasma: la flecha se corre al pasar el mouse, que ya dice "vas hacia atrás" sin
         robarle peso visual a los botones de cobro de las cuotas. */
      <button
        onClick={() => setClienteId(null)}
        className="group inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-border/70 bg-card/60 px-4 py-2.5 text-sm font-medium text-muted-foreground backdrop-blur transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
        Buscar otro cliente
      </button>
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
          <ClienteDetail clienteId={clienteId} variant="pagos" accionesPantalla={acciones} />
        </div>
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

      {/*
        El buscador ES la pantalla: en la terminal de cobro lo primero que pasa es que llega
        alguien y se escanea su DNI. Va grande y a la izquierda, con el acceso a la lista
        completa DENTRO de la caja — el atajo F3 solo existe si hay teclado a mano.

        🔴 No lleva ningún botón al lado. Había un "Registrar pago" que abría el mismo
        formulario sin crédito ni cuota elegidos: el último resto del segundo camino de cobro
        que se sacó de la ficha. Todo cobro se pide sobre la cuota que se cobra, y lo que no
        cubre una cuota entera se resuelve con «Monto personalizado» dentro de ese formulario.
      */}
      <BuscadorF3
        size="lg"
        value={query}
        onChange={setQuery}
        placeholder="DNI o nombre del cliente…"
        autoFocus
        onF3={() => setVerTodos((v) => !v)}
        onEnter={() => { if (resultados.length === 1) elegir(resultados[0]); }}
        onEscape={() => { if (verTodos) setVerTodos(false); else setQuery(""); }}
        hint="Escaneá el DNI o escribí el nombre — el cobro se registra desde la ficha del cliente."
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

      {/* El pulso del día. Solo en la vista de entrada: buscando un cliente, estorban. */}
      {!q && !verTodos && (
        <KpisDelDia resumen={resumen} loading={pagosLoading} filtro={filtro} onFiltro={setFiltro} />
      )}

      {/* Estados */}
      {!q && !verTodos ? (
        <UltimosPagos pagos={pagos} loading={pagosLoading} onRow={abrirPorPago} filtro={filtro} onLimpiarFiltro={() => setFiltro(null)} />
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
    </div>
  );
}

/**
 * Registro de los últimos pagos ingresados. Se muestra al entrar a Pagos (sin búsqueda
 * activa) para dar acceso rápido: tocar una fila abre la ficha del cliente, desde donde
 * se puede anular el cobro. Si no hay pagos aún, cae al hero de "buscá un cliente".
 */
function UltimosPagos({ pagos, loading, onRow, filtro, onLimpiarFiltro }: {
  pagos: Pago[];
  loading: boolean;
  onRow: (p: Pago) => void;
  filtro: "hoy" | "anulados" | null;
  onLimpiarFiltro: () => void;
}) {
  const hoyYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  /**
   * El filtro acota lo que se MUESTRA de esta lista; no redefine el número de la tarjeta.
   * `fecha` es un `@db.Date`, así que se compara el día pelado del string ISO — pasarlo por
   * `new Date()` en zona argentina lo correría al día anterior.
   */
  const visibles = !filtro
    ? pagos
    : filtro === "anulados"
      ? pagos.filter((p) => p.anulado)
      : pagos.filter((p) => !p.anulado && String(p.fecha).slice(0, 10) === hoyYmd);

  if (loading) {
    return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }
  if (pagos.length === 0) return <HeroVacio />;

  const titulo = filtro === "hoy" ? "Cobros de hoy" : filtro === "anulados" ? "Pagos anulados" : "Últimos pagos ingresados";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
          filtro === "anulados" ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-primary/20 bg-primary/10 text-primary"
        }`}>
          <Clock className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
          <p className="text-xs text-muted-foreground">Tocá un pago para abrir la ficha del cliente y anularlo si hace falta.</p>
        </div>
        {filtro && (
          <button
            type="button"
            onClick={onLimpiarFiltro}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <X className="h-3 w-3" /> Quitar filtro
          </button>
        )}
      </div>
      {visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground/60">
          {filtro === "hoy" ? "Todavía no entró ningún cobro hoy." : "No hay pagos anulados entre los últimos ingresados."}
        </p>
      ) : (
      <DataTable
        rows={visibles}
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
            cell: (p) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge label={p.metodo} variant="muted" />
                {/* Un adelanto no es una cuota: entra por el mismo camino y se imputa igual,
                    así que sin decirlo la fila no se distingue de un cobro común. */}
                {p.acuerdo_entrega && <StatusBadge label="Entrega de acuerdo" variant="primary" />}
              </div>
            ) },
          { header: "Estado", align: "center",
            cell: (p) => p.anulado
              ? <StatusBadge label="Anulado" variant="destructive" />
              : <StatusBadge label="Registrado" variant="success" /> },
        ]}
      />
      )}
    </div>
  );
}

/**
 * EL PULSO DEL DÍA. Lo primero que quiere saber quien abre la terminal: cuánto entró hoy,
 * cuántos cobros fueron, cómo se pagó y qué se anuló.
 *
 * 🔴 LOS NÚMEROS SALEN DEL ENDPOINT, agregados sobre toda la tabla (`resumen` de
 * `GET /api/pagos`). Sumar la lista que se ve abajo daría el total de los primeros 100 pagos
 * disfrazado de total del día: arrancaría bien y empezaría a mentir solo cuando la financiera
 * opere de verdad.
 *
 * Las dos tarjetas que son un SUBCONJUNTO de la lista de abajo filtran esa lista al tocarlas.
 */
function KpisDelDia({ resumen, loading, filtro, onFiltro }: {
  resumen?: ResumenPagos;
  loading: boolean;
  filtro: "hoy" | "anulados" | null;
  onFiltro: (f: "hoy" | "anulados" | null) => void;
}) {
  if (loading || !resumen) {
    return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;
  }

  const totalHoy = Object.values(resumen.por_metodo_hoy).reduce((a, b) => a + b, 0);
  const efectivo = resumen.por_metodo_hoy.efectivo ?? 0;
  const transferencia = resumen.por_metodo_hoy.transferencia ?? 0;
  const otros = round2(totalHoy - efectivo - transferencia);
  const pct = (x: number) => (totalHoy > 0 ? Math.round((x / totalHoy) * 100) : 0);
  const v = resumen.variacion_pct;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Cobrado hoy — el número que se compara contra la caja al cerrar. */}
      <Caja label="Cobrado hoy">
        <p className="font-mono text-2xl font-bold tabular-nums text-foreground">{formatMonto(resumen.cobrado_hoy)}</p>
        {v == null ? (
          <p className="mt-1 text-[11px] text-muted-foreground/60">ayer no entró nada</p>
        ) : (
          <p className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${v >= 0 ? "text-success" : "text-destructive"}`}>
            {v >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(v).toFixed(0)}% vs ayer
            {/* De dónde sale el porcentaje: el importe con el que se compara, no solo la flecha. */}
            <span className="font-mono font-normal text-muted-foreground/60">· {formatMonto(resumen.cobrado_ayer)}</span>
          </p>
        )}
      </Caja>

      {/* Pagos hoy — subconjunto de la lista: filtra. */}
      <Caja
        label="Pagos hoy"
        activo={filtro === "hoy"}
        onClick={() => onFiltro(filtro === "hoy" ? null : "hoy")}
      >
        <p className="font-mono text-2xl font-bold tabular-nums text-foreground">{resumen.pagos_hoy}</p>
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          {resumen.clientes_hoy} cliente{resumen.clientes_hoy === 1 ? "" : "s"} distinto{resumen.clientes_hoy === 1 ? "" : "s"}
        </p>
      </Caja>

      {/* Cómo entró la plata. El reparto se lee de un vistazo antes de arquear. */}
      <Caja label="Efectivo / Transferencia">
        {totalHoy === 0 ? (
          <>
            <p className="font-mono text-2xl font-bold text-muted-foreground/40">—</p>
            <p className="mt-1 text-[11px] text-muted-foreground/60">sin cobros hoy</p>
          </>
        ) : (
          <>
            <p className="font-mono text-2xl font-bold tabular-nums">
              <span className="text-foreground">{pct(efectivo)}%</span>
              <span className="text-muted-foreground/30"> / </span>
              <span className="text-primary">{pct(transferencia)}%</span>
            </p>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted/40">
              <div className="bg-foreground/70" style={{ width: `${pct(efectivo)}%` }} />
              <div className="bg-primary" style={{ width: `${pct(transferencia)}%` }} />
              {otros > 0.01 && <div className="bg-warning" style={{ width: `${pct(otros)}%` }} />}
            </div>
            {otros > 0.01 && (
              <p className="mt-1.5 text-[11px] text-warning">otros medios {pct(otros)}% · {formatMonto(otros)}</p>
            )}
          </>
        )}
      </Caja>

      {/* Anulados — control de tesorería: es plata que entró y se dio marcha atrás. */}
      <Caja
        label="Anulados (30 días)"
        activo={filtro === "anulados"}
        onClick={() => onFiltro(filtro === "anulados" ? null : "anulados")}
      >
        <p className="font-mono text-2xl font-bold tabular-nums text-foreground">{resumen.anulados_30d}</p>
        <p className={`mt-1 font-mono text-[11px] tabular-nums ${resumen.anulados_30d_monto > 0 ? "text-destructive" : "text-muted-foreground/60"}`}>
          {resumen.anulados_30d_monto > 0 ? `−${formatMonto(resumen.anulados_30d_monto)}` : formatMonto(0)}
        </p>
      </Caja>
    </div>
  );
}

/** La caja de un KPI. Es un <button> cuando filtra, para que se pueda tabular y activar con Enter. */
function Caja({ label, children, onClick, activo }: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  activo?: boolean;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`w-full rounded-xl border bg-card p-4 text-left transition-colors ${
        activo ? "border-primary bg-primary/[0.04]" : "border-border"
      } ${onClick ? "cursor-pointer hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" : ""}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="mt-2">{children}</div>
    </Wrapper>
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
