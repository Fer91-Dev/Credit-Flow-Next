"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ExternalLink, AlertCircle } from "lucide-react";
import { Emoji } from "@/components/ui/Emoji";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { HelpHint, type AyudaBloque } from "@/components/configuracion/ConfigForm";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { formatFechaHora } from "@/lib/utils";

type Corrida = {
  id: number;
  estado: string;
  conclusion: string | null;
  creado: string;
  url: string;
  disparadoPor: string | null;
};

const AYUDA_BACKUPS: AyudaBloque = {
  titulo: "Respaldos",
  texto:
    "Copia de seguridad de toda la base de datos. Corre automáticamente todas las noches, cifrada y guardada fuera del proveedor. Desde acá también podés forzar uno ahora mismo.",
  puntos: [
    "Automático: cada noche a las 03:00 (no hay que hacer nada).",
    "Manual: el botón «Backup ahora» genera una copia extra al instante.",
    "Los respaldos están cifrados: solo se restauran con la clave privada guardada offline.",
  ],
};

/** Traduce el estado de una corrida de GitHub Actions a un badge legible. */
function badge(c: Corrida): { label: string; variant: BadgeVariant } {
  if (c.estado !== "completed") {
    return { label: c.estado === "queued" ? "En cola" : "En curso", variant: "warning" };
  }
  switch (c.conclusion) {
    case "success":
      return { label: "Completado", variant: "success" };
    case "failure":
      return { label: "Falló", variant: "destructive" };
    case "cancelled":
      return { label: "Cancelado", variant: "muted" };
    default:
      return { label: c.conclusion ?? "—", variant: "muted" };
  }
}

/** Origen de la corrida: nocturna (programada) o manual (con el usuario que la disparó). */
function origen(c: Corrida): string {
  const auto = c.disparadoPor === null || c.disparadoPor === "" || c.disparadoPor === "github-actions[bot]";
  return auto ? "Automático (programado)" : `Manual · ${c.disparadoPor}`;
}

/**
 * Configuración → Respaldos. Muestra el estado de los últimos backups y permite disparar
 * uno a demanda (workflow_dispatch en GitHub Actions vía /api/backups). El respaldo real
 * corre en GitHub (pg_dump → cifrado → R2); acá es el control remoto + el estado.
 */
export function BackupsView() {
  const confirm = useConfirm();
  const toast = useToast();
  const [corridas, setCorridas] = useState<Corrida[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [noConfig, setNoConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lanzando, setLanzando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/backups", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.status === 503 || json?.code === "BACKUP_NOT_CONFIGURED") {
        setNoConfig(true);
        setCorridas([]);
        return;
      }
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No se pudo obtener el estado de los respaldos.");
        return;
      }
      setNoConfig(false);
      setCorridas(json.data.corridas ?? []);
    } catch {
      setError("No se pudo conectar para obtener el estado de los respaldos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function backupAhora() {
    const ok = await confirm({
      title: "¿Generar un backup ahora?",
      description:
        "Se creará una copia de seguridad completa, cifrada y guardada fuera del proveedor. Tarda uno o dos minutos en completarse.",
      confirmLabel: "Sí, generar backup",
    });
    if (!ok) return;

    setLanzando(true);
    try {
      const res = await fetch("/api/backups", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        toast.error(json?.error || "No se pudo iniciar el backup.");
        return;
      }
      toast.success("Backup iniciado. Aparecerá en la lista en unos segundos.");
      // Dar tiempo a GitHub a registrar la corrida y refrescar el estado.
      setTimeout(cargar, 3500);
    } catch {
      toast.error("No se pudo conectar para iniciar el backup.");
    } finally {
      setLanzando(false);
    }
  }

  const columns: Column<Corrida>[] = [
    {
      header: "Fecha y hora",
      cell: (c) => <span className="tabular-nums text-foreground">{formatFechaHora(c.creado)}</span>,
    },
    {
      header: "Origen",
      className: "hidden sm:table-cell",
      cell: (c) => <span className="text-muted-foreground">{origen(c)}</span>,
    },
    {
      header: "Estado",
      cell: (c) => {
        const b = badge(c);
        return <StatusBadge label={b.label} variant={b.variant} />;
      },
    },
    {
      header: "",
      align: "right",
      className: "w-10",
      cell: (c) => (
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Ver en GitHub"
          className="inline-flex text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── Panel principal: explicación + acción ── */}
      <div className="rounded-xl bg-card border border-border p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/20">
              <Emoji name="package" className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Respaldos de la base de datos</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Copia de seguridad automática cada noche, cifrada y guardada fuera del proveedor. También podés generar una ahora mismo.
              </p>
            </div>
          </div>
          <HelpHint ayuda={AYUDA_BACKUPS} />
        </div>

        {/* Estado del automático + botón manual */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Emoji name="alarm-clock" className="h-4 w-4" />
            <span>
              Respaldo automático <strong className="text-foreground">todas las noches a las 03:00</strong>. Retención de 30 días.
            </span>
          </div>
          <button
            type="button"
            onClick={backupAhora}
            disabled={lanzando || noConfig}
            title={noConfig ? "El disparo manual todavía no está configurado" : "Generar un backup ahora"}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {lanzando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Emoji name="package" className="h-4 w-4" />}
            {lanzando ? "Iniciando…" : "Backup ahora"}
          </button>
        </div>

        {noConfig && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-warning">
              El <strong>backup automático nocturno sí está activo</strong>, pero el disparo manual desde acá todavía no está configurado (falta el token de GitHub). Igual estás protegido cada noche.
            </p>
          </div>
        )}
      </div>

      {/* ── Últimos respaldos (tabla paginada) ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">Últimos respaldos</h3>
          <button
            type="button"
            onClick={cargar}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
          </button>
        </div>

        <DataTable
          columns={columns}
          rows={corridas ?? []}
          rowKey={(c) => String(c.id)}
          loading={loading}
          error={error}
          pageSize={8}
          empty={{
            icon: "package",
            title: "Todavía no hay respaldos registrados.",
            hint: "El primero aparece tras la corrida nocturna o al generar uno manual.",
          }}
          renderMobileCard={(c) => {
            const b = badge(c);
            return (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-foreground tabular-nums">{formatFechaHora(c.creado)}</p>
                  <div className="flex items-center gap-2">
                    <StatusBadge label={b.label} variant={b.variant} />
                    <a href={c.url} target="_blank" rel="noopener noreferrer" title="Ver en GitHub" className="text-muted-foreground/60 hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{origen(c)}</p>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
