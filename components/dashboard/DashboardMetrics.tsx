"use client";

import { AlertCircle, TrendingUp, Users, Wallet, ArrowUpRight, Clock, Target } from "lucide-react";
import { useDashboard, type DashboardData } from "@/lib/swr";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";

function n0(num: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
}

export function DashboardMetrics() {
  const { data, error, isLoading } = useDashboard();

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

function CarteraBody({ data }: { data: DashboardData }) {
  const { resumen, mora, transacciones, cobranza_mes } = data;
  const totalMoraItems = mora.detalle.dias_1_30 + mora.detalle.dias_31_60 + mora.detalle.dias_60_mas;

  return (
    <div className="space-y-6">

      {/* ── Avance de cobranzas del mes ── */}
      <AvanceCobranzas
        esperado={cobranza_mes.esperado}
        cobrado={cobranza_mes.cobrado}
        cuotas={cobranza_mes.cuotas_total}
      />

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Users}
          label="Clientes activos"
          value={String(resumen.clientes_activos)}
          accent="primary"
        />
        <KpiCard
          icon={TrendingUp}
          label="Créditos activos"
          value={String(resumen.creditos_activos)}
          sub={`${resumen.creditos_pagados} pagados`}
          accent="primary"
        />
        <KpiCard
          icon={Wallet}
          label="Cartera total"
          value={`$${n0(resumen.cartera_total)}`}
          accent="success"
          mono
        />
        <KpiCard
          icon={AlertCircle}
          label="Mora crítica"
          value={String(resumen.mora_critica_count)}
          sub={resumen.mora_critica_count > 0 ? "requieren gestión urgente" : "sin atrasos críticos"}
          accent={resumen.mora_critica_count > 0 ? "destructive" : "success"}
        />
      </div>

      {/* ── Secondary row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Distribución mora */}
        <div className="rounded-xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Distribución de mora</h3>
          </div>
          <div className="space-y-3">
            <MoraRow
              label="1–30 días"
              count={mora.detalle.dias_1_30}
              total={totalMoraItems}
              variant="warning"
            />
            <MoraRow
              label="31–60 días"
              count={mora.detalle.dias_31_60}
              total={totalMoraItems}
              variant="destructive"
            />
            <MoraRow
              label="60+ días"
              count={mora.detalle.dias_60_mas}
              total={totalMoraItems}
              variant="destructive"
              bold
            />
          </div>
          {totalMoraItems === 0 && (
            <p className="text-xs text-success mt-3">Sin créditos en mora</p>
          )}
        </div>

        {/* Montos en mora */}
        <div className="rounded-xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border">
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
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
        <div className="rounded-xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border">
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
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
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border">
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
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
