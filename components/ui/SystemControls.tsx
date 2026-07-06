"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Search, Bell, Sun, Moon, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { useTheme } from "next-themes";
import { useSystemActions } from "@/components/system-actions";
import { formatFecha } from "@/lib/utils";

const fetcher = (u: string) =>
  fetch(u).then((r) => (r.ok ? r.json() : null)).then((j) => (j?.ok ? j.data : null)).catch(() => null);

interface EstadoSus {
  suscripcion?: { plan: string; estado: string; periodo_hasta: string | null };
  esOwner?: boolean;
}

/** Aviso de plan derivado de la suscripción: vencido, o por vencer (≤3 días). null si nada. */
function calcularAviso(data: EstadoSus | null | undefined) {
  if (!data || data.esOwner) return null; // el dueño administra planes; no tiene el suyo
  const s = data.suscripcion;
  if (!s) return null;
  if (s.estado === "vencida") {
    return { tipo: "vencido" as const, titulo: "Tu plan Pro venció", texto: "El filtro de clientes (motor de riesgo) está desactivado. Renovalo para reactivarlo." };
  }
  if (s.plan === "pro" && s.periodo_hasta) {
    const dias = Math.ceil((new Date(s.periodo_hasta).getTime() - Date.now()) / 86_400_000);
    if (dias >= 0 && dias <= 3) {
      const cuando = dias === 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`;
      return { tipo: "por_vencer" as const, titulo: `Tu plan Pro vence ${cuando}`, texto: `Vence el ${formatFecha(s.periodo_hasta)}. Renovalo para no perder el filtro de clientes.` };
    }
  }
  return null;
}

/**
 * Controles globales del sistema (buscar / notificaciones / tema). Vive en el PageHeader.
 * La campanita avisa el estado del plan (vencido / por vencer) con un dropdown hacia
 * "Plan y facturación".
 */
export function SystemControls() {
  const actions = useSystemActions();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = resolvedTheme === "dark";

  const { data } = useSWR<EstadoSus | null>("/api/suscripciones/estado", fetcher, { revalidateOnFocus: false });
  const aviso = calcularAviso(data);
  const [open, setOpen] = useState(false);

  return (
    <div className="hidden lg:flex items-center gap-1.5">
      {/* Buscar (abre el command palette) */}
      <button
        onClick={() => actions?.openSearch()}
        className="flex items-center gap-2 h-9 w-52 rounded-lg border border-border bg-background pl-3 pr-2 text-left text-sm text-muted-foreground hover:border-primary transition-colors"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1">Buscar</span>
        <kbd className="rounded bg-muted px-1.5 font-mono text-[10px] font-medium border border-border text-foreground">⌘K</kbd>
      </button>

      {/* Notificaciones */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          title="Notificaciones"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
        >
          <Bell className="h-4 w-4" />
          {aviso && (
            <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-background ${aviso.tipo === "vencido" ? "bg-destructive" : "bg-warning"}`} />
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/20">
              <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Notificaciones</p>
              {aviso ? (
                <Link
                  href="/facturacion"
                  onClick={() => setOpen(false)}
                  className={`group flex items-start gap-2.5 rounded-lg p-2.5 transition-colors ${aviso.tipo === "vencido" ? "hover:bg-destructive/5" : "hover:bg-warning/5"}`}
                >
                  <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${aviso.tipo === "vencido" ? "text-destructive" : "text-warning"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{aviso.titulo}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{aviso.texto}</p>
                    <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary">
                      Ir a Plan y facturación <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-2 px-2.5 py-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" /> Sin novedades.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tema claro / oscuro */}
      {mounted && (
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
