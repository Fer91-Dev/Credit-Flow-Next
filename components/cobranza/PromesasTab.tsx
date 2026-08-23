"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { HandshakeIcon, Ban } from "lucide-react";
import { formatMonto, formatFecha, formatFechaHora, formatCreditoNumero, nombreCompleto } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Emoji } from "@/components/ui/Emoji";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel, FormActions, IconTextarea } from "@/components/caja/caja-form";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import type { Role } from "@/lib/auth/roles";

type Promesa = {
  id: string;
  created_at: string;
  credito_id: string;
  promesa_monto: number | null;
  promesa_fecha: string | null;
  promesa_estado: string | null;
  nota: string | null;
  automatico: boolean;
  /** Por donde se lo contacto: llamada | whatsapp | email | visita | otro. */
  tipo: string;
  proximo_contacto: string | null;
  credito: {
    id: string;
    numero: number | null;
    saldo_pendiente: number;
    dias_mora: number;
    cliente: { id: string; nombre: string; apellido?: string | null; documento: string | null };
  };
};

const TABS = [
  { key: "pendiente", label: "Pendientes", emoji: "alarm-clock" },
  { key: "cumplida",  label: "Cumplidas",  emoji: "check-mark-button" },
  { key: "incumplida", label: "Rotas",     emoji: "cross-mark" },
  { key: "anulada",   label: "Anuladas",   emoji: "prohibited" },
  { key: "",          label: "Todas",      emoji: "scroll" },
] as const;

type EstadoTab = "" | "pendiente" | "cumplida" | "incumplida" | "anulada";

const fetcher = (url: string) => fetch(url).then((r) => r.json()).then((r) => r.data);

function estadoBadge(estado: string | null) {
  if (estado === "cumplida")   return <StatusBadge label="Cumplida"  variant="success" />;
  if (estado === "incumplida") return <StatusBadge label="Rota"      variant="destructive" />;
  // Anulada NO es lo mismo que rota: la promesa se dejo sin efecto, el cliente no incumplio.
  if (estado === "anulada")    return <StatusBadge label="Anulada"   variant="muted" />;
  return                              <StatusBadge label="Pendiente" variant="warning" />;
}

function diasRestantes(fechaStr: string | null): string {
  if (!fechaStr) return "—";
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fecha = new Date(fechaStr); fecha.setHours(0,0,0,0);
  const diff = Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff < 0)   return `Venció hace ${Math.abs(diff)}d`;
  return `En ${diff}d`;
}

/**
 * Detalle de una promesa. La fila de la tabla no era clickeable, así que la NOTA —donde el
 * cobrador escribe qué dijo el cliente— no se veía en ninguna parte: quedaba escrita en la
 * base y nadie la leía nunca. Es el dato con el que se prepara la llamada siguiente.
 */
const TIPO_LABEL: Record<string, string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", email: "Email", visita: "Visita", otro: "Otro",
};

function PromesaDetalle({ promesa, historial, onClose }: {
  promesa: Promesa | null;
  /** Todas las promesas del MISMO crédito, para saber si el cliente suele cumplir. */
  historial: Promesa[];
  onClose: () => void;
}) {
  return (
    <Dialog open={!!promesa} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-lg sm:p-7">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/10 text-warning">
              <HandshakeIcon className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Promesa de pago</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {promesa ? nombreCompleto(promesa.credito.cliente) : ""}
              </p>
            </div>
          </div>
        </DialogHeader>

        {promesa && (() => {
          /**
           * Cómo se pactó, no solo cuánto.
           *
           * El diálogo mostraba seis renglones que ya estaban en la tabla. Lo que hace falta
           * para decidir si creerle es OTRA cosa: por dónde se lo contactó, cuánto plazo se
           * le dio, qué parte de la deuda cubre lo prometido, y —sobre todo— cómo cumplió
           * las promesas anteriores.
           */
          const plazoDias = promesa.promesa_fecha
            ? Math.round(
                (new Date(promesa.promesa_fecha).setHours(0, 0, 0, 0) -
                  new Date(promesa.created_at).setHours(0, 0, 0, 0)) / 86_400_000,
              )
            : null;
          const cubrePct =
            promesa.promesa_monto && promesa.credito.saldo_pendiente > 0
              ? Math.round((promesa.promesa_monto / promesa.credito.saldo_pendiente) * 100)
              : null;
          const previas = historial.filter((h) => h.id !== promesa.id);
          const cumplidas = previas.filter((h) => h.promesa_estado === "cumplida").length;
          const rotas = previas.filter((h) => h.promesa_estado === "incumplida").length;

          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {estadoBadge(promesa.promesa_estado)}
                <span className="inline-flex items-center rounded-full bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {TIPO_LABEL[promesa.tipo] ?? promesa.tipo}
                </span>
                {promesa.automatico && (
                  <span className="text-[11px] text-muted-foreground">la registró el sistema</span>
                )}
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {([
                      ["Crédito", formatCreditoNumero(promesa.credito.numero)],
                      ["Documento", promesa.credito.cliente.documento || "—"],
                      ["Días de mora", `${promesa.credito.dias_mora} d`],
                      ["Saldo del crédito", formatMonto(promesa.credito.saldo_pendiente)],
                      [
                        "Monto prometido",
                        promesa.promesa_monto
                          ? `${formatMonto(promesa.promesa_monto)}${cubrePct != null ? ` · ${cubrePct}% del saldo` : ""}`
                          : "—",
                      ],
                      ["Se pactó el", formatFechaHora(promesa.created_at)],
                      [
                        "Fecha límite",
                        `${formatFecha(promesa.promesa_fecha)} · ${diasRestantes(promesa.promesa_fecha)}`,
                      ],
                      ["Plazo otorgado", plazoDias != null ? `${plazoDias} día${plazoDias === 1 ? "" : "s"}` : "—"],
                      ["Próximo contacto", promesa.proximo_contacto ? formatFecha(promesa.proximo_contacto) : "sin agendar"],
                    ] as [string, string][]).map(([k, v], i) => (
                      <tr key={k} className={i % 2 === 1 ? "bg-muted/5" : ""}>
                        <td className="px-3 py-2 text-muted-foreground border-b border-border/40">{k}</td>
                        <td className="px-3 py-2 text-right font-medium text-foreground border-b border-border/40 tabular-nums">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Lo que dijo el cliente. */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nota de la gestión</p>
                <p className="mt-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm text-foreground whitespace-pre-wrap">
                  {promesa.nota?.trim() || <span className="text-muted-foreground/50">Sin nota.</span>}
                </p>
              </div>

              {/* Cómo cumplió antes: es el dato que decide si esta promesa vale algo. */}
              {previas.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Promesas anteriores de este crédito
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
                    <span className="text-muted-foreground">{previas.length} anterior{previas.length === 1 ? "" : "es"}</span>
                    {cumplidas > 0 && <span className="font-medium text-success">{cumplidas} cumplida{cumplidas === 1 ? "" : "s"}</span>}
                    {rotas > 0 && <span className="font-medium text-destructive">{rotas} rota{rotas === 1 ? "" : "s"}</span>}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {previas.slice(0, 4).map((h) => (
                      <div key={h.id} className="flex items-center justify-between gap-2 px-1 text-[11px]">
                        <span className="text-muted-foreground">
                          {formatFecha(h.promesa_fecha)} · {TIPO_LABEL[h.tipo] ?? h.tipo}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {h.promesa_monto ? formatMonto(h.promesa_monto) : "—"}
                          </span>
                          {estadoBadge(h.promesa_estado)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Anular una promesa: pide el motivo en un diálogo del SISTEMA.
 *
 * 🔴 Esto salió con un `window.prompt()` y el usuario lo cazó en el acto. Un alert nativo no
 * respeta el tema, no se puede estilar, bloquea la pestaña y —lo peor— muestra el dominio de
 * Vercel arriba: parece otra aplicación. El patrón ya existía en `AcuerdosTab.AnularDialog`,
 * a un archivo de distancia. Ir rápido no es motivo para inventar un camino aparte.
 */
function AnularPromesaDialog({ promesa, onClose }: { promesa: Promesa | null; onClose: (motivo?: string) => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!promesa) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivo.trim()) { setError("Indicá por qué se anula la promesa"); return; }
    const m = motivo.trim();
    setMotivo(""); setError(null);
    onClose(m);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(""); setError(null); onClose(); } }}>
      <DialogContent className="w-[95vw] sm:max-w-lg sm:p-7">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive">
              <Ban className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Anular promesa de pago</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{nombreCompleto(promesa.credito.cliente)}</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            La promesa de{" "}
            <span className="font-mono font-semibold text-foreground">
              {promesa.promesa_monto ? formatMonto(promesa.promesa_monto) : "—"}
            </span>{" "}
            para el {formatFecha(promesa.promesa_fecha)} queda <strong className="text-foreground">sin efecto</strong>.
            No cuenta como incumplida ni le baja la efectividad al cliente.
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Motivo</FieldLabel>
            <IconTextarea
              icon="receipt"
              value={motivo}
              onChange={(e) => { setMotivo(e.target.value); setError(null); }}
              placeholder="Ej.: el cliente se arrepintió, se cargó por error…"
              rows={3}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <FormActions
            onCancel={() => { setMotivo(""); setError(null); onClose(); }}
            disabled={!motivo.trim()}
            submitLabel="Anular promesa"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PromesasTab({ role }: { role: Role }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [estadoTab, setEstadoTab] = useState<EstadoTab>("pendiente");
  const [cambiando, setCambiando] = useState<string | null>(null);

  const swrKey = `/api/cobranza/promesas${estadoTab ? `?estado=${estadoTab}` : ""}`;
  const { data: promesas = [], isLoading } = useSWR<Promesa[]>(swrKey, fetcher);

  /**
   * KPIs de TODAS las promesas, no de la pestaña abierta.
   *
   * La pantalla no tenía ninguno: para saber cuántas estaban por vencer había que entrar a
   * cada pestaña y contar filas. Se pide la lista completa aparte, así los números no
   * cambian al cambiar de pestaña — un KPI que se mueve con el filtro no es un KPI.
   */
  const { data: todas = [] } = useSWR<Promesa[]>("/api/cobranza/promesas", fetcher);
  const hoyMs = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
  const kpis = (() => {
    const pend = todas.filter((p) => p.promesa_estado === "pendiente");
    const cumplidas = todas.filter((p) => p.promesa_estado === "cumplida").length;
    const rotas = todas.filter((p) => p.promesa_estado === "incumplida").length;
    return {
      pendientes: pend.length,
      // Las que hay que cobrar HOY o ya se pasaron: es la única cifra accionable del día.
      vencenHoy: pend.filter((p) => p.promesa_fecha && new Date(p.promesa_fecha).getTime() <= hoyMs).length,
      comprometido: pend.reduce((s, p) => s + (p.promesa_monto ?? 0), 0),
      cumplidas,
      rotas,
      // Cuántas de las que ya se resolvieron terminaron bien. Mide la palabra del cliente.
      efectividad: cumplidas + rotas > 0 ? Math.round((cumplidas / (cumplidas + rotas)) * 100) : null,
    };
  })();

  /** Promesa abierta en el detalle (la fila no era clickeable: no se podía ver la nota). */
  const [detalle, setDetalle] = useState<Promesa | null>(null);

  const puedeEditar = role === "admin" || role === "cobrador";

  const LABEL: Record<string, string> = { cumplida: "cumplida", incumplida: "rota", anulada: "anulada" };

  async function cambiarEstado(id: string, nuevoEstado: string, motivo?: string) {
    const label = LABEL[nuevoEstado] ?? nuevoEstado;
    const ok = await confirm({
      title: `¿Marcar promesa como ${label}?`,
      description:
        nuevoEstado === "anulada"
          ? "La promesa queda sin efecto: no se le va a reclamar ni cuenta como incumplida."
          : `La promesa de pago quedará marcada como ${label}.`,
      confirmLabel: `Marcar ${label}`,
      tone: nuevoEstado === "cumplida" ? "default" : "danger",
    });
    if (!ok) return;
    setCambiando(id);
    try {
      const res = await fetch(`/api/cobranza/promesas?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promesa_estado: nuevoEstado, ...(motivo ? { motivo } : {}) }),
      });
      if (!res.ok) { toast.error("No se pudo actualizar la promesa"); return; }
      mutate(swrKey);
      mutate("/api/cobranza/promesas"); // los KPIs salen de la lista completa
      toast.success(`Promesa marcada como ${label}`);
    } finally {
      setCambiando(null);
    }
  }

  /** Promesa que se está anulando (abre el diálogo que pide el motivo). */
  const [anulando, setAnulando] = useState<Promesa | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon="alarm-clock" label="Promesas pendientes" value={String(kpis.pendientes)}
          accent={kpis.pendientes > 0 ? "warning" : "muted"}
          sub={kpis.vencenHoy > 0 ? `${kpis.vencenHoy} para cobrar hoy` : "ninguna vencida"}
        />
        <KpiCard icon="money-bag" label="Comprometido" value={formatMonto(kpis.comprometido)} accent="primary" mono sub="lo que prometieron pagar" />
        <KpiCard icon="check-mark-button" label="Cumplidas" value={String(kpis.cumplidas)} accent="success" />
        <KpiCard
          icon="chart-increasing" label="Efectividad"
          value={kpis.efectividad != null ? `${kpis.efectividad}%` : "—"}
          accent={kpis.efectividad != null && kpis.efectividad >= 50 ? "success" : "destructive"}
          sub={`${kpis.rotas} rota${kpis.rotas === 1 ? "" : "s"}`}
        />
      </div>

      {/* Sub-tabs de estado */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit">
        {TABS.map((tab) => {
          const activo = estadoTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setEstadoTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activo
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Emoji name={tab.emoji} className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-muted/20 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : promesas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <HandshakeIcon className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Sin promesas en este estado</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Las promesas se registran desde la gestión de cobranza
          </p>
        </div>
      ) : (
        <DataTable<Promesa>
          rows={promesas}
          rowKey={(p) => p.id}
          pageSize={12}
          zebra
          // La fila abre el detalle: la NOTA de la gestion -que es donde el cobrador escribe
          // que dijo el cliente- no se veia en ningun lado.
          onRowClick={(p) => setDetalle(p)}
          columns={[
            {
              header: "Cliente",
              cell: (p) => (
                <div>
                  <p className="font-medium text-foreground">{nombreCompleto(p.credito.cliente)}</p>
                  <p className="text-xs text-muted-foreground">{p.credito.cliente.documento ?? "—"}</p>
                </div>
              ),
            },
            {
              header: "Crédito",
              cell: (p) => (
                <div>
                  <span className="font-mono text-xs text-primary">{formatCreditoNumero(p.credito.numero)}</span>
                  <p className="text-xs text-muted-foreground">{p.credito.dias_mora}d mora · Saldo {formatMonto(p.credito.saldo_pendiente)}</p>
                </div>
              ),
            },
            { header: "Monto prometido", align: "right", mono: true, cell: (p) => <span className="font-bold text-foreground">{p.promesa_monto ? formatMonto(p.promesa_monto) : "—"}</span> },
            {
              header: "Fecha límite",
              cell: (p) => (
                <div>
                  <p className="text-foreground">{formatFecha(p.promesa_fecha)}</p>
                  <p className="text-xs text-muted-foreground">{diasRestantes(p.promesa_fecha)}</p>
                </div>
              ),
            },
            {
              header: "Estado",
              cell: (p) => (
                <span>{estadoBadge(p.promesa_estado)}{p.automatico && <span className="ml-1 text-[10px] text-muted-foreground">(auto)</span>}</span>
              ),
            },
            ...(puedeEditar ? ([{
              header: "Acción",
              cell: (p) => p.promesa_estado === "pendiente" ? (
                /* 🔴 `stopPropagation`: la fila abre el detalle, y sin esto el clic en
                   cualquiera de estos botones burbujeaba hasta ella — se anulaba la promesa
                   Y encima se abría el diálogo del detalle encima. Mismo patrón que la
                   tabla de créditos. */
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => cambiarEstado(p.id, "cumplida")} disabled={cambiando === p.id} className="px-2 py-1 text-xs rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-40">Cumplida</button>
                  <button onClick={() => cambiarEstado(p.id, "incumplida")} disabled={cambiando === p.id} className="px-2 py-1 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40">Rota</button>
                  {/* Anular: la promesa se deja sin efecto. No es un incumplimiento del
                      cliente, asi que no le ensucia la efectividad. */}
                  <button onClick={() => setAnulando(p)} disabled={cambiando === p.id} className="px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40">Anular</button>
                </div>
              ) : null,
            }] as Column<Promesa>[]) : []),
          ]}
          renderMobileCard={(p) => (
            <div className="rounded-xl bg-card border border-border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm text-foreground">{nombreCompleto(p.credito.cliente)}</p>
                  <p className="text-xs text-muted-foreground font-mono">{formatCreditoNumero(p.credito.numero)}</p>
                </div>
                {estadoBadge(p.promesa_estado)}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Prometido: <span className="font-mono font-bold text-foreground">{p.promesa_monto ? formatMonto(p.promesa_monto) : "—"}</span></span>
                <span>{formatFecha(p.promesa_fecha)} · {diasRestantes(p.promesa_fecha)}</span>
              </div>
              {puedeEditar && p.promesa_estado === "pendiente" && (
                <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => cambiarEstado(p.id, "cumplida")} disabled={cambiando === p.id} className="flex-1 py-1.5 text-xs rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-40">Marcar cumplida</button>
                  <button onClick={() => cambiarEstado(p.id, "incumplida")} disabled={cambiando === p.id} className="flex-1 py-1.5 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40">Marcar rota</button>
                  <button onClick={() => setAnulando(p)} disabled={cambiando === p.id} className="flex-1 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40">Anular</button>
                </div>
              )}
            </div>
          )}
        />
      )}

      <PromesaDetalle
        promesa={detalle}
        historial={detalle ? todas.filter((p) => p.credito_id === detalle.credito_id) : []}
        onClose={() => setDetalle(null)}
      />

      <AnularPromesaDialog
        promesa={anulando}
        onClose={(motivo) => {
          const p = anulando;
          setAnulando(null);
          if (p && motivo) void cambiarEstado(p.id, "anulada", motivo);
        }}
      />
    </div>
  );
}
