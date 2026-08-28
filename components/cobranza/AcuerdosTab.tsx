"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Handshake, Ban, DollarSign, Printer } from "lucide-react";
import { formatMonto, formatFecha, formatCreditoNumero, cuandoVence } from "@/lib/utils";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel, FormActions, IconTextarea } from "@/components/caja/caja-form";
import { PagoForm } from "@/components/pagos/PagoForm";
import type { Role } from "@/lib/auth/roles";
import { useFinanciera } from "@/lib/swr";
import { imprimirAcuerdo } from "@/lib/acuerdo-print";
import { MODAL_CONTENT, SIN_CIERRE_ACCIDENTAL } from "@/components/ui/form-kit";

/**
 * Acuerdos de pago: el arreglo informal en cuotas con un moroso.
 *
 * El estado NO se edita a mano — se deriva de lo cobrado. Por eso la única acción es
 * ANULAR (para un error de carga o una renegociación); no hay "marcar como cumplido",
 * que sería un botón para decir que cobraste sin haber cobrado.
 */

export interface AcuerdoCuota {
  numero: number;
  vencimiento: string;
  monto: number;
  pagado: number;
  estado: string;
}

export interface Acuerdo {
  id: string;
  fecha: string;
  credito_id: string;
  credito_numero: number | null;
  /** Número del crédito que refinancia, si el acuerdo es sobre una refinanciación. */
  credito_refinancia_a_numero?: number | null;
  cliente: string | null;
  estado: "vigente" | "cumplido" | "roto" | "anulado";
  deuda_original: number;
  quita: number;
  monto_acordado: number;
  cobrado: number;
  pendiente: number;
  proximo_vencimiento: string | null;
  congela_punitorios: boolean;
  notas: string | null;
  motivo_estado: string | null;
  creado_por: string | null;
  /** Datos que necesita el documento imprimible (firma del cliente). */
  documento?: string | null;
  tasa_mensual?: number | null;
  cuotas_para_romper?: number;
  cuotas: AcuerdoCuota[];
}

const ESTADO_META: Record<Acuerdo["estado"], { label: string; variant: BadgeVariant }> = {
  vigente:  { label: "Vigente",  variant: "primary" },
  cumplido: { label: "Cumplido", variant: "success" },
  roto:     { label: "Roto",     variant: "destructive" },
  anulado:  { label: "Anulado",  variant: "muted" },
};

const TABS = [
  { key: "vigente", label: "Vigentes" },
  { key: "cumplido", label: "Cumplidos" },
  { key: "roto", label: "Rotos" },
  // Los anulados solo aparecían mezclados en "Todos". Un acuerdo que alguien anuló es
  // justamente el que se va a querer revisar después —con su motivo— y no había forma de
  // llegar a él sin recorrer la lista entera.
  { key: "anulado", label: "Anulados" },
  { key: "", label: "Todos" },
] as const;

const fetcher = (url: string) => fetch(url).then((r) => r.json()).then((r) => r.data);

/** Ver `cuandoVence` en lib/utils: tenía el mismo corrimiento de un día que Promesas. */
const cuando = (fecha: string | null): string => cuandoVence(fecha);

/** Próxima cuota del acuerdo que falta cobrar (la más vieja sin pagar). */
function proximaCuota(a: Acuerdo): AcuerdoCuota | null {
  return [...a.cuotas].sort((x, y) => x.numero - y.numero).find((c) => c.estado !== "pagada") ?? null;
}

export function AcuerdosTab({ role }: { role: Role }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { financiera } = useFinanciera(); // co-branding del documento que firma el cliente
  /** Arma el documento imprimible del acuerdo. El interés se DERIVA (no se guarda). */
  const imprimir = (a: Acuerdo) => {
    const base = Math.round((a.deuda_original - a.quita) * 100) / 100;
    imprimirAcuerdo({
      numeroCredito: formatCreditoNumero(a.credito_numero ?? undefined, a.credito_refinancia_a_numero),
      cliente: a.cliente ?? "—",
      documento: a.documento ?? null,
      fecha: a.fecha,
      deudaOriginal: a.deuda_original,
      quita: a.quita,
      interes: Math.round((a.monto_acordado - base) * 100) / 100,
      total: a.monto_acordado,
      tasaMensual: a.tasa_mensual ?? null,
      congelaPunitorios: a.congela_punitorios,
      cuotasParaRomper: a.cuotas_para_romper ?? 1,
      cuotas: a.cuotas.map((c) => ({ numero: c.numero, vencimiento: c.vencimiento, monto: c.monto })),
      notas: a.notas,
      // Un acuerdo anulado o caído no puede salir impreso como si estuviera en pie: el papel
      // se guarda en una carpeta y, seis meses después, nadie recuerda que ya no rige.
      estado: a.estado,
      motivoEstado: a.motivo_estado,
      financiera: financiera ? { nombre: financiera.nombre, logo_url: financiera.logo_url } : undefined,
    });
  };
  const [estado, setEstado] = useState<string>("vigente");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<Acuerdo | null>(null);
  /** Acuerdo cuya próxima cuota se está cobrando. */
  const [cobrando, setCobrando] = useState<Acuerdo | null>(null);

  const key = `/api/cobranza/acuerdos${estado ? `?estado=${estado}` : ""}`;
  const { data, isLoading } = useSWR<{ acuerdos: Acuerdo[]; vigentes: number; total: number }>(key, fetcher);
  const acuerdos = data?.acuerdos ?? [];

  const totalAcordado = acuerdos.reduce((s, a) => s + a.monto_acordado, 0);
  const totalCobrado = acuerdos.reduce((s, a) => s + a.cobrado, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/*
          Solo "vigentes" filtra: mueve el mismo selector de estado de abajo. "En esta vista"
          ya es el conteo de lo que se está mostrando —filtrarlo no cambiaría nada— y los dos
          importes son sumas, no subconjuntos.
        */}
        <KpiCard
          icon="handshake" label="Acuerdos vigentes" value={String(data?.vigentes ?? 0)} accent="primary" sub="en cumplimiento"
          onClick={(data?.vigentes ?? 0) > 0 ? () => setEstado("vigente") : undefined}
          active={estado === "vigente"}
        />
        <KpiCard
          icon="scroll" label="En esta vista" value={String(acuerdos.length)} accent="muted"
          // Los dos importes de al lado suman ESTAS filas. Si el servidor recortó, decirlo.
          sub={data && data.total > acuerdos.length ? `de ${data.total} · los importes suman estas` : undefined}
        />
        <KpiCard icon="money-bag" label="Acordado" value={formatMonto(totalAcordado)} accent="warning" mono />
        <KpiCard icon="inbox-tray" label="Recuperado" value={formatMonto(totalCobrado)} accent="success" mono sub="cobrado desde el acuerdo" />
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setEstado(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              estado === t.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DataTable<Acuerdo>
        rows={acuerdos}
        rowKey={(a) => a.id}
        loading={isLoading}
        onRowClick={(a) => setAbierto(abierto === a.id ? null : a.id)}
        empty={{ icon: "handshake", title: "No hay acuerdos de pago", hint: "Se arman desde la ficha de un moroso." }}
        zebra
        pageSize={10}
        columns={[
          { header: "Crédito", cell: (a) => <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{formatCreditoNumero(a.credito_numero ?? undefined, a.credito_refinancia_a_numero)}</span> },
          { header: "Cliente", cell: (a) => <span className="text-foreground">{a.cliente ?? "—"}</span> },
          { header: "Acordado", cell: (a) => <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatFecha(a.fecha)}</span> },
          { header: "Monto", align: "right", mono: true, cell: (a) => <span className="text-foreground">{formatMonto(a.monto_acordado)}</span> },
          {
            header: "Avance", align: "right", mono: true,
            cell: (a) => (
              <span className={a.pendiente <= 0 ? "text-success" : "text-muted-foreground"}>
                {formatMonto(a.cobrado)} <span className="text-muted-foreground/50">/</span> {a.cuotas.length} cta.
              </span>
            ),
          },
          {
            header: "Próximo", className: "hidden lg:table-cell",
            cell: (a) => <span className="text-muted-foreground">{a.estado === "vigente" ? cuando(a.proximo_vencimiento) : "—"}</span>,
          },
          { header: "Estado", cell: (a) => <StatusBadge label={ESTADO_META[a.estado].label} variant={ESTADO_META[a.estado].variant} /> },
          {
            header: "Acciones", align: "right",
            cell: (a) =>
              a.estado === "vigente" ? (
                <div className="flex items-center justify-end gap-1.5">
                  {/* Sin esto había que anotar el monto, ir a Pagos, buscar al cliente y
                      tipearlo — con la persona esperando en el mostrador. */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setCobrando(a); }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap"
                  >
                    <DollarSign className="h-3.5 w-3.5" /> Cobrar
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setAnulando(a); }}
                    title="Anular el acuerdo"
                    className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null,
          },
        ]}
      />

      {/* Detalle del acuerdo abierto: sus cuotas y cómo viene el cumplimiento. */}
      {abierto && (() => {
        const a = acuerdos.find((x) => x.id === abierto);
        if (!a) return null;
        return (
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <Handshake className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">
                  {a.cliente} · {formatCreditoNumero(a.credito_numero ?? undefined, a.credito_refinancia_a_numero)}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Debía {formatMonto(a.deuda_original)} vencidos
                  {a.quita > 0 && <> · se le condonó {formatMonto(a.quita)}</>}
                  {" · "}acordó {formatMonto(a.monto_acordado)} en {a.cuotas.length} cuota(s)
                  {a.congela_punitorios && <> · sin punitorios mientras cumpla</>}
                </p>
              </div>
            </div>

            {/*
              Las cuotas del acuerdo, con estado a la vista.

              Eran tres cajas iguales con número, importe y fecha: no se veía cuál toca
              cobrar, cuánto falta de una parcial, ni si la fecha ya pasó. Ahora cada una
              lleva su franja de color, el avance cuando se pagó una parte, y la que sigue
              queda marcada — que es la única pregunta que se hace quien atiende.
            */}
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {a.cuotas.map((c) => {
                const resta = Math.round((c.monto - c.pagado) * 100) / 100;
                const pct = c.monto > 0 ? Math.min(100, (c.pagado / c.monto) * 100) : 0;
                const esProxima = a.estado === "vigente" && proximaCuota(a)?.numero === c.numero;
                const tono =
                  c.estado === "pagada" ? { borde: "border-success/30 bg-success/[0.06]", barra: "bg-success", txt: "text-success" }
                  : c.estado === "vencida" ? { borde: "border-destructive/30 bg-destructive/[0.06]", barra: "bg-destructive", txt: "text-destructive" }
                  : { borde: "border-border bg-muted/20", barra: "bg-primary", txt: "text-muted-foreground" };
                return (
                  <div
                    key={c.numero}
                    className={`relative overflow-hidden rounded-xl border p-3.5 ${tono.borde} ${esProxima ? "ring-1 ring-inset ring-primary/40" : ""}`}
                  >
                    <span className={`absolute inset-y-0 left-0 w-1 ${tono.barra}`} aria-hidden />
                    <div className="flex items-start justify-between gap-2 pl-1.5">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          Cuota {c.numero} de {a.cuotas.length} del acuerdo
                        </p>
                        <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">{formatMonto(c.monto)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${tono.txt}`}>{c.estado}</span>
                        {esProxima && <p className="mt-0.5 text-[10px] font-semibold text-primary">la que sigue</p>}
                      </div>
                    </div>
                    <p className="mt-1.5 pl-1.5 text-[11px] text-muted-foreground">
                      Vence {formatFecha(c.vencimiento)}
                      {c.estado !== "pagada" && <span className="text-muted-foreground/60"> · {cuando(c.vencimiento)}</span>}
                    </p>
                    {/* Avance solo si se pagó ALGO y falta: en una pagada la barra llena es
                        ruido, y en una intacta una barra vacía no dice nada. */}
                    {c.pagado > 0 && resta > 0 && (
                      <div className="mt-2.5 pl-1.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
                          <div className={`h-full rounded-full ${tono.barra}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                          pagó {formatMonto(c.pagado)} · resta <span className="font-bold text-foreground">{formatMonto(resta)}</span>
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
              <div className="space-y-1">
                {a.creado_por && <p>Lo armó <span className="text-foreground">{a.creado_por}</span></p>}
                {a.notas && <p>Nota: <span className="text-foreground">{a.notas}</span></p>}
                {a.motivo_estado && <p>{a.motivo_estado}</p>}
              </div>
              {/* El papel que firma el cliente. Sin esto, las condiciones del acuerdo —el
                  freno de punitorios y su vuelta retroactiva si se cae— no están escritas
                  en ningún lado y no hay reconocimiento de deuda firmado. */}
              <button
                onClick={(e) => { e.stopPropagation(); imprimir(a); }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Printer className="h-3.5 w-3.5" /> Imprimir para firmar
              </button>
            </div>
          </div>
        );
      })()}

      <AnularDialog
        acuerdo={anulando}
        onClose={(ok) => { setAnulando(null); if (ok) mutate(key); }}
      />

      {/* Cobro de una cuota del acuerdo: es un pago NORMAL del crédito, con el importe
          acordado precargado. No hay un circuito de cobro aparte — el acuerdo se concilia
          solo con los pagos que entran por la vía de siempre. */}
      {cobrando && (() => {
        const c = proximaCuota(cobrando);
        const pendiente = c ? Math.round((c.monto - c.pagado) * 100) / 100 : 0;
        return (
          <Dialog open onOpenChange={(o) => { if (!o) setCobrando(null); }}>
            <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden">
              <DialogHeader className="shrink-0">
                <DialogTitle>Cobrar cuota del acuerdo</DialogTitle>
              </DialogHeader>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <PagoForm
                  creditoId={cobrando.credito_id}
                  /* Lo DECLARA: es lo que fija el modo de monto libre y lo que hace que el
                     pago quede vinculado a la cuota del acuerdo. Antes se deducía del texto
                     del motivo, que también manda el botón verde de una cuota común. */
                  esAcuerdo
                  montoSugerido={pendiente > 0 ? pendiente : undefined}
                  motivoSugerido={
                    // Una línea. El párrafo que explicaba "las cuotas de abajo son las del
                    // crédito, no lo que se cobra" lo reemplaza el propio plan del acuerdo,
                    // que la terminal ahora dibuja arriba con la cuota marcada.
                    c
                      ? `Cuota ${c.numero} de ${cobrando.cuotas.length} del acuerdo · vence ${formatFecha(c.vencimiento)}`
                      : undefined
                  }
                  onClose={(ok) => { setCobrando(null); if (ok) mutate(key); }}
                />
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}

function AnularDialog({ acuerdo, onClose }: { acuerdo: Acuerdo | null; onClose: (ok?: boolean) => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!acuerdo) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivo.trim()) { setError("Indicá por qué se anula"); return; }
    const ok = await confirm({
      title: "¿Anular el acuerdo?",
      description: `El crédito de ${acuerdo.cliente ?? "el cliente"} vuelve a la cola de morosos y se le devengan los punitorios normalmente. Los pagos ya hechos NO se tocan.`,
      confirmLabel: "Anular acuerdo",
      tone: "danger",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/cobranza/acuerdos?id=${acuerdo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      const json = await res.json();
      if (json.ok) { setMotivo(""); toast.success("Acuerdo anulado"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo anular el acuerdo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(""); setError(null); onClose(false); } }}>
      {/*
        🔴 `MODAL_CONTENT` y no un className suelto: le pone el TOPE DE ALTURA.
      
        Sin `max-h`, un formulario más alto que la ventana desborda, y `FormActions` —que es
        `sticky bottom-0`— se pega al borde de la VENTANA en vez de al del modal. Se ve como
        los botones flotando en el medio, con campos abajo que parecen quedar fuera del
        formulario. Lo reportó el usuario en "Registrar gestión de cobranza".
      
        `SIN_CIERRE_ACCIDENTAL` va junto: acá adentro se tipean importes, motivos y notas, y
        clickear al costado los perdía sin preguntar nada.
      */}
      <DialogContent className={MODAL_CONTENT} {...SIN_CIERRE_ACCIDENTAL}>
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive">
              <Ban className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Anular acuerdo</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{acuerdo.cliente} · {formatMonto(acuerdo.monto_acordado)}</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Motivo</FieldLabel>
            <IconTextarea icon="receipt" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Ej: se cargó mal, se renegoció de otra forma…" required />
          </div>
          <FormActions
            onCancel={() => { setMotivo(""); onClose(false); }}
            loading={loading}
            disabled={!motivo.trim()}
            submitLabel="Anular acuerdo"
            loadingLabel="Anulando…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
