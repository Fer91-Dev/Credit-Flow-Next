"use client";

import { History, Database, Activity } from "lucide-react";
import type { EventoAuditoria } from "@/lib/swr";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { formatFechaHora } from "@/lib/utils";
import { DetailSection, DetailGrid } from "@/components/ui/DetailGrid";

const fmtDateTime = (s: string) => formatFechaHora(s);

const ENTIDAD_LABEL: Record<string, string> = {
  clientes: "Cliente", creditos: "Crédito", pagos: "Pago", configuracion: "Configuración", caja: "Caja",
};

function accionConfig(a: string): { label: string; variant: BadgeVariant } {
  switch (a) {
    case "crear":             return { label: "Creado",      variant: "success" };
    case "actualizar":        return { label: "Actualizado", variant: "primary" };
    case "eliminar":          return { label: "Eliminado",   variant: "destructive" };
    case "cancelar":          return { label: "Cancelado",   variant: "muted" };
    case "anular":            return { label: "Anulado",     variant: "warning" };
    case "registrar_pago":    return { label: "Pago",        variant: "success" };
    case "actualizar_config": return { label: "Config",      variant: "warning" };
    default:                  return { label: a,             variant: "muted" };
  }
}

/** Formatea un valor de `meta` para mostrarlo legible. */
function fmtMetaValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return new Intl.NumberFormat("es-AR").format(v);
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const META_LABEL: Record<string, string> = {
  numero: "N° de crédito", monto: "Monto", tasa: "Tasa", plazo_meses: "Cuotas",
  frecuencia: "Frecuencia", tipo: "Tipo", metodo: "Método", motivo: "Motivo",
  aplicado_mora: "Aplicado a mora", aplicado_interes: "Aplicado a interés",
  aplicado_cargos: "Aplicado a cargos", aplicado_capital: "Aplicado a capital",
  excedente: "Excedente", saldo_anterior: "Saldo anterior", nuevo_saldo: "Nuevo saldo",
  total_cobrado: "Total cobrado", accion_pagos: "Acción sobre pagos",
  estado_anterior: "Estado anterior", cuotas_afectadas: "Cuotas afectadas", saldo: "Saldo",
};

export function AuditoriaDetail({ evento }: { evento: EventoAuditoria }) {
  const acc = accionConfig(evento.accion);
  const metaEntries = evento.meta ? Object.entries(evento.meta) : [];

  return (
    <div className="space-y-5">
      <DetailSection icon={Activity} title="Evento">
        <DetailGrid
          rows={[
            ["Fecha y hora", fmtDateTime(evento.created_at)],
            ["Entidad", ENTIDAD_LABEL[evento.entidad] ?? evento.entidad],
            ["Acción", <StatusBadge key="a" label={acc.label} variant={acc.variant} />],
            ["Descripción", evento.descripcion],
            ["ID de entidad", evento.entidad_id ? <span className="font-mono text-[11px]">{evento.entidad_id}</span> : null],
          ]}
        />
      </DetailSection>

      {metaEntries.length > 0 && (
        <DetailSection icon={Database} title="Detalle (meta)">
          <DetailGrid
            rows={metaEntries.map(([k, v]) => [META_LABEL[k] ?? k, <span key={k} className="font-mono text-[11px]">{fmtMetaValue(v)}</span>])}
          />
        </DetailSection>
      )}
    </div>
  );
}
