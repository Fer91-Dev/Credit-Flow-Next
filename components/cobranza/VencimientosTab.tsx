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
import { esCreditoVivo, contactoBloqueado, proximoVencimiento } from "@/lib/domain";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatMonto, formatFecha, nombreCompleto, formatCreditoNumero, hoyComercial, pctDe } from "@/lib/utils";
import { CreditoLink } from "@/components/ui/CreditoLink";

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
 * El corte va por el PRÓXIMO VENCIMIENTO REAL, que sale de `proximoVencimiento()`: casi
 * siempre es `proximo_pago` —la cuota impaga más vieja del plan—, pero con un acuerdo de pago
 * vigente y al día es la cuota PACTADA.
 *
 * 🔴 Antes miraba `proximo_pago` a secas y por eso CRD-000007 no aparecía nunca: su plan
 * original quedó con fecha 09/07, así que un rango futuro no lo alcanzaba, y su cuota real
 * —la 1 del acuerdo, del 07/10— no estaba en ninguna lista. Fernando lo encontró filtrando
 * justo hasta esa fecha (23/09/2026).
 */
export function VencimientosTab() {
  const router = useRouter();
  const { creditos, isLoading } = useCreditos();

  const [desde, setDesde] = useState(diaISO(0));
  const [hasta, setHasta] = useState(diaISO(7));
  const [q, setQ] = useState("");
  /**
   * 🔴 QUIÉNES QUEDAN AFUERA, no quiénes están adentro.
   *
   * Era al revés —un `Set` de seleccionados que arrancaba vacío— y de ahí salía el defecto:
   * el botón nacía apagado diciendo "Avisar a …", así que el operador filtraba un rango,
   * veía su lista y quedaba trabado hasta descubrir de casualidad que los casilleros servían
   * para destrabar el botón. Tildar el «todos» era un peaje, no una decisión.
   *
   * Dado vuelta, el estado natural —vacío— significa "van todos los que estoy viendo", que
   * es lo que el operador iba a hacer igual: filtrar "esta semana" y avisarles. Los casilleros
   * pasan a leerse por lo que hacen —destildar es sacar a alguien— y no hay ningún paso
   * previo que adivinar ni que explicar con un texto.
   */
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());

  const hoy = diaISO(0);

  /** Lo próximo a pagar de cada crédito: del plan, o del acuerdo si lo está cumpliendo. */
  const vencimientoDe = (c: Credito) =>
    proximoVencimiento({ proximoPago: c.proximo_pago, cuotaProxima: c.cuota_proxima ?? 0, acuerdo: c.acuerdo });

  const filas = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return creditos
      .map((c) => ({ c, v: vencimientoDe(c) }))
      .filter(({ c, v }) => {
        if (!esCreditoVivo(c.estado) || !v.fecha) return false;
        // 🔴 Solo lo que NO venció todavía. Un crédito con la cuota vencida ya es un moroso y
        // tiene su propia pestaña, con su propio mensaje: mandarle un "te vence el jueves" a
        // alguien que debe hace dos meses es tratarlo de al día.
        if (v.fecha < hoy) return false;
        if (v.fecha < desde || v.fecha > hasta) return false;
        if (!texto) return true;
        const nom = nombreCompleto(c.cliente).toLowerCase();
        return nom.includes(texto) || (c.cliente?.documento ?? "").includes(texto);
      })
      .sort((a, b) => (a.v.fecha ?? "").localeCompare(b.v.fecha ?? ""))
      .map(({ c }) => c);
    // `vencimientoDe` es puro y solo depende de `creditos`: no hace falta en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditos, desde, hasta, q, hoy]);

  /**
   * A quien no se puede contactar —fallecido, o pidió que no lo contacten— no entra ni
   * tildándolo: contarlo prometería un alcance que el envío después no cumple.
   */
  const contactables = filas.filter((c) => !contactoBloqueado(c.cliente).bloqueado);
  /** Los que van a recibir el aviso: los que se están viendo, menos los que se sacaron. */
  const destinatarios = contactables.filter((c) => !excluidos.has(c.id));
  const montoSeleccionado = destinatarios.reduce((s, c) => s + vencimientoDe(c).monto, 0);
  const totalRango = filas.reduce((s, c) => s + vencimientoDe(c).monto, 0);
  const venceHoy = filas.filter((c) => vencimientoDe(c).fecha === hoy).length;
  const sinContacto = filas.filter((c) => !c.cliente?.telefono && !c.cliente?.email).length;

  const incluido = (id: string) => !excluidos.has(id);

  const toggle = (id: string) =>
    setExcluidos((e) => { const n = new Set(e); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const armarCampana = () => {
    if (destinatarios.length === 0) return;
    guardarSeleccionCampana(destinatarios.map((c) => c.id));
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
        <KpiCard
          icon="alarm-clock" label="Vencen hoy" value={String(venceHoy)} accent={venceHoy > 0 ? "warning" : "muted"}
          sub={venceHoy > 0 ? `de ${filas.length} del rango` : "ninguna hoy"}
          barra={venceHoy > 0 ? { pct: pctDe(venceHoy, filas.length), label: `${Math.round(pctDe(venceHoy, filas.length))}%` } : undefined}
        />
        <KpiCard icon="money-bag" label="A cobrar en el rango" value={formatMonto(totalRango)} accent="success" mono />
        <KpiCard
          icon="telephone" label="Sin forma de contacto" value={String(sinContacto)}
          accent={sinContacto > 0 ? "destructive" : "muted"}
          sub={sinContacto > 0 ? "no les llega la campaña" : "todos contactables"}
          barra={sinContacto > 0 ? { pct: pctDe(sinContacto, filas.length), label: `${Math.round(pctDe(sinContacto, filas.length))}%` } : undefined}
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
          disabled={destinatarios.length === 0}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Emoji name="megaphone" className="h-4 w-4" />
          {/* El número ES la explicación: dice sobre cuántos va a trabajar antes de apretarlo,
              y cambia solo al tildar o al mover el rango. No hace falta ningún texto que
              cuente cómo se usa la pantalla. */}
          Avisar a {destinatarios.length}
          {destinatarios.length > 0 && (
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
                aria-label={destinatarios.length === contactables.length ? "Sacar a todos" : "Incluir a todos"}
                // Arranca marcado porque el estado inicial es "van todos". Destildarlo los
                // saca a todos, que es el único modo de dejar el botón sin nadie.
                checked={contactables.length > 0 && excluidos.size === 0}
                onChange={(e) => setExcluidos(e.target.checked ? new Set() : new Set(contactables.map((c) => c.id)))}
                className="accent-primary"
              />
            ),
            className: "w-10",
            cell: (c) => (
              <input
                type="checkbox"
                checked={incluido(c.id)}
                // A quien no se puede contactar no se lo puede elegir: entraría en el conteo
                // y el envío después lo saltea, prometiendo un alcance que no se cumple.
                disabled={contactoBloqueado(c.cliente).bloqueado}
                onChange={() => toggle(c.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Incluir a ${nombreCompleto(c.cliente)}`}
                className="accent-primary disabled:opacity-30"
              />
            ),
          },
          {
            header: "Cliente",
            cell: (c) => (
              <div>
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  {nombreCompleto(c.cliente)}
                  {/* Sin esto, la fila muestra una fecha y un importe que no están en el plan
                      de cuotas del crédito y no hay forma de saber de dónde salieron. */}
                  {vencimientoDe(c).porAcuerdo && <StatusBadge label="Acuerdo de pago" variant="primary" />}
                </p>
                <p className="flex items-center gap-1.5">
                  <CreditoLink id={c.id} numero={c.numero} numeroOrigen={c.refinancia_a_numero} className="text-[11px]" />
                  {vencimientoDe(c).porAcuerdo && (
                    <span className="text-[11px] text-muted-foreground">
                      cuota {vencimientoDe(c).cuotaNro} de {c.acuerdo?.total_cuotas} del acuerdo
                    </span>
                  )}
                </p>
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
              const v = vencimientoDe(c);
              const esHoy = v.fecha === hoy;
              return (
                <span className={`tabular-nums ${esHoy ? "font-semibold text-warning" : "text-foreground"}`}>
                  {formatFecha(v.fecha)}{esHoy && " · hoy"}
                </span>
              );
            },
          },
          {
            header: "Cuota",
            mono: true,
            cell: (c) => {
              const v = vencimientoDe(c);
              return (
                <span className="font-semibold text-foreground">{formatMonto(v.monto)}</span>
              );
            },
          },
        ]}
      />
    </div>
  );
}
