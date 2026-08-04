"use client";

import { useState } from "react";
import { Scale, ShieldCheck } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { formatFechaHora } from "@/lib/utils";
import { CUENTA_META } from "@/components/caja/CuentaCard";
import type { ArqueoCaja, CuentaCaja } from "@/lib/swr";

/**
 * Historial de cierres de caja (arqueos), compartido por la caja del administrador y la
 * del vendedor. Una sola definición para que no vuelvan a divergir, igual que `CuentaCard`.
 *
 * `onConciliar` solo lo pasa el admin: es la acción que el dueño de la caja no puede
 * ejecutar sobre la suya.
 */

const ESTADO_META: Record<ArqueoCaja["estado"], { label: string; variant: BadgeVariant }> = {
  cuadrado:   { label: "Cuadrado",  variant: "success" },
  pendiente:  { label: "Pendiente", variant: "warning" },
  conciliado: { label: "Conciliado", variant: "primary" },
};

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

const simbolo = (cuenta: string) => CUENTA_META[cuenta as CuentaCaja]?.prefix ?? "$";
const etiquetaCuenta = (cuenta: string) => CUENTA_META[cuenta as CuentaCaja]?.label ?? cuenta;

/** Sobrante en verde, faltante en rojo. El faltante es el que hay que poder ver de lejos. */
function Diferencia({ valor, cuenta }: { valor: number; cuenta: string }) {
  if (valor === 0) return <span className="text-muted-foreground">Cuadra</span>;
  const sobrante = valor > 0;
  return (
    <span className={`font-semibold ${sobrante ? "text-success" : "text-destructive"}`}>
      {sobrante ? "+" : "−"}{simbolo(cuenta)} {n2(Math.abs(valor))}
    </span>
  );
}

export function ArqueosPanel({
  arqueos,
  mostrarCaja = false,
  onConciliar,
  titulo = "Cierres de caja",
  subtitulo,
}: {
  arqueos: ArqueoCaja[];
  /** El admin ve arqueos de varias cajas y necesita la columna; el vendedor no. */
  mostrarCaja?: boolean;
  /** Solo admin. Sin esto, el panel es de lectura. */
  onConciliar?: (a: ArqueoCaja) => void;
  titulo?: string;
  subtitulo?: string;
}) {
  const [detalle, setDetalle] = useState<ArqueoCaja | null>(null);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          <Scale className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
          {subtitulo && <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>}
        </div>
      </div>

      <DataTable<ArqueoCaja>
        rows={arqueos}
        rowKey={(a) => a.id}
        onRowClick={(a) => setDetalle(detalle?.id === a.id ? null : a)}
        empty={{ icon: "balance-scale", title: "Todavía no se cerró ninguna caja" }}
        zebra
        pageSize={8}
        columns={[
          {
            header: "Fecha",
            cell: (a) => (
              <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatFechaHora(a.created_at)}</span>
            ),
          },
          ...(mostrarCaja
            ? [{ header: "Caja", cell: (a: ArqueoCaja) => <span className="text-foreground">{a.caja}</span> }]
            : []),
          { header: "Cuenta", cell: (a) => <span className="text-muted-foreground">{etiquetaCuenta(a.cuenta)}</span> },
          {
            header: "Sistema", align: "right", mono: true,
            cell: (a) => <span className="text-muted-foreground">{simbolo(a.cuenta)} {n2(a.sistema)}</span>,
          },
          {
            header: "Contado", align: "right", mono: true,
            cell: (a) => <span className="text-foreground">{simbolo(a.cuenta)} {n2(a.fisico)}</span>,
          },
          {
            header: "Diferencia", align: "right", mono: true,
            cell: (a) => <Diferencia valor={a.diferencia} cuenta={a.cuenta} />,
          },
          {
            header: "Estado",
            cell: (a) => <StatusBadge label={ESTADO_META[a.estado].label} variant={ESTADO_META[a.estado].variant} />,
          },
          {
            header: "Contó", className: "hidden lg:table-cell",
            cell: (a) => <span className="text-muted-foreground">{a.creado_por ?? "—"}</span>,
          },
          ...(onConciliar
            ? [{
                header: "", align: "right" as const,
                cell: (a: ArqueoCaja) =>
                  a.estado === "pendiente" ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onConciliar(a); }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Conciliar
                    </button>
                  ) : null,
              }]
            : []),
        ]}
      />

      {detalle && (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Detalle del cierre · {etiquetaCuenta(detalle.cuenta)}
          </p>
          {detalle.observacion && (
            <p className="text-muted-foreground">
              <span className="text-foreground">Observación de quien contó:</span> {detalle.observacion}
            </p>
          )}
          {detalle.estado === "pendiente" && (
            <p className="text-warning">
              La diferencia todavía no se ajustó. El saldo de sistema de esa cuenta sigue como estaba.
            </p>
          )}
          {detalle.estado === "conciliado" && (
            <p className="text-muted-foreground">
              <span className="text-foreground">Conciliado por {detalle.resuelto_por ?? "—"}</span>
              {detalle.resuelto_at ? ` el ${formatFechaHora(detalle.resuelto_at)}` : ""}
              {detalle.resolucion_nota ? ` · ${detalle.resolucion_nota}` : ""}
            </p>
          )}
          {!detalle.observacion && detalle.estado === "cuadrado" && (
            <p className="text-muted-foreground">El conteo coincidió con el sistema. Sin observaciones.</p>
          )}
        </div>
      )}
    </div>
  );
}
