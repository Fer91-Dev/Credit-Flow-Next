"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle, ChevronDown, LifeBuoy } from "lucide-react";
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
    "No incluye las imágenes subidas (logos/fotos): se guardan aparte en el almacenamiento de archivos.",
  ],
};

/** "hace X" legible a partir de una fecha ISO. */
function haceTexto(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d !== 1 ? "s" : ""}`;
}

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

type Salud = { tono: "ok" | "alerta" | "neutro"; titulo: string; detalle: string };

/** Estado de salud del respaldo a partir de la última copia EXITOSA (señal de un vistazo). */
function calcularSalud(corridas: Corrida[] | null): Salud {
  if (!corridas) return { tono: "neutro", titulo: "Consultando estado de los respaldos…", detalle: "" };
  const exitosa = corridas.find((c) => c.estado === "completed" && c.conclusion === "success");
  const enCurso = corridas.some((c) => c.estado !== "completed");
  if (!exitosa) {
    return {
      tono: "alerta",
      titulo: enCurso ? "Backup en curso…" : "Sin copia exitosa reciente",
      detalle: enCurso ? "Esperá a que termine y refrescá." : "Revisá el estado o generá una copia ahora mismo.",
    };
  }
  const horas = (Date.now() - new Date(exitosa.creado).getTime()) / 3_600_000;
  if (horas > 36) {
    return {
      tono: "alerta",
      titulo: `Última copia exitosa ${haceTexto(exitosa.creado)}`,
      detalle: "Pasó más de un día sin un respaldo exitoso. Conviene revisarlo o generar uno ahora.",
    };
  }
  return {
    tono: "ok",
    titulo: `Última copia exitosa ${haceTexto(exitosa.creado)}`,
    detalle: "Tus datos están respaldados y a salvo.",
  };
}

/**
 * Configuración → Respaldos. Estado de salud + últimos backups + disparo manual + cómo
 * restaurar. El respaldo real corre en GitHub (pg_dump → cifrado → R2); acá es el control
 * remoto, el estado y la guía de recuperación.
 */
export function BackupsView() {
  const confirm = useConfirm();
  const toast = useToast();
  const [corridas, setCorridas] = useState<Corrida[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [noConfig, setNoConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lanzando, setLanzando] = useState(false);
  const [verRestore, setVerRestore] = useState(false);

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
      setTimeout(cargar, 3500);
    } catch {
      toast.error("No se pudo conectar para iniciar el backup.");
    } finally {
      setLanzando(false);
    }
  }

  const salud = calcularSalud(noConfig ? [] : corridas);

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
      align: "right",
      cell: (c) => {
        const b = badge(c);
        return <StatusBadge label={b.label} variant={b.variant} />;
      },
    },
  ];

  const saludStyle =
    salud.tono === "ok"
      ? "border-success/30 bg-success/10 text-success"
      : salud.tono === "alerta"
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-border bg-muted/30 text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* ── Panel principal: salud + explicación + acción ── */}
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

        {/* Indicador de salud (última copia exitosa) — señal de un vistazo */}
        <div className={`mb-3 flex items-center gap-3 rounded-lg border px-4 py-3 ${saludStyle}`}>
          {salud.tono === "ok" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" />
          ) : salud.tono === "alerta" ? (
            <AlertTriangle className="h-5 w-5 shrink-0" />
          ) : (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold">{salud.titulo}</p>
            {salud.detalle && <p className="text-xs opacity-80">{salud.detalle}</p>}
          </div>
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

        <p className="mt-3 text-xs text-muted-foreground/70">
          Respalda toda la base de datos (clientes, créditos, pagos, caja, configuración, usuarios). <strong>No</strong> incluye las imágenes subidas (logos/fotos), que se guardan aparte.
        </p>

        {noConfig && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-warning">
              El <strong>backup automático nocturno sí está activo</strong>, pero el disparo manual desde acá todavía no está configurado (falta el token de GitHub). Igual estás protegido cada noche.
            </p>
          </div>
        )}
      </div>

      {/* ── Cómo restaurar (vive dentro de la sección) ── */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setVerRestore((v) => !v)}
          aria-expanded={verRestore}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/20"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/20">
              <LifeBuoy className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">¿Cómo restauro un backup?</p>
              <p className="text-xs text-muted-foreground">Pasos para recuperar los datos a partir de una copia.</p>
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${verRestore ? "rotate-180" : ""}`} />
        </button>

        {verRestore && (
          <div className="border-t border-border px-5 py-4 space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs text-warning">
                Necesitás tu <strong>clave privada</strong> (la que guardaste offline) y las herramientas <code className="font-mono">age</code> y <code className="font-mono">pg_restore</code> (PostgreSQL 17). Sin la clave privada, los backups no se pueden descifrar.
              </p>
            </div>

            <RestorePaso n={1} titulo="Descargar la copia desde Cloudflare R2">
              Entrá al bucket <code className="font-mono">creditflow-backups</code> → carpeta <code className="font-mono">daily/</code> y bajá el archivo de la fecha que quieras recuperar (ej. <code className="font-mono">creditflow-20260728-030000.dump.age</code>).
            </RestorePaso>

            <RestorePaso n={2} titulo="Descifrar con tu clave privada">
              <CodeLine>age -d -i clave-privada.txt creditflow-XXXX.dump.age &gt; creditflow.dump</CodeLine>
            </RestorePaso>

            <RestorePaso n={3} titulo="Restaurar a una base de datos">
              <p className="mb-2">
                Probá <strong>primero en una base de prueba</strong> (no la de producción): el flag <code className="font-mono">--clean</code> sobrescribe los datos existentes.
              </p>
              <CodeLine>{`pg_restore -d "postgresql://…:5432/postgres" --clean --if-exists --no-owner --no-privileges creditflow.dump`}</CodeLine>
            </RestorePaso>

            <p className="text-xs text-muted-foreground/70">
              Recomendación: verificá los datos en la base de prueba (conteos de clientes/créditos) antes de restaurar sobre la real. Un respaldo recién sirve cuando probaste que se puede restaurar.
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
                  <StatusBadge label={b.label} variant={b.variant} />
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

/** Un paso numerado de la guía de restauración. */
function RestorePaso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-inset ring-primary/25">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/** Bloque de comando copiable-visualmente (monoespaciado, con scroll horizontal). */
function CodeLine({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-foreground">
      <code className="font-mono">{children}</code>
    </pre>
  );
}
