"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { HandshakeIcon, CheckCircle2, XCircle, Clock, ExternalLink } from "lucide-react";
import { formatMonto, formatFecha, formatCreditoNumero, nombreCompleto } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Emoji } from "@/components/ui/Emoji";
import { DataTable, type Column } from "@/components/ui/DataTable";
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
  { key: "",          label: "Todas",      emoji: "scroll" },
] as const;

type EstadoTab = "" | "pendiente" | "cumplida" | "incumplida";

const fetcher = (url: string) => fetch(url).then((r) => r.json()).then((r) => r.data);

function estadoBadge(estado: string | null) {
  if (estado === "cumplida")   return <StatusBadge label="Cumplida"  variant="success" />;
  if (estado === "incumplida") return <StatusBadge label="Rota"      variant="destructive" />;
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

export function PromesasTab({ role }: { role: Role }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [estadoTab, setEstadoTab] = useState<EstadoTab>("pendiente");
  const [cambiando, setCambiando] = useState<string | null>(null);

  const swrKey = `/api/cobranza/promesas${estadoTab ? `?estado=${estadoTab}` : ""}`;
  const { data: promesas = [], isLoading } = useSWR<Promesa[]>(swrKey, fetcher);

  const puedeEditar = role === "admin" || role === "cobrador";

  async function cambiarEstado(id: string, nuevoEstado: string) {
    const label = nuevoEstado === "cumplida" ? "cumplida" : "rota";
    const ok = await confirm({
      title: nuevoEstado === "cumplida" ? "¿Marcar promesa como cumplida?" : "¿Marcar promesa como rota?",
      description: `La promesa de pago quedará marcada como ${label}.`,
      confirmLabel: nuevoEstado === "cumplida" ? "Marcar cumplida" : "Marcar rota",
      tone: nuevoEstado === "incumplida" ? "danger" : "default",
    });
    if (!ok) return;
    setCambiando(id);
    try {
      const res = await fetch(`/api/cobranza/promesas?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promesa_estado: nuevoEstado }),
      });
      if (!res.ok) { toast.error("No se pudo actualizar la promesa"); return; }
      mutate(swrKey);
      toast.success(nuevoEstado === "cumplida" ? "Promesa marcada como cumplida" : "Promesa marcada como rota");
    } finally {
      setCambiando(null);
    }
  }

  return (
    <div className="space-y-4">
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
                <div className="flex gap-1">
                  <button onClick={() => cambiarEstado(p.id, "cumplida")} disabled={cambiando === p.id} className="px-2 py-1 text-xs rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-40">Cumplida</button>
                  <button onClick={() => cambiarEstado(p.id, "incumplida")} disabled={cambiando === p.id} className="px-2 py-1 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40">Rota</button>
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
                <div className="flex gap-2 pt-1">
                  <button onClick={() => cambiarEstado(p.id, "cumplida")} disabled={cambiando === p.id} className="flex-1 py-1.5 text-xs rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-40">Marcar cumplida</button>
                  <button onClick={() => cambiarEstado(p.id, "incumplida")} disabled={cambiando === p.id} className="flex-1 py-1.5 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40">Marcar rota</button>
                </div>
              )}
            </div>
          )}
        />
      )}
    </div>
  );
}
