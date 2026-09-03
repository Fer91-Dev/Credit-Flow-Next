"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCreditos, type Credito } from "@/lib/swr";
import { DataTable } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { guardarSeleccionCampana, guardarTipoCampana } from "./seleccion-campana";
import { esCreditoVivo } from "@/lib/domain";
import { formatMonto, formatFecha, nombreCompleto, formatCreditoNumero, hoyComercial } from "@/lib/utils";

/** YYYY-MM-DD del día comercial argentino, corrido `n` días. */
function diaISO(n = 0): string {
  const d = hoyComercial();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * VENCIMIENTOS: a quién le vence una cuota en un rango de fechas.
 *
 * ── POR QUÉ ES UNA PESTAÑA APARTE Y NO UN FILTRO DE MOROSOS ──
 *
 * Es otra audiencia y otro mensaje. Morosos son los que YA se atrasaron: ahí hay punitorios
 * corriendo y lo que se manda es un reclamo. Acá están los que están AL DÍA y les vence el
 * jueves: no hay nada que reclamar todavía, se les avisa para que no se atrasen. Mezclarlos
 * en una lista terminaría mandándole a alguien que está al día un mensaje que le habla de
 * una deuda vencida que no tiene.
 *
 * El corte va por `proximo_pago`, que es la fecha de la cuota impaga más vieja y el sistema
 * la mantiene al día. Para alguien al día, esa fecha ES su próximo vencimiento.
 */
export function VencimientosTab() {
  const router = useRouter();
  const { creditos, isLoading } = useCreditos();

  const [desde, setDesde] = useState(diaISO(0));
  const [hasta, setHasta] = useState(diaISO(7));
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());

  const hoy = diaISO(0);

  const filas = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return creditos
      .filter((c) => {
        if (!esCreditoVivo(c.estado) || !c.proximo_pago) return false;
        const f = c.proximo_pago.slice(0, 10);
        // 🔴 Solo lo que NO venció todavía. Un crédito con la cuota vencida ya es un moroso y
        // tiene su propia pestaña, con su propio mensaje: mandarle un "te vence el jueves" a
        // alguien que debe hace dos meses es tratarlo de al día.
        if (f < hoy) return false;
        if (f < desde || f > hasta) return false;
        if (!texto) return true;
        const nom = nombreCompleto(c.cliente).toLowerCase();
        return nom.includes(texto) || (c.cliente?.documento ?? "").includes(texto);
      })
      .sort((a, b) => (a.proximo_pago ?? "").localeCompare(b.proximo_pago ?? ""));
  }, [creditos, desde, hasta, q, hoy]);

  const seleccionados = filas.filter((c) => sel.has(c.id));
  const montoSeleccionado = seleccionados.reduce((s, c) => s + (c.cuota_proxima ?? 0), 0);
  const totalRango = filas.reduce((s, c) => s + (c.cuota_proxima ?? 0), 0);
  const venceHoy = filas.filter((c) => c.proximo_pago?.slice(0, 10) === hoy).length;
  const sinContacto = filas.filter((c) => !c.cliente?.telefono && !c.cliente?.email).length;

  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const armarCampana = () => {
    if (seleccionados.length === 0) return;
    guardarSeleccionCampana(seleccionados.map((c) => c.id));
    // El tipo viaja con la selección: la pantalla de campaña muestra columnas distintas según
    // si va a reclamar mora o a recordar un vencimiento.
    guardarTipoCampana("vencimiento");
    router.push("/cobranza/campanas/nueva");
  };

  const chip = (label: string, d: number, h: number) => {
    const activo = desde === diaISO(d) && hasta === diaISO(h);
    return (
      <button
        key={label}
        type="button"
        onClick={() => { setDesde(diaISO(d)); setHasta(diaISO(h)); }}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
          activo ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        {label}
      </button>
    );
  };

  if (isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon="calendar" label="Vencen en el rango" value={String(filas.length)} accent="primary" />
        <KpiCard icon="alarm-clock" label="Vencen hoy" value={String(venceHoy)} accent={venceHoy > 0 ? "warning" : "muted"} />
        <KpiCard icon="money-bag" label="A cobrar en el rango" value={formatMonto(totalRango)} accent="success" mono />
        <KpiCard
          icon="telephone" label="Sin forma de contacto" value={String(sinContacto)}
          accent={sinContacto > 0 ? "destructive" : "muted"}
          sub={sinContacto > 0 ? "no les llega la campaña" : "todos contactables"}
        />
      </div>

      {/* Rango + atajos. Los atajos son los recorridos reales: hoy, mañana, la semana. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Desde</span>
          <input type="date" value={desde} min={hoy} onChange={(e) => setDesde(e.target.value)}
            className="h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hasta</span>
          <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)}
            className="h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </label>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {chip("Hoy", 0, 0)}
          {chip("Mañana", 1, 1)}
          {chip("Esta semana", 0, 7)}
          {chip("Próximos 15 días", 0, 15)}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <BuscadorF3
          value={q} onChange={setQ} placeholder="Buscar por cliente o DNI…"
          onF3={() => setQ("")} onEscape={() => setQ("")} className="w-full sm:max-w-sm"
        />
        <button
          type="button"
          onClick={armarCampana}
          disabled={seleccionados.length === 0}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Emoji name="megaphone" className="h-4 w-4" />
          Avisar a {seleccionados.length || "…"}
          {seleccionados.length > 0 && (
            <span className="font-mono text-xs opacity-80">· {formatMonto(montoSeleccionado)}</span>
          )}
        </button>
      </div>

      <DataTable
        rows={filas}
        rowKey={(c) => c.id}
        pageSize={15}
        zebra
        empty={{
          icon: "calendar",
          title: "Sin vencimientos en ese rango",
          hint: "Probá ampliando las fechas o mirá los próximos 15 días.",
        }}
        columns={[
          {
            header: (
              <input
                type="checkbox"
                aria-label="Seleccionar todos"
                checked={filas.length > 0 && seleccionados.length === filas.length}
                onChange={(e) => setSel(e.target.checked ? new Set(filas.map((c) => c.id)) : new Set())}
                className="accent-primary"
              />
            ),
            className: "w-10",
            cell: (c) => (
              <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)}
                onClick={(e) => e.stopPropagation()} aria-label={`Seleccionar ${nombreCompleto(c.cliente)}`} className="accent-primary" />
            ),
          },
          {
            header: "Cliente",
            cell: (c) => (
              <div>
                <p className="font-medium text-foreground">{nombreCompleto(c.cliente)}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{formatCreditoNumero(c.numero, c.refinancia_a_numero)}</p>
              </div>
            ),
          },
          {
            header: "Contacto",
            cell: (c) => {
              const tel = c.cliente?.telefono, mail = c.cliente?.email;
              if (!tel && !mail) return <span className="text-xs text-destructive">sin contacto</span>;
              return <span className="font-mono text-xs text-muted-foreground">{tel ?? mail}</span>;
            },
          },
          {
            header: "Vence",
            cell: (c) => {
              const f = c.proximo_pago?.slice(0, 10) ?? "";
              const esHoy = f === hoy;
              return (
                <span className={`tabular-nums ${esHoy ? "font-semibold text-warning" : "text-foreground"}`}>
                  {formatFecha(c.proximo_pago)}{esHoy && " · hoy"}
                </span>
              );
            },
          },
          { header: "Cuota", mono: true, cell: (c) => <span className="font-semibold text-foreground">{formatMonto(c.cuota_proxima ?? 0)}</span> },
        ]}
      />
    </div>
  );
}
