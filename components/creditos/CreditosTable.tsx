"use client";

import { estadoBadgeCredito } from "./estado-badge";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { FileText, ChevronDown, X, RefreshCw, History } from "lucide-react";
import { CreditoDetail } from "./CreditoDetail";
import { RefinanciarDialog } from "./RefinanciarDialog";
import { CompararRefiDialog } from "./CompararRefiDialog";
import { useCreditos, KEYS, type Credito, useTramosMora, useDiasLegales } from "@/lib/swr";
import { type Role } from "@/lib/auth/roles";
import { formatCreditoNumero, nombreCompleto, formatFecha, formatFechaHora, eventoPropio, teclaDelContenedor, formatDias, formatMonto } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { AccionPrimaria } from "@/components/ui/AccionPrimaria";
import { Emoji } from "@/components/ui/Emoji";
import { FiltrosPanel } from "@/components/ui/FiltrosPanel";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { esCreditoVivo, severidadMora } from "@/lib/domain";

const SEL =
  "h-10 rounded-lg border border-border bg-muted/40 pl-3 pr-8 text-sm text-foreground " +
  "outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

// Nombre visible de cada filtro. Es lo que muestra el propio botón "Filtrar" cuando hay uno puesto.
const ESTADO_FILTRO_LABEL: Record<string, string> = { activo: "Activos", pagado: "Pagados", refinanciado: "Refinanciados", anulado: "Anulados" };
const TIPO_FILTRO_LABEL: Record<string, string> = { personal: "Personal", productos: "Producto" };
const MORA_FILTRO_LABEL: Record<string, string> = { al_dia: "Al día", en_mora: "En mora", critica: "Mora crítica" };

/**
 * Estado COMO SE LEE. Un crédito con cuotas vencidas mostraba "Activo", el mismo badge y el
 * mismo color que uno que viene pagando en fecha: el atraso vivía en otra columna y había que
 * cruzar dos datos para saber si el cliente debe. El estado GUARDADO no cambia — esto es
 * presentación. La mora llega en vivo desde la lista, nunca del cache.
 */

export function CreditosTable({ role }: { role: Role }) {
  /** A cuántos días de atraso el crédito pasa a Legales (Configuración → Cobranza). */
  const diasLegales = useDiasLegales();

  /** Los cortes media/alta/crítica que definió la financiera (Configuración → Cobranza). */
  const tramos = useTramosMora();
  const router = useRouter();
  const { creditos, error, isLoading, mutate } = useCreditos();
  const [detail, setDetail]       = useState<Credito | null>(null);
  const [refinanciar, setRefinanciar] = useState<Credito | null>(null);
  const [search, setSearch]       = useState("");
  const [estadoFilter, setEstado] = useState("all");
  const [tipoFilter, setTipo]     = useState("all");
  const [moraFilter, setMora]     = useState("all");
  const [tab, setTab]             = useState<"creditos" | "refinanciados">("creditos");

  /**
   * Acá solo se DA DE ALTA. Anular y eliminar se disparan desde el detalle, que es donde se
   * ve contra qué se está decidiendo.
   *
   * Y no hay "editar": las condiciones de un crédito otorgado son firmes, así que el
   * formulario solo podía cambiar el `tipo_credito` mientras abría el simulador entero sobre
   * un crédito vivo, con el plan recalculado desde hoy. Para cambiar algo real están anular y
   * refinanciar.
   */
  const openNew = () => router.push("/creditos/nuevo");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qNum = q.replace(/[^0-9]/g, ""); // dígitos del término (para buscar por número)
    return creditos.filter(c =>
      (!q
        || nombreCompleto(c.cliente).toLowerCase().includes(q)
        || formatCreditoNumero(c.numero, c.refinancia_a_numero).toLowerCase().includes(q)
        || (!!qNum && c.numero != null && String(c.numero).includes(qNum))) &&
      (estadoFilter === "all" || c.estado === estadoFilter) &&
      (tipoFilter === "all" || c.tipo_credito === tipoFilter) &&
      (moraFilter === "all"
        || (moraFilter === "al_dia" && c.dias_mora === 0)
        || (moraFilter === "en_mora" && c.dias_mora > 0)
        || (moraFilter === "critica" && severidadMora(c.dias_mora, tramos) === "critica"))
    );
  }, [creditos, search, estadoFilter, tipoFilter, moraFilter]);

  /**
   * KPIs de TODA la cartera (foto del negocio, no dependen del filtro puesto).
   *
   * Cada tarjeta lleva además el DATO que la explica, no una frase: cuántos de los activos
   * están al día y cuántos atrasados, cuánto es la cuota promedio de la cartera, cuánta plata
   * hay parada en la mora crítica. Un número solo dice "5" y no dice si eso son $50.000 o
   * $5.000.000 — que es lo que cambia qué se hace el lunes.
   */
  const kpis = useMemo(() => {
    // Cartera VIVA: incluye los vencidos, que siguen siendo plata en la calle.
    const vivos = creditos.filter(c => esCreditoVivo(c.estado));
    const criticos = creditos.filter(c => severidadMora(c.dias_mora, tramos) === "critica");
    const pagados = creditos.filter(c => c.estado === "pagado");
    const cartera = vivos.reduce((s, c) => s + c.saldo_pendiente, 0);
    return {
      activos:       vivos.length,
      alDia:         vivos.filter(c => c.dias_mora === 0).length,
      enMora:        vivos.filter(c => c.dias_mora > 0).length,
      cartera,
      // Promedio por crédito vivo: dice si la cartera son pocos grandes o muchos chicos.
      promedio:      vivos.length > 0 ? cartera / vivos.length : 0,
      moraCritica:   criticos.length,
      // La plata parada en mora crítica. El conteo solo no alcanza para dimensionar el riesgo.
      montoCritico:  criticos.reduce((s, c) => s + c.saldo_pendiente, 0),
      pagados:       pagados.length,
      // Capital que se prestó y volvió completo (los ya cancelados).
      montoPagado:   pagados.reduce((s, c) => s + c.monto_original, 0),
      total:         creditos.length,
    };
  }, [creditos, tramos]);

  const totals = useMemo(() => ({
    monto:  filtered.reduce((s, c) => s + c.monto_original, 0),
    saldo:  filtered.reduce((s, c) => s + c.saldo_pendiente, 0),
  }), [filtered]);

  // Cantidad de créditos nacidos de una refinanciación (badge de la pestaña).
  const refiCount = useMemo(() => creditos.filter((c) => c.es_refinanciacion).length, [creditos]);

  const hasFilters = !!(search || estadoFilter !== "all" || tipoFilter !== "all" || moraFilter !== "all");
  /** Los filtros puestos, con el nombre que ve el usuario (el texto de búsqueda no cuenta: tiene su propia X). */
  const etiquetasFiltro = [
    estadoFilter !== "all" ? ESTADO_FILTRO_LABEL[estadoFilter] ?? estadoFilter : null,
    tipoFilter   !== "all" ? TIPO_FILTRO_LABEL[tipoFilter]     ?? tipoFilter   : null,
    moraFilter   !== "all" ? MORA_FILTRO_LABEL[moraFilter]     ?? moraFilter   : null,
  ].filter((x): x is string => !!x);
  const filtrosActivos = etiquetasFiltro.length;
  /**
   * Lo que dice el botón cuando hay algo puesto. Con UNO se nombra —"Mora crítica" dice más
   * que "Filtrar 1"—; con varios no entran en un botón, así que se cuentan y el detalle se ve
   * abriendo el panel, que es donde además se cambian.
   */
  const resumenFiltros =
    filtrosActivos === 1 ? etiquetasFiltro[0] :
    filtrosActivos > 1   ? `${filtrosActivos} filtros` : undefined;
  const clearFilters = () => { setSearch(""); setEstado("all"); setTipo("all"); setMora("all"); };

  /*
    El emoji es `handshake` y no `credit-card` a propósito: la sección se llama Créditos y ya
    lleva la tarjeta en el PageHeader, y acá el negocio no es una tarjeta de crédito sino un
    préstamo que se pacta. El MISMO emoji lo usa el modal que abre este botón.
  */
  // `size="lg"` para que quede a la misma altura que el buscador con el que comparte renglón.
  const cta = <AccionPrimaria size="lg" emoji="handshake" onClick={openNew}>Nuevo crédito</AccionPrimaria>;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          icon="credit-card"
          title="Créditos"
          subtitle="Créditos otorgados y seguimiento de saldos"
          accent="primary"
        />

        {/*
          ── Pestañas (Créditos / Refinanciados) + CTA ──

          Parten la pantalla en dos vistas distintas y antes pesaban menos que un filtro: una
          píldora gris de 1,5 de alto. Ahora el contenedor es un POZO (sombra interior, la
          misma idea que los inputs) y la pestaña activa sale del pozo — elevada, con el
          anillo del acento. Así se lee cuál está puesta sin tener que comparar dos grises.

          El contador va en las DOS, no solo en Refinanciados: un número suelto de un lado
          parecía una alerta y no lo que es, la cantidad de filas que hay en esa vista.
        */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/*
            ── IZQUIERDA: buscar y luego el CTA. Derecha: las pestañas. ──

            🔴 La búsqueda va ACÁ ARRIBA, pegada a "Nuevo crédito", no debajo de los KPI.
            Son las dos cosas que se hacen al entrar —buscar a alguien, o dar de alta— y
            tenerlas separadas por la fila de tarjetas obligaba a bajar la vista para lo
            más frecuente. El filtro viaja DENTRO de la caja de búsqueda (`accionDerecha`),
            así que los tres controles ocupan un solo renglón.

            🔴 El contenedor se renderiza SIEMPRE, aunque esté vacío. En "Refinanciados" no
            hay ni buscador ni CTA, y sin este div el `justify-between` se queda con un solo
            hijo y le manda las pestañas a la izquierda: al cambiar de pestaña saltaban de un
            lado al otro de la pantalla. El hueco las deja quietas.
          */}
          <div className="flex flex-1 flex-wrap items-center gap-3 sm:flex-none">
            {tab === "creditos" && (
              <>
                <BuscadorF3
                  // El mismo campo grande de la terminal de Pagos: es el control con el que
                  // más se trabaja de la pantalla y ahora lo parece.
                  size="lg"
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar por cliente o N° (CRD-…)…"
                  // F3 limpia la búsqueda Y los filtros: limpiar solo el texto no alcanzaba
                  // si lo puesto era un filtro de estado o mora (y con la búsqueda vacía
                  // parecía que la tecla no hacía nada). No se anuncia en pantalla.
                  onF3={() => { setSearch(""); setEstado("all"); setTipo("all"); setMora("all"); }}
                  // Ancho fijo en desktop: `w-full` empujaría el CTA al renglón siguiente.
                  // La caja carga adentro el botón de filtros, así que necesita aire.
                  className="w-full sm:w-[34rem]"
                  accionDerecha={
                    <FiltrosPanel
                      // "Filtrar" y no "Filtros": el renglón es una fila de acciones
                      // (buscar, filtrar, dar de alta), y un sustantivo entre dos verbos se
                      // lee como un rótulo y no como algo que se puede apretar.
                      label="Filtrar"
                      // Con algo puesto el botón deja de decir "Filtrar" y dice QUÉ filtra.
                      resumen={resumenFiltros}
                      activos={filtrosActivos}
                      onLimpiar={() => { setEstado("all"); setTipo("all"); setMora("all"); }}
                      align="right"
                    >
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Estado</span>
                        <div className="relative">
                          <select value={estadoFilter} onChange={e => setEstado(e.target.value)} className={SEL}>
                            <option value="all">Todos los estados</option>
                            <option value="activo">Activos</option>
                            <option value="pagado">Pagados</option>
                            <option value="refinanciado">Refinanciados</option>
                            <option value="anulado">Anulados</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Tipo</span>
                        <div className="relative">
                          <select value={tipoFilter} onChange={e => setTipo(e.target.value)} className={SEL}>
                            <option value="all">Todos los tipos</option>
                            <option value="personal">Personal</option>
                            <option value="productos">Producto</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Mora</span>
                        <div className="relative">
                          <select value={moraFilter} onChange={e => setMora(e.target.value)} className={SEL}>
                            <option value="all">Cualquier estado de mora</option>
                            <option value="al_dia">Al día</option>
                            <option value="en_mora">En mora (1+ días)</option>
                            <option value="critica">Mora crítica (+30 días)</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        </div>
                      </label>
                    </FiltrosPanel>
                  }
                />
                {cta}
              </>
            )}
          </div>
          {/* Sin borde: el pozo ya se lee por el fondo y la sombra interior, y la línea de
              alrededor competía con el anillo de la pestaña activa. */}
          <div className="inline-flex items-center gap-1 rounded-xl bg-muted/40 p-1 shadow-[inset_0_1px_3px_0_rgba(0,0,0,0.20)]">
            {([
              { id: "creditos" as const,      emoji: "credit-card",                  label: "Créditos",      count: creditos.length, tone: "text-muted-foreground" },
              { id: "refinanciados" as const, emoji: "counterclockwise-arrows-button", label: "Refinanciados", count: refiCount,       tone: "text-warning" },
            ]).map((t) => {
              const activa = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-pressed={activa}
                  className={`group flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                    activa
                      ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.28),0_6px_14px_-8px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-primary/30"
                      : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
                  }`}
                >
                  <Emoji
                    name={t.emoji}
                    className={`h-4 w-4 transition-all duration-200 ${activa ? "" : "opacity-60 group-hover:opacity-100 group-hover:scale-110"}`}
                  />
                  {t.label}
                  {t.count > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      activa ? `bg-muted ${t.tone}` : "bg-muted/60 text-muted-foreground"
                    }`}>
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <BodySkeleton />
        ) : error ? (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
            Error al cargar créditos: {error.message}
          </div>
        ) : tab === "refinanciados" ? (
          <RefinanciadosView creditos={creditos} onOpen={setDetail} onRefinanciar={setRefinanciar} />
        ) : (
        <div className="space-y-5">

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/*
            Los KPI mueven los MISMOS filtros del panel de abajo, no unos propios: si no se
            hablaran, la tabla mostraría una cosa y los chips de filtro dirían otra.
            "Cartera activa" es una suma de pesos y no filtra — no hay "los créditos de la
            cartera activa" distintos de los activos, que ya tienen su tarjeta.
          */}
          <KpiCard
            icon="page-facing-up" label="Créditos activos" value={String(kpis.activos)} accent="primary"
            // Cuántos de esos activos vienen bien y cuántos no: el total solo no distingue
            // una cartera sana de una que está por explotar.
            sub={kpis.activos > 0 ? `${kpis.alDia} al día · ${kpis.enMora} en mora` : "ninguno vivo"}
            onClick={kpis.activos > 0 ? () => { setEstado("activo"); setMora("all"); } : undefined}
            active={estadoFilter === "activo" && moraFilter === "all"}
          />
          <KpiCard
            icon="money-bag" label="Cartera activa" value={formatMonto(kpis.cartera)} accent="success" mono
            // De dónde sale el número: entre cuántos créditos se reparte. Dice si la cartera
            // son pocos grandes o muchos chicos, que es otro riesgo.
            sub={kpis.activos > 0 ? `${kpis.activos} créditos · promedio ${formatMonto(kpis.promedio)}` : "sin saldo por cobrar"}
          />
          <KpiCard
            icon="warning" label="Mora crítica" value={String(kpis.moraCritica)}
            accent={kpis.moraCritica > 0 ? "destructive" : "muted"}
            /*
              El corte NO es fijo: "crítica" es todo lo que pasa `tramos.alta_hasta`, que es un
              parámetro del tenant (Configuración → tramos de mora). Estaba escrito "más de 30
              días" a mano, y con la config actual el corte real son 49: la tarjeta contaba una
              cosa y el rótulo decía otra.
            */
            /*
              Y con la PLATA, no solo el conteo: "5 créditos" no dice si son $50.000 o
              $5.000.000, que es lo que decide si esto se atiende el lunes a primera hora.
            */
            sub={kpis.moraCritica > 0
              ? `${formatMonto(kpis.montoCritico)} · más de ${formatDias(tramos.alta_hasta)}`
              : "sin atrasos críticos"}
            onClick={kpis.moraCritica > 0 ? () => { setMora("critica"); setEstado("all"); } : undefined}
            active={moraFilter === "critica"}
          />
          <KpiCard
            icon="check-mark-button" label="Créditos pagados" value={String(kpis.pagados)} accent="muted"
            // Cuánto capital se prestó y volvió completo, y sobre qué total se mide.
            sub={kpis.pagados > 0
              ? `${formatMonto(kpis.montoPagado)} otorgados · ${kpis.pagados} de ${kpis.total}`
              : `ninguno de ${kpis.total}`}
            onClick={kpis.pagados > 0 ? () => { setEstado("pagado"); setMora("all"); } : undefined}
            active={estadoFilter === "pagado"}
          />
        </div>

        {/*
          ── ENCABEZADO DE LA TABLA ──

          🔴 Los chips de lo filtrado y el conteo VIVEN ACÁ ADENTRO, no en renglones propios.

          Antes cada filtro que se ponía agregaba DOS filas nuevas —una con los chips, otra con
          "5 de 23 créditos · Limpiar filtros"— y la tabla se iba para abajo: al filtrar, la
          pantalla se movía justo cuando el operador iba a leer el resultado. Este renglón
          existe SIEMPRE (es el título de la tabla, que igual hacía falta), así que lo que está
          filtrado aparece y desaparece adentro de él sin correr nada de lugar.
        */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Registro de créditos</h2>
            {/*
              🔴 El conteo va PEGADO al título, como píldora — no suelto al otro extremo.
              Colgado del lado derecho era un número flotando en el aire: no se sabía si
              contaba lo de la tabla, lo de la cartera o lo del filtro. Al lado del título
              queda claro que cuenta ESA lista, y es la misma píldora que ya usan las
              pestañas de arriba, así que el número se lee igual en los dos lugares.
            */}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
              {hasFilters ? `${filtered.length} de ${creditos.length}` : creditos.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {hasFilters && (
              /*
                El atajo se anuncia ACÁ, sobre el botón que hace exactamente lo mismo, y solo
                cuando hay algo que limpiar. No es el renglón de instrucciones que estaba antes
                bajo el buscador —que se leía siempre, incluso sin nada puesto—: es la tecla
                escrita sobre su propia acción, como la muestra cualquier menú.
              */
              <button
                onClick={clearFilters}
                title="Limpiar la búsqueda y los filtros"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" /> Limpiar filtros
                <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">F3</kbd>
              </button>
            )}
          </div>
        </div>

        {/* ── Content ── */}
        {filtered.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onNew={openNew} onClear={clearFilters} />
        ) : (
          <DataTable
            rows={filtered}
            rowKey={(c) => c.id}
            pageSize={12}
            onRowClick={(c) => setDetail(c)}
            zebra
            columns={[
              { header: "N°", className: "whitespace-nowrap",
                cell: (c) => (
                  <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    {formatCreditoNumero(c.numero, c.refinancia_a_numero)}
                    {c.es_refinanciacion && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning" title="Crédito nacido de una refinanciación">
                        <RefreshCw className="h-2.5 w-2.5" /> Refi
                      </span>
                    )}
                  </div>
                ) },
              { header: "Otorgado", className: "whitespace-nowrap",
                cell: (c) => <span className="text-xs text-muted-foreground tabular-nums">{formatFechaHora(c.created_at)}</span> },
              { header: "Cliente",
                cell: (c) => <span className="font-medium text-foreground">{nombreCompleto(c.cliente)}</span> },
              { header: "Agente",
                cell: (c) => <span className="text-sm text-muted-foreground">{c.vendedor?.nombre ?? "—"}</span> },
              { header: "Tipo",
                cell: (c) => <StatusBadge label={c.tipo_credito === "productos" ? "Producto" : c.tipo_credito} variant={c.tipo_credito === "productos" ? "primary" : "muted"} /> },
              { header: "Monto orig.", mono: true,
                cell: (c) => <span className="text-foreground">{formatMonto(c.monto_original)}</span> },
              { header: "Mora", align: "center",
                cell: (c) => c.dias_mora > 0
                  ? <StatusBadge label={formatDias(c.dias_mora)} variant={severidadMora(c.dias_mora, tramos) === "critica" ? "destructive" : "warning"} />
                  : <span className="text-xs font-medium text-success">Al día</span> },
              /*
                Sin columna "Acciones": eran cinco íconos pegados, sin texto, que había que
                recorrer con el mouse para saber cuál era cuál. Ahora la fila hace UNA cosa
                —abrir el detalle— y las acciones viven ahí, con su nombre y al lado de los
                datos contra los que se decide (saldo real, pagos, cuotas).
              */
              { header: "Estado", className: "pr-5",
                cell: (c) => { const est = estadoBadgeCredito(c.estado, c.dias_mora, diasLegales, (c.acuerdo ? { alDia: c.acuerdo.al_dia } : null)); return <StatusBadge label={est.label} variant={est.variant} />; } },
            ]}
            footer={
              /*
                🔴 Los colSpan tienen que sumar la cantidad de columnas. Ya se rompió una vez
                (sumaban 9 contra 11 y los totales caían bajo la columna equivocada). Hoy son
                OCHO: N° · Otorgado · Cliente · Agente · Tipo · Monto orig. · Mora · Estado
                → 5 + 1 + 2.

                🔴 EL SALDO SIGUE ACÁ AUNQUE SE HAYA IDO SU COLUMNA. La columna se sacó porque
                el saldo de cada crédito ya se ve al abrir la fila, pero el TOTAL de lo que
                deben los créditos filtrados no está en ningún otro lado: el KPI "Cartera
                activa" siempre mide la cartera entera, nunca lo filtrado. Sin esto, filtrar
                por "Mora crítica" dejaba de responder cuánta plata hay ahí. Va rotulado,
                porque un número sin columna arriba no se explica solo.
              */
              <tr className="bg-muted/20">
                <td colSpan={5} className="px-4 py-3 border-t border-border">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Totales ({filtered.length})
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Saldo pendiente
                    </span>
                    <span className="font-mono text-sm font-bold text-warning tabular-nums">{formatMonto(totals.saldo)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold text-foreground border-t border-border">{formatMonto(totals.monto)}</td>
                <td colSpan={2} className="border-t border-border pr-5" />
              </tr>
            }
            renderMobileCard={(c) => {
              const est = estadoBadgeCredito(c.estado, c.dias_mora, diasLegales, (c.acuerdo ? { alDia: c.acuerdo.al_dia } : null));
              return (
                <div onClick={(e) => { if (eventoPropio(e)) setDetail(c); }} role="button" tabIndex={0} onKeyDown={(e) => { if (teclaDelContenedor(e) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDetail(c); } }} className="rounded-xl bg-card border border-border p-4 space-y-3 cursor-pointer active:bg-muted/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-[11px] text-muted-foreground">{formatCreditoNumero(c.numero, c.refinancia_a_numero)}</p>
                      <p className="font-medium text-foreground text-sm">{nombreCompleto(c.cliente)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.tipo_credito === "productos" ? "Producto" : c.tipo_credito} · {c.tasa}% TNA · {c.plazo_meses}m</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{formatFechaHora(c.created_at)} · {c.vendedor?.nombre ?? "Sin agente"}</p>
                    </div>
                    <StatusBadge label={est.label} variant={est.variant} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Monto original</p>
                      <p className="font-mono font-semibold text-foreground">{formatMonto(c.monto_original)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Saldo pendiente</p>
                      <p className={`font-mono font-bold ${c.saldo_pendiente > 0 ? "text-warning" : "text-success"}`}>
                        {formatMonto(c.saldo_pendiente)}
                      </p>
                    </div>
                  </div>
                  {/* Mismo criterio que en desktop: la tarjeta abre el detalle y las acciones
                      viven allá. Acá los íconos apretados eran peor todavía — sin hover que
                      revele el título, en un teléfono no hay forma de saber qué hace cada uno. */}
                  <div className="pt-2 border-t border-border/70">
                    {c.dias_mora > 0
                      ? <StatusBadge label={`${formatDias(c.dias_mora)} de mora`} variant={severidadMora(c.dias_mora, tramos) === "critica" ? "destructive" : "warning"} />
                      : <span className="text-xs font-medium text-success">Al día</span>}
                  </div>
                </div>
              );
            }}
          />
        )}
        </div>
        )}
      </div>

      <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}>
        <DialogContent className="w-full max-w-[96vw] lg:max-w-7xl h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
            <DialogTitle>Detalle del crédito</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {detail && (
              <CreditoDetail
                credito={detail}
                role={role}
                onRefinanciar={(c) => { setDetail(null); setRefinanciar(c); }}
                // Saltar al otro extremo de la refinanciación: se cambia el crédito DENTRO del
                // mismo modal, sin cerrarlo y volver a abrirlo.
                onAbrirCredito={(c) => setDetail(c)}
                // Anular/eliminar dejan vieja la copia del crédito que muestra este modal.
                onCerrar={() => { setDetail(null); mutate(); }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <RefinanciarDialog
        credito={refinanciar}
        onClose={(success) => {
          setRefinanciar(null);
          if (success) { mutate(); globalMutate(KEYS.dashboard); }
        }}
      />
    </>
  );
}

/**
 * Vista "Refinanciados": registro de las reestructuraciones (operaciones origen → nuevo).
 * Cada fila es una refinanciación: el crédito nuevo (es_refinanciacion) y su crédito
 * origen resuelto desde la misma lista. Click → abre el detalle del crédito nuevo.
 */
function RefinanciadosView({ creditos, onOpen, onRefinanciar }: { creditos: Credito[]; onOpen: (c: Credito) => void; onRefinanciar: (c: Credito) => void }) {
  /** Los cortes media/alta/crítica que definió la financiera (Configuración → Cobranza). */
  const tramos = useTramosMora();
  const porId = useMemo(() => new Map(creditos.map((c) => [c.id, c])), [creditos]);
  const pares = useMemo(
    () =>
      creditos
        .filter((c) => c.es_refinanciacion)
        .map((nuevo) => ({ nuevo, origen: nuevo.refinancia_a ? porId.get(nuevo.refinancia_a) : undefined }))
        .sort((a, b) => new Date(b.nuevo.created_at).getTime() - new Date(a.nuevo.created_at).getTime()),
    [creditos, porId],
  );

  // Candidatos a refinanciar = créditos activos en mora (lo que el server permite reestructurar).
  const candidatos = useMemo(
    () => creditos.filter((c) => esCreditoVivo(c.estado) && c.dias_mora > 0).sort((a, b) => b.dias_mora - a.dias_mora),
    [creditos],
  );
  const [busq, setBusq] = useState("");
  /**
   * Recorte del historial: todas / las que se están pagando / las que volvieron a mora.
   *
   * No existía. Los KPI decían "12 al día, 5 volvieron a mora" y para saber CUÁLES eran esos
   * 5 —que es la pregunta que importa, porque son los que se reestructuraron y siguen sin
   * pagar— había que recorrer la tabla a ojo.
   */
  const [recupero, setRecupero] = useState<"todas" | "al_dia" | "en_mora">("todas");
  // Comparación original ↔ refinanciación (plan de cuotas + TNA de otorgamiento).
  const [comparar, setComparar] = useState<{ origen: Credito; nuevo: Credito } | null>(null);
  const candFiltrados = useMemo(() => {
    const q = busq.trim().toLowerCase();
    if (!q) return candidatos;
    const qDigits = q.replace(/\D/g, "");
    return candidatos.filter((c) => {
      const num = formatCreditoNumero(c.numero, c.refinancia_a_numero).toLowerCase();
      const nombre = nombreCompleto(c.cliente).toLowerCase();
      const doc = (c.cliente.documento ?? "").replace(/\D/g, "");
      if (num.includes(q) || nombre.includes(q)) return true;
      if (qDigits.length >= 2 && (doc.includes(qDigits) || String(c.numero ?? "") === qDigits)) return true;
      return false;
    });
  }, [candidatos, busq]);

  // KPIs de recupero: ¿las refinanciaciones se pagan (al día) o vuelven a mora?
  // Los KPI cuentan SIEMPRE sobre `pares` (el historial completo): un KPI que se mueve con
  // el filtro deja de ser un KPI.
  const paresVisibles = useMemo(
    () => pares.filter((p) =>
      recupero === "todas" || (recupero === "al_dia" ? p.nuevo.dias_mora === 0 : p.nuevo.dias_mora > 0)),
    [pares, recupero],
  );
  const totalConsolidado = pares.reduce((s, p) => s + p.nuevo.monto_original, 0);
  const alDia = pares.filter((p) => p.nuevo.dias_mora === 0).length;
  const enMora = pares.filter((p) => p.nuevo.dias_mora > 0).length;
  const tasaRecupero = pares.length > 0 ? Math.round((alDia / pares.length) * 100) : 0;
  // La PLATA detrás de cada conteo, igual que en la pestaña Créditos: "5 volvieron a mora" no
  // dice si eso es un problema chico o la mitad de la cartera reestructurada.
  const saldoAlDia = pares.filter((p) => p.nuevo.dias_mora === 0).reduce((s, p) => s + p.nuevo.saldo_pendiente, 0);
  const saldoEnMora = pares.filter((p) => p.nuevo.dias_mora > 0).reduce((s, p) => s + p.nuevo.saldo_pendiente, 0);
  const promedioConsolidado = pares.length > 0 ? totalConsolidado / pares.length : 0;

  /** El filtro propio de ESTA sección: cómo viene el recupero. Es su criterio, no el de Créditos. */
  const resumenRecupero = recupero === "al_dia" ? "Al día" : recupero === "en_mora" ? "Volvieron a mora" : undefined;
  const limpiarRecupero = () => { setRecupero("todas"); setBusq(""); };

  return (
    <div className="space-y-6">
      {/* KPIs de la sección (solo si ya hay historial) */}
      {pares.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* "Capital consolidado" es una suma: no hay un subconjunto que le corresponda. */}
          <KpiCard
            icon="counterclockwise-arrows-button" label="Refinanciaciones" value={String(pares.length)} accent="warning"
            sub={`de ${creditos.length} créditos otorgados`}
            onClick={() => setRecupero("todas")}
            active={recupero === "todas"}
          />
          <KpiCard
            icon="money-bag" label="Capital consolidado" value={formatMonto(totalConsolidado)} accent="primary" mono
            sub={`${pares.length} operaci${pares.length !== 1 ? "ones" : "ón"} · promedio ${formatMonto(promedioConsolidado)}`}
          />
          <KpiCard
            icon="check-mark-button" label="Al día (recuperados)" value={String(alDia)} accent="success"
            sub={alDia > 0 ? `${formatMonto(saldoAlDia)} por cobrar · ${tasaRecupero}% de recupero` : "ninguno todavía"}
            onClick={alDia > 0 ? () => setRecupero("al_dia") : undefined}
            active={recupero === "al_dia"}
          />
          <KpiCard
            icon="warning" label="Volvieron a mora" value={String(enMora)}
            accent={enMora > 0 ? "destructive" : "muted"}
            sub={enMora > 0 ? `${formatMonto(saldoEnMora)} otra vez en riesgo` : "ninguno"}
            onClick={enMora > 0 ? () => setRecupero("en_mora") : undefined}
            active={recupero === "en_mora"}
          />
        </div>
      )}

      {/* ── Refinanciar un crédito: buscador + candidatos con acción directa ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold text-foreground">Refinanciar un crédito</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Elegí un crédito <strong className="text-foreground">en mora</strong> para consolidar su deuda viva en un crédito nuevo (con descuento opcional; no mueve caja).
        </p>

        {candidatos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground/60">
            No hay créditos en mora para refinanciar. 🎉
          </p>
        ) : (
          <>
            {/* El mismo campo grande de la pestaña Créditos y de la terminal de Pagos. Sin el
                renglón "Tip: presioná F3 …": el atajo se anuncia sobre el botón que limpia. */}
            <BuscadorF3
              size="lg"
              value={busq}
              onChange={setBusq}
              placeholder="Buscar por N° (CRD-…), DNI o nombre…"
              onF3={limpiarRecupero}
            />
            {candFiltrados.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">Sin resultados para “{busq}”.</p>
            ) : (
              <div className="max-h-[42vh] space-y-2 overflow-auto pr-1">
                {candFiltrados.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/10 px-3 py-2.5">
                    <button onClick={() => onOpen(c)} className="min-w-0 flex-1 text-left" title="Ver detalle del crédito">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground">{formatCreditoNumero(c.numero, c.refinancia_a_numero)}</span>
                        <StatusBadge label={`${formatDias(c.dias_mora)} de mora`} variant={severidadMora(c.dias_mora, tramos) === "critica" ? "destructive" : "warning"} />
                        {c.es_refinanciacion && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning" title="Ya proviene de una refinanciación previa: cuidado con encadenar reestructuraciones">
                            <RefreshCw className="h-2.5 w-2.5" /> re-refi
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {nombreCompleto(c.cliente)}{c.cliente.documento ? ` · DNI ${c.cliente.documento}` : ""}
                      </p>
                    </button>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Saldo</p>
                      <p className="font-mono text-xs font-semibold text-warning tabular-nums">{formatMonto(c.saldo_pendiente)}</p>
                    </div>
                    <button
                      onClick={() => onRefinanciar(c)}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/25"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Refinanciar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Historial de refinanciaciones (antes → después) ── */}
      <div className="space-y-3">
        {/*
          Mismo encabezado que "Registro de créditos": ícono, título, el conteo como píldora
          pegada al título, y a la derecha el filtro. Lo que cambia es el CRITERIO, que es el
          de esta sección: acá no se filtra por estado ni por tipo, sino por cómo viene el
          recupero — si la refinanciación se está pagando o si volvió a mora.
        */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Historial de refinanciaciones</h3>
            {pares.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                {recupero === "todas" ? pares.length : `${paresVisibles.length} de ${pares.length}`}
              </span>
            )}
          </div>
          {pares.length > 0 && (
            <div className="flex items-center gap-3">
              <FiltrosPanel
                label="Filtrar"
                resumen={resumenRecupero}
                activos={recupero === "todas" ? 0 : 1}
                onLimpiar={() => setRecupero("todas")}
                align="right"
                width={280}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Recupero</span>
                  <div className="relative">
                    <select value={recupero} onChange={(e) => setRecupero(e.target.value as typeof recupero)} className={SEL}>
                      <option value="todas">Todas las refinanciaciones</option>
                      <option value="al_dia">Se están pagando (al día)</option>
                      <option value="en_mora">Volvieron a mora</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </label>
              </FiltrosPanel>
              {(recupero !== "todas" || busq) && (
                <button
                  onClick={limpiarRecupero}
                  title="Limpiar la búsqueda y el filtro"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" /> Limpiar filtros
                  <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">F3</kbd>
                </button>
              )}
            </div>
          )}
        </div>

        {pares.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-3 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted/20 border border-border/70 flex items-center justify-center">
              <RefreshCw className="h-6 w-6 text-muted-foreground/20" />
            </div>
            <p className="text-xs text-muted-foreground/60 max-w-xs leading-relaxed">
              Todavía no reestructuraste ningún crédito. Cuando refinancies uno (de la lista de arriba), la operación —deuda vieja → crédito nuevo— aparece acá.
            </p>
          </div>
        ) : (
      <DataTable
        rows={paresVisibles}
        rowKey={(p) => p.nuevo.id}
        pageSize={12}
        onRowClick={(p) => onOpen(p.nuevo)}
        zebra
        columns={[
          { header: "Origen", className: "whitespace-nowrap",
            cell: (p) => <span className="font-mono text-xs text-muted-foreground">{p.origen ? formatCreditoNumero(p.origen.numero) : "—"}</span> },
          { header: "Crédito nuevo", className: "whitespace-nowrap",
            /* El crédito nuevo se nombra por el que reemplaza: en esta tabla el origen está en la
               fila de al lado, así que sale de ahí sin consulta extra. */
            cell: (p) => <span className="inline-flex items-center gap-1.5 font-mono text-xs text-warning"><RefreshCw className="h-3 w-3" />{formatCreditoNumero(p.nuevo.numero, p.origen?.numero)}</span> },
          { header: "Cliente",
            cell: (p) => <span className="font-medium text-foreground">{nombreCompleto(p.nuevo.cliente)}</span> },
          { header: "Capital consolidado", mono: true,
            cell: (p) => <span className="text-foreground">{formatMonto(p.nuevo.monto_original)}</span> },
          { header: "Saldo", mono: true,
            cell: (p) => <span className={p.nuevo.saldo_pendiente > 0 ? "text-warning font-semibold" : "text-success"}>{formatMonto(p.nuevo.saldo_pendiente)}</span> },
          { header: "Mora", align: "center",
            cell: (p) => p.nuevo.dias_mora > 0
              ? <StatusBadge label={formatDias(p.nuevo.dias_mora)} variant={severidadMora(p.nuevo.dias_mora, tramos) === "critica" ? "destructive" : "warning"} />
              : <span className="text-xs font-medium text-success">Al día</span> },
          { header: "Fecha", className: "whitespace-nowrap",
            cell: (p) => <span className="text-xs text-muted-foreground">{formatFecha(p.nuevo.created_at)}</span> },
          { header: "", align: "right", className: "pr-4",
            cell: (p) => {
              const og = p.origen;
              return og ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setComparar({ origen: og, nuevo: p.nuevo }); }}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Comparar el crédito original (plan y TNA) con la refinanciación"
                >
                  <RefreshCw className="h-3 w-3" /> Comparar
                </button>
              ) : <span className="text-xs text-muted-foreground/40">—</span>;
            } },
        ]}
        renderMobileCard={(p) => (
          <div onClick={() => onOpen(p.nuevo)} className="rounded-xl bg-card border border-border p-4 space-y-2 cursor-pointer active:bg-muted/20 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-warning">
                <RefreshCw className="h-3 w-3" />{formatCreditoNumero(p.nuevo.numero, p.origen?.numero)}
              </span>
              {p.nuevo.dias_mora > 0
                ? <StatusBadge label={`${formatDias(p.nuevo.dias_mora)} de mora`} variant={severidadMora(p.nuevo.dias_mora, tramos) === "critica" ? "destructive" : "warning"} />
                : <span className="text-xs font-medium text-success">Al día</span>}
            </div>
            <p className="font-medium text-foreground text-sm">{nombreCompleto(p.nuevo.cliente)}</p>
            <p className="text-[11px] text-muted-foreground">Origen: {p.origen ? formatCreditoNumero(p.origen.numero) : "—"} · {formatFecha(p.nuevo.created_at)}</p>
            <div className="flex items-center justify-between pt-1 border-t border-border/70">
              <span className="text-[10px] text-muted-foreground">Capital consolidado</span>
              <span className="font-mono font-semibold text-foreground">{formatMonto(p.nuevo.monto_original)}</span>
            </div>
            {p.origen && (
              <button
                onClick={(e) => { e.stopPropagation(); setComparar({ origen: p.origen!, nuevo: p.nuevo }); }}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-3 w-3" /> Comparar con el original
              </button>
            )}
          </div>
        )}
      />
        )}
      </div>

      <CompararRefiDialog
        origen={comparar?.origen ?? null}
        nuevo={comparar?.nuevo ?? null}
        onClose={() => setComparar(null)}
        onOpenCredito={(c) => { setComparar(null); onOpen(c); }}
      />
    </div>
  );
}

function EmptyState({ hasFilters, onNew, onClear }: { hasFilters: boolean; onNew: () => void; onClear: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-muted/20 border border-border/70 flex items-center justify-center">
        <FileText className="h-7 w-7 text-muted-foreground/20" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-muted-foreground">
          {hasFilters ? "Sin resultados para los filtros aplicados" : "Sin créditos registrados"}
        </p>
        <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
          {hasFilters ? "Probá ajustando o limpiando los filtros." : "Usá el simulador para crear y calcular el primer crédito."}
        </p>
      </div>
      {hasFilters ? (
        <button onClick={onClear} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors">
          Limpiar filtros
        </button>
      ) : (
        <AccionPrimaria emoji="handshake" onClick={onNew}>Nuevo crédito</AccionPrimaria>
      )}
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-44 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      {/* Desktop: skeleton de tabla (8 columnas) */}
      <div className="rounded-xl border border-border overflow-hidden hidden md:block">
        <div className="bg-muted/30 border-b border-border px-4 py-3 grid grid-cols-8 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-3" />)}
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-border/70 px-4 py-3.5 grid grid-cols-8 gap-4">
            {[...Array(8)].map((_, j) => <Skeleton key={j} className="h-4" />)}
          </div>
        ))}
      </div>
      {/* Mobile: skeleton de tarjetas */}
      <div className="space-y-3 md:hidden">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    </div>
  );
}
