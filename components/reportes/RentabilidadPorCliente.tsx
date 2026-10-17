"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useReporteClientes, type FilaRentabilidadCliente } from "@/lib/swr";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Emoji } from "@/components/ui/Emoji";
import { formatDias } from "@/lib/utils";
import { HelpHint, type AyudaBloque } from "@/components/configuracion/ConfigForm";

/** La tabla mezcla lo cobrado, lo que falta y lo que se puede perder: sin esto no se lee (Fernando, 17/10/2026). */
const AYUDA_POR_CLIENTE: AyudaBloque = {
  titulo: "Cómo se lee «Por cliente»",
  texto: "Cuánto dejó cada cliente desde su primer crédito, contando las cuotas cobradas antes del sistema. No usa el período de arriba. Las columnas no se suman entre sí: cada una mira la misma cartera desde otro lado.",
  opciones: [
    { opcion: "Prestado", efecto: "La plata que salió de la caja para ese cliente. Sin refinanciaciones (pasan deuda vieja a un crédito nuevo) ni anulados." },
    { opcion: "Cobrado", efecto: "Todo lo que pagó, en el sistema y antes del sistema: la devolución del préstamo más la ganancia." },
    { opcion: "Ganancia cobrada", efecto: "La parte de lo cobrado que no es devolución del préstamo: interés, punitorios y cargos. La tabla se ordena por esta columna." },
    { opcion: "Ganancia por cobrar", efecto: "El interés que falta cobrar de sus créditos abiertos, si paga todo." },
    { opcion: "Deuda vencida", efecto: "Las cuotas vencidas sin pagar (capital + interés, sin punitorios)." },
    { opcion: "En riesgo", efecto: "El capital que falta recuperar de los créditos con el atraso con que hay que refinanciar o más; abajo, el atraso del más atrasado. No se resta de la ganancia hasta declararlo incobrable; si dice «incobrable», ya se restó." },
  ],
  ejemplo: "Prestado $1.416.000,00 y cobrado $1.592.000,00: el cliente ya devolvió $176.000,00 más de lo prestado. Debe $1.330.000,00 vencidos (deuda vencida) y de ese crédito faltan $820.429,61 de capital (en riesgo): es la misma deuda vista de dos formas, no se suman. Aunque no pagara más, ya dejó ganancia.",
  puntos: [
    "Cobrado − Prestado positivo = el cliente ya devolvió todo y dejó ganancia.",
    "«—» en las tres columnas de la derecha = todo cancelado.",
    "Las tarjetas «Deuda vencida» y «En riesgo» filtran la tabla.",
  ],
};

const n2 = (x: number) => x.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (x: number) => `$${n2(x)}`;

type Filtro = "todos" | "vencido" | "riesgo";

/**
 * RENTABILIDAD POR CLIENTE, DESDE EL PRIMER CRÉDITO (Fernando, 16/10/2026). Cuenta lo cobrado
 * antes del sistema. No depende del período de arriba: es el acumulado de cada cliente.
 * "En riesgo" va aparte y no se resta de la ganancia hasta que el crédito se da por incobrable.
 */
export function RentabilidadPorCliente() {
  const { clientes: r, isLoading } = useReporteClientes();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const filas = useMemo(() => {
    const todas = r?.filas ?? [];
    if (filtro === "vencido") return todas.filter((f) => f.deuda_vencida > 0.004).sort((a, b) => b.deuda_vencida - a.deuda_vencida);
    if (filtro === "riesgo") return todas.filter((f) => f.creditos_en_riesgo > 0).sort((a, b) => b.en_riesgo - a.en_riesgo);
    return todas;
  }, [r, filtro]);
  const t = r?.totales;
  const cargando = isLoading || !t;
  const alternar = (f: Filtro) => setFiltro((x) => (x === f ? "todos" : f));

  const columns: Column<FilaRentabilidadCliente>[] = [
    {
      header: "Cliente", movil: "titulo",
      cell: (f) => (
        <div className="min-w-0 leading-tight">
          <span className="block font-semibold text-foreground">{f.cliente}</span>
          <span className="text-[11px] text-muted-foreground">{f.creditos} crédito{f.creditos === 1 ? "" : "s"}</span>
        </div>
      ),
    },
    { header: "Prestado", align: "right", mono: true, cell: (f) => $(f.prestado) },
    { header: "Cobrado", align: "right", mono: true, cell: (f) => <span className="text-success">{$(f.cobrado)}</span> },
    { header: "Ganancia cobrada", align: "right", mono: true, movil: "destacado", cell: (f) => <span className="font-semibold text-foreground">{$(f.ganancia_cobrada)}</span> },
    { header: "Ganancia por cobrar", align: "right", mono: true, cell: (f) => <span className="text-muted-foreground">{f.ganancia_por_cobrar > 0.004 ? $(f.ganancia_por_cobrar) : "—"}</span> },
    {
      header: "Deuda vencida", align: "right", mono: true,
      cell: (f) => f.deuda_vencida > 0.004
        ? <span className="text-warning">{$(f.deuda_vencida)}</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      header: "En riesgo", align: "right", mono: true,
      cell: (f) => f.creditos_en_riesgo > 0 ? (
        <div className="leading-tight">
          <span className="block text-destructive">{$(f.en_riesgo)}</span>
          <span className="text-[11px] text-muted-foreground">{formatDias(f.max_dias_mora)} de atraso</span>
        </div>
      ) : f.castigado > 0.004 ? (
        <div className="leading-tight">
          <span className="block text-destructive">{$(f.castigado)}</span>
          <span className="text-[11px] text-muted-foreground">incobrable</span>
        </div>
      ) : <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Emoji name="busts-in-silhouette" className="h-4 w-4" />
        <h3 className="text-sm font-semibold text-foreground">Por cliente</h3>
        <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          desde el primer crédito · incluye lo cobrado antes del sistema
        </span>
        <div className="ml-auto"><HelpHint ayuda={AYUDA_POR_CLIENTE} /></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard icon="dollar-banknote" label="Prestado" value={t ? $(t.prestado) : ""} accent="primary" mono cargando={cargando}
          sub={t ? `${t.creditos} créditos · ${t.clientes} clientes` : undefined} />
        <KpiCard icon="chart-increasing" label="Cobrado" value={t ? $(t.cobrado) : ""} accent="success" mono cargando={cargando}
          sub={t ? `ganancia cobrada ${$(t.ganancia_cobrada)}` : undefined} />
        <KpiCard icon="bar-chart" label="Ganancia neta" value={t ? $(t.ganancia_neta) : ""} mono cargando={cargando}
          accent={t && t.ganancia_neta < 0 ? "destructive" : "success"}
          sub={t ? [
            `${$(t.ganancia_cobrada)} cobrada`,
            t.comisiones_cobradas !== 0 ? `+ ${$(t.comisiones_cobradas)} comisión` : "",
            `− ${$(t.gastos_caja)} gastos`,
            t.comisiones_pagadas !== 0 ? `− ${$(t.comisiones_pagadas)} comisiones` : "",
            t.castigado !== 0 ? `− ${$(t.castigado)} incobrable` : "",
          ].filter(Boolean).join(" ") : undefined} />
        <KpiCard icon="hourglass-done" label="Ganancia por cobrar" value={t ? $(t.ganancia_por_cobrar) : ""} accent="muted" mono cargando={cargando}
          sub="interés de las cuotas que faltan" />
        <KpiCard icon="warning" label="Deuda vencida" value={t ? $(t.deuda_vencida) : ""} mono cargando={cargando}
          accent={t && t.deuda_vencida > 0 ? "warning" : "muted"}
          sub={t ? `${t.clientes_con_vencido} cliente${t.clientes_con_vencido === 1 ? "" : "s"}` : undefined}
          onClick={t && t.clientes_con_vencido > 0 ? () => alternar("vencido") : undefined} active={filtro === "vencido"} />
        <KpiCard icon="warning" label={r ? `En riesgo (+${formatDias(r.umbral_riesgo_dias)})` : "En riesgo"} value={t ? $(t.en_riesgo) : ""} mono cargando={cargando}
          accent={t && t.en_riesgo > 0 ? "destructive" : "muted"}
          sub={t ? `capital sin recuperar · ${t.creditos_en_riesgo} crédito${t.creditos_en_riesgo === 1 ? "" : "s"}` : undefined}
          onClick={t && t.clientes_en_riesgo > 0 ? () => alternar("riesgo") : undefined} active={filtro === "riesgo"} />
      </div>

      {/* Encabezado de la tabla (patrón de Movimientos de caja): título + conteo en píldora,
          "24 de 65" si una tarjeta la filtra, y el único "Limpiar filtros" a la derecha. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <Emoji name="clipboard" className="h-4 w-4" />
          <h3 className="text-sm font-semibold text-foreground">Rentabilidad por cliente</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
            {!r ? "…" : filtro === "todos" ? r.filas.length : `${filas.length} de ${r.filas.length}`}
          </span>
        </div>
        {filtro !== "todos" && (
          <button
            type="button"
            onClick={() => setFiltro("todos")}
            title="Volver a ver todos los clientes"
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" /> Limpiar filtros
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={filas}
        rowKey={(f) => f.cliente_id}
        loading={isLoading}
        pageSize={15}
        empty={{ icon: "bust-in-silhouette", title: "Sin clientes con créditos" }}
        footer={t && filtro === "todos" ? (
          <tr className="border-t border-border font-semibold">
            <td className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</td>
            <td className="px-3 py-2 text-right font-mono">{$(t.prestado)}</td>
            <td className="px-3 py-2 text-right font-mono text-success">{$(t.cobrado)}</td>
            <td className="px-3 py-2 text-right font-mono">{$(t.ganancia_cobrada)}</td>
            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{$(t.ganancia_por_cobrar)}</td>
            <td className="px-3 py-2 text-right font-mono text-warning">{$(t.deuda_vencida)}</td>
            <td className="px-3 py-2 text-right font-mono text-destructive">{$(round(t.en_riesgo + t.castigado))}</td>
          </tr>
        ) : undefined}
      />
    </div>
  );
}

const round = (x: number) => Math.round(x * 100) / 100;
