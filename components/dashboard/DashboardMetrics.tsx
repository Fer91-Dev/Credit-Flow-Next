"use client";

import { Target } from "lucide-react";
import { useDashboard, type DashboardData, type DashboardFiltros } from "@/lib/swr";
import { KpiCard } from "@/components/ui/KpiCard";
import { NumeroAnimado } from "@/components/ui/NumeroAnimado";
import { IconBadge } from "@/components/ui/IconBadge";
import { Skeleton } from "@/components/ui/skeleton";

function n0(num: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
}

export function DashboardMetrics({ filtros }: { filtros?: DashboardFiltros }) {
  const { data, error, isLoading } = useDashboard(filtros);

  if (isLoading) return <BodySkeleton />;
  if (error || !data) return (
    <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
      {error?.message || "Sin datos disponibles"}
    </div>
  );
  return <CarteraBody data={data} />;
}

function BodySkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
      </div>
    </div>
  );
}

/** Skeleton solo de los 4 KPIs (para el Home, que reordena las piezas). */
export function DashboardKpisSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
    </div>
  );
}

function CarteraBody({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-6">
      <DashboardCobranzaAvance data={data} />
      <DashboardKpis data={data} />
      <DashboardMoraGrid data={data} />
    </div>
  );
}

/* ── Piezas reutilizables (el Home las reordena; la Cartera usa el orden de arriba) ── */

/**
 * Los KPIs principales.
 *
 * 🔴 "Cartera total" pasó a llamarse DINERO EN LA CALLE. Es el mismo número —el capital que
 * salió y todavía no volvió— con el nombre que usa quien presta, no el del balance. Y ahora
 * lleva debajo lo que falta cobrar (capital + interés + cargos), que es el otro número que
 * define el negocio y no estaba en ningún lado: la calle dice cuánto se puso, "a cobrar" dice
 * cuánto tiene que volver.
 *
 * Los importes CUENTAN al aparecer y al refrescarse. No es decoración: el panel se actualiza
 * solo, y un número que cambia sin transición es indistinguible de uno que no cambió.
 */
export function DashboardKpis({ data }: { data: DashboardData }) {
  const { resumen } = data;
  const enCalle = resumen.capital_en_calle ?? resumen.cartera_total;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div className="animate-entrada">
        <KpiCard
          icon="busts-in-silhouette" label="Clientes activos" accent="primary"
          value={<NumeroAnimado valor={resumen.clientes_activos} />}
        />
      </div>
      <div className="animate-entrada" style={{ animationDelay: "70ms" }}>
        <KpiCard
          icon="chart-increasing" label="Créditos activos" accent="primary"
          value={<NumeroAnimado valor={resumen.creditos_activos} />}
          sub={`${resumen.creditos_pagados} pagados`}
        />
      </div>
      <div className="animate-entrada" style={{ animationDelay: "140ms" }}>
        <KpiCard
          icon="money-with-wings" label="Dinero en la calle" accent="success" mono
          value={<NumeroAnimado valor={enCalle} decimales={2} prefijo="$" />}
          sub={
            <span className="tabular-nums">
              a cobrar{" "}
              <span className="font-mono text-foreground/70">
                <NumeroAnimado valor={resumen.a_cobrar_total ?? 0} decimales={2} prefijo="$" />
              </span>
            </span>
          }
        />
      </div>
      <div className="animate-entrada" style={{ animationDelay: "210ms" }}>
        <KpiCard
          icon="warning" label="Mora crítica"
          value={<NumeroAnimado valor={resumen.mora_critica_count} />}
          sub={resumen.mora_critica_count > 0 ? "requieren gestión urgente" : "sin atrasos críticos"}
          accent={resumen.mora_critica_count > 0 ? "destructive" : "success"}
          pulse={resumen.mora_critica_count > 0}
        />
      </div>
    </div>
  );
}

/**
 * El PULSO del día: lo que entró hoy, en vivo.
 *
 * Silvio abre el panel y lo deja abierto. Sin esto, la única forma de saber si hubo movimiento
 * era comparar de memoria contra lo que había visto un rato antes. El punto que late dice que
 * el dato está fresco; la hora dice desde cuándo.
 */
export function PulsoDelDia({ data, actualizado }: { data: DashboardData; actualizado?: Date | null }) {
  const hoy = data.hoy ?? { cobrado: 0, cobros: 0 };
  const hubo = hoy.cobros > 0;
  return (
    <div className={`animate-entrada flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border px-5 py-3 ${
      hubo ? "border-success/30 bg-success/[0.06]" : "border-border/70 bg-card"
    }`}>
      <span className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full animate-latido-vivo ${hubo ? "bg-success" : "bg-muted-foreground/50"}`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${hubo ? "bg-success" : "bg-muted-foreground/50"}`} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Hoy</span>
      </span>

      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-xl font-bold tabular-nums ${hubo ? "text-success" : "text-muted-foreground"}`}>
          <NumeroAnimado valor={hoy.cobrado} decimales={2} prefijo="$" />
        </span>
        <span className="text-xs text-muted-foreground">
          cobrados en {hoy.cobros} {hoy.cobros === 1 ? "operación" : "operaciones"}
        </span>
      </div>

      {actualizado && (
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/70">
          actualizado {actualizado.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      )}
    </div>
  );
}

/** Barra de avance de cobranzas del mes. */
export function DashboardCobranzaAvance({ data }: { data: DashboardData }) {
  const { cobranza_mes } = data;
  return <AvanceCobranzas esperado={cobranza_mes.esperado} cobrado={cobranza_mes.cobrado} cuotas={cobranza_mes.cuotas_total} />;
}

/** Fila secundaria: distribución de mora · exposición en mora · cobros registrados. */
export function DashboardMoraGrid({ data }: { data: DashboardData }) {
  const { mora, transacciones } = data;
  const totalMoraItems = mora.detalle.dias_1_30 + mora.detalle.dias_31_60 + mora.detalle.dias_60_mas;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

      {/* Distribución mora */}
      <div className="group rounded-xl bg-card border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <IconBadge emoji="alarm-clock" accent="warning" hoverable />
          <h3 className="text-sm font-semibold text-foreground">Distribución de mora</h3>
        </div>
        <div className="space-y-3">
          <MoraRow label="1–30 días" count={mora.detalle.dias_1_30} total={totalMoraItems} variant="warning" />
          <MoraRow label="31–60 días" count={mora.detalle.dias_31_60} total={totalMoraItems} variant="destructive" />
          <MoraRow label="60+ días" count={mora.detalle.dias_60_mas} total={totalMoraItems} variant="destructive" bold />
        </div>
        {totalMoraItems === 0 && (
          <p className="text-xs text-success mt-3">Sin créditos en mora</p>
        )}
      </div>

      {/* Montos en mora */}
      <div className="group rounded-xl bg-card border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <IconBadge emoji="money-bag" accent="destructive" hoverable />
          <h3 className="text-sm font-semibold text-foreground">Exposición en mora</h3>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Total en mora</p>
            <p className="text-2xl font-bold text-warning font-mono">${n0(mora.montos.total_mora)}</p>
          </div>
          <div className="border-t border-border" />
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Mora crítica (30+ días)</p>
            <p className="text-2xl font-bold text-destructive font-mono">${n0(mora.montos.mora_critica)}</p>
          </div>
        </div>
      </div>

      {/* Cobros */}
      <div className="group rounded-xl bg-card border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <IconBadge emoji="dollar-banknote" accent="success" hoverable />
          <h3 className="text-sm font-semibold text-foreground">Cobros registrados</h3>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Cantidad de pagos</p>
            <p className="text-3xl font-bold text-foreground">{transacciones.total_pagos_registrados}</p>
          </div>
          <div className="border-t border-border" />
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Monto total cobrado</p>
            <p className="text-2xl font-bold text-success font-mono">${n0(transacciones.monto_pagos_total)}</p>
          </div>
        </div>
      </div>

    </div>
  );
}

function AvanceCobranzas({
  esperado, cobrado, cuotas,
}: {
  esperado: number; cobrado: number; cuotas: number;
}) {
  const pct = esperado > 0 ? Math.min(100, Math.round((cobrado / esperado) * 100)) : 0;
  const pendiente = Math.max(0, esperado - cobrado);

  // Color del progreso según avance
  const barColor =
    pct >= 80 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-destructive";
  const pctColor =
    pct >= 80 ? "text-success" : pct >= 50 ? "text-warning" : "text-destructive";

  return (
    <div className="group rounded-xl bg-card border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <IconBadge emoji="chart-increasing" accent="primary" hoverable />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Avance de cobranzas</h3>
            <p className="text-[11px] text-muted-foreground">
              Mes en curso · {cuotas} {cuotas === 1 ? "cuota" : "cuotas"}
            </p>
          </div>
        </div>
        <span className={`text-2xl font-bold font-mono ${pctColor}`}>{pct}%</span>
      </div>

      {/* Barra de progreso */}
      <div className="h-2.5 w-full rounded-full bg-muted/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Cifras */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Cobrado</p>
          <p className="text-sm font-bold text-success font-mono">${n0(cobrado)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Esperado</p>
          <p className="text-sm font-bold text-foreground font-mono">${n0(esperado)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Pendiente</p>
          <p className="text-sm font-bold text-warning font-mono">${n0(pendiente)}</p>
        </div>
      </div>

      {esperado === 0 && (
        <p className="text-xs text-muted-foreground mt-3">Sin cuotas con vencimiento este mes</p>
      )}
    </div>
  );
}

function MoraRow({
  label, count, total, variant, bold,
}: {
  label: string; count: number; total: number; variant: "warning" | "destructive"; bold?: boolean;
}) {
  const colorText  = variant === "warning" ? "text-warning" : "text-destructive";
  const colorBar   = variant === "warning" ? "bg-warning" : "bg-destructive";
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-sm font-mono ${bold ? "font-bold" : "font-semibold"} ${count > 0 ? colorText : "text-muted-foreground/30"}`}>
          {count}
        </span>
      </div>
      {total > 0 && (
        <div className="h-1 w-full rounded-full bg-muted/40 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${count > 0 ? colorBar : "bg-transparent"}`}
            style={{ width: `${pct}%`, opacity: 0.6 }}
          />
        </div>
      )}
    </div>
  );
}
