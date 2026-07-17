import * as React from "react";
import { Emoji } from "./Emoji";

/**
 * Primitivas de presentación de detalle (solo lectura), compartidas por los
 * modales de detalle de registros (pagos, caja, auditoría, cobranza, etc.).
 */

/** Título de sección dentro de un detalle. `icon` = nombre de Fluent Emoji o (legacy) componente lucide. */
export function DetailSection({
  icon,
  title,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }> | string;
  title: string;
  children: React.ReactNode;
}) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        {isEmoji ? <Emoji name={icon as string} className="h-4 w-4" /> : Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/** Lista key/value en tarjeta. Acepta filas [label, value]; oculta las nulas si `hideEmpty`. */
export function DetailGrid({
  rows,
  hideEmpty,
}: {
  rows: [string, React.ReactNode][];
  hideEmpty?: boolean;
}) {
  const visibles = hideEmpty ? rows.filter(([, v]) => v !== null && v !== undefined && v !== "") : rows;
  return (
    <dl className="rounded-xl border border-border divide-y divide-border/50">
      {visibles.map(([label, value], i) => (
        <div key={`${label}-${i}`} className="flex items-start justify-between gap-3 px-4 py-2.5">
          <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
          <dd className={`text-xs text-right ${value === null || value === undefined || value === "" ? "text-muted-foreground/30" : "text-foreground"}`}>
            {value === null || value === undefined || value === "" ? "—" : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
