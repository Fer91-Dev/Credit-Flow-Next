"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Bell, Sun, Moon, AlertTriangle, CheckCircle2, ArrowRight, ArrowDownLeft, ArrowUpRight, LogOut, ChevronDown, User, HelpCircle } from "lucide-react";
import { useTheme } from "next-themes";
import { useSystemActions } from "@/components/system-actions";
import { Avatar } from "@/components/ui/Avatar";
import { HelpPanel } from "@/components/ui/HelpPanel";
import { getHelpDoc } from "@/lib/help/content";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { formatFecha, formatFechaHora, formatMonto } from "@/lib/utils";

const fetcher = (u: string) =>
  fetch(u).then((r) => (r.ok ? r.json() : null)).then((j) => (j?.ok ? j.data : null)).catch(() => null);

interface EstadoSus {
  suscripcion?: { plan: string; estado: string; periodo_hasta: string | null };
  esOwner?: boolean;
}

interface MovNotif {
  id: string;
  created_at: string;
  tipo: string;
  monto: number;
  cuenta: string;
  descripcion: string;
  origen: string | null;
  destino: string | null;
  caja: string;
  /** Destino del clic (patrón extensible: cada notificación sabe a dónde lleva). */
  href: string;
}

const SEEN_KEY = "cf:notif-caja-seen";

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

const TIPO_LABEL: Record<string, string> = {
  desembolso: "Desembolso", cobro: "Cobro", devolucion: "Devolución",
  reversa_desembolso: "Reversa", ajuste: "Ajuste", transferencia: "Transferencia",
  entrega: "Entrega", rendicion: "Rendición", gasto: "Gasto",
};

/**
 * Controles globales del sistema (buscar / notificaciones / tema). Vive en el PageHeader.
 * La campanita avisa: (1) estado del plan (vencido / por vencer) y (2) MOVIMIENTOS DE CAJA
 * en vivo (admin: todas las cajas; vendedor: la suya). "No leído" = movimiento con
 * `created_at` posterior al último visto (marcador en localStorage).
 */
export function SystemControls() {
  const actions = useSystemActions();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = resolvedTheme === "dark";

  // Ayuda contextual: documento de la sección actual (null → no hay ayuda para esta ruta).
  const pathname = usePathname();
  const helpDoc = getHelpDoc(pathname);
  const [helpOpen, setHelpOpen] = useState(false);

  const { data } = useSWR<EstadoSus | null>("/api/suscripciones/estado", fetcher, { revalidateOnFocus: false });
  const aviso = calcularAviso(data);

  // Movimientos de caja (polling) + marcador de "último visto".
  const { data: notif } = useSWR<{ movimientos: MovNotif[] } | null>("/api/notificaciones", fetcher, {
    refreshInterval: 45_000,
    revalidateOnFocus: true,
  });
  const movimientos = useMemo(() => notif?.movimientos ?? [], [notif]);

  const [lastSeen, setLastSeen] = useState<number | null>(null);
  useEffect(() => {
    const v = localStorage.getItem(SEEN_KEY);
    if (v) setLastSeen(Number(v));
    else {
      const now = Date.now();
      localStorage.setItem(SEEN_KEY, String(now)); // primera vez: no floodear con históricos
      setLastSeen(now);
    }
  }, []);

  const nuevas = useMemo(
    () => (lastSeen == null ? [] : movimientos.filter((m) => new Date(m.created_at).getTime() > lastSeen)),
    [movimientos, lastSeen],
  );

  const [open, setOpen] = useState(false);
  // IDs que eran "nuevos" al abrir (para resaltarlos mientras el panel está abierto).
  const [resaltar, setResaltar] = useState<Set<string>>(new Set());

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (next) {
        setResaltar(new Set(nuevas.map((m) => m.id)));
        const now = Date.now();
        localStorage.setItem(SEEN_KEY, String(now)); // marcar leído al abrir → limpia el badge
        setLastSeen(now);
      }
      return next;
    });
  };

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
          onClick={toggle}
          title="Notificaciones"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
        >
          <Bell className="h-4 w-4" />
          {nuevas.length > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground ring-2 ring-background">
              {nuevas.length > 9 ? "9+" : nuevas.length}
            </span>
          ) : aviso ? (
            <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-background ${aviso.tipo === "vencido" ? "bg-destructive" : "bg-warning"}`} />
          ) : null}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40 cursor-pointer" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-11 z-50 max-h-[70vh] w-96 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/20">
              <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Notificaciones</p>

              {/* Aviso de plan */}
              {aviso && (
                <Link
                  href="/facturacion"
                  onClick={() => setOpen(false)}
                  className={`group flex items-start gap-2.5 rounded-lg p-2.5 transition-all duration-150 hover:translate-x-0.5 ${aviso.tipo === "vencido" ? "hover:bg-destructive/5" : "hover:bg-warning/5"}`}
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
              )}

              {/* Movimientos de caja */}
              <div className="mt-1 flex items-center justify-between px-2 pt-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Movimientos de caja</p>
                <Link href="/comprobantes" onClick={() => setOpen(false)} className="text-[11px] font-medium text-primary hover:underline">
                  Ver todo
                </Link>
              </div>

              {movimientos.length === 0 ? (
                <div className="flex items-center gap-2 px-2.5 py-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" /> Sin movimientos recientes.
                </div>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {movimientos.map((m) => {
                    const ingreso = m.monto >= 0;
                    const nuevo = resaltar.has(m.id);
                    return (
                      <li key={m.id}>
                        <Link
                          href={m.href}
                          onClick={() => setOpen(false)}
                          className={`group relative flex items-start gap-2.5 rounded-lg p-2.5 transition-all duration-150 hover:bg-accent hover:translate-x-0.5 ${nuevo ? "bg-primary/[0.06]" : ""}`}
                        >
                          {/* Barra de acento izquierda que crece al hover (indicador de selección) */}
                          <span className="absolute left-0 top-1/2 h-0 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-all duration-150 group-hover:h-7" />
                          <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform duration-150 group-hover:scale-110 ${ingreso ? "border-success/20 bg-success/10 text-success" : "border-warning/20 bg-warning/10 text-warning"}`}>
                            {ingreso ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-foreground">
                                {TIPO_LABEL[m.tipo] ?? m.tipo} · <span className="text-muted-foreground">{m.caja}</span>
                              </p>
                              <span className={`shrink-0 font-mono text-xs font-semibold ${ingreso ? "text-success" : "text-warning"}`}>
                                {ingreso ? "+" : "−"}{formatMonto(Math.abs(m.monto))}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.descripcion}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground/60">{formatFechaHora(m.created_at)}</p>
                          </div>
                          {nuevo && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/* Ayuda de la sección (solo si hay documento para esta ruta) */}
      {helpDoc && (
        <button
          onClick={() => setHelpOpen(true)}
          title={`Ayuda: ${helpDoc.titulo}`}
          aria-label="Abrir ayuda de la sección"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      )}

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

      {/* Menú de usuario (identidad + perfil + cerrar sesión) */}
      <UserMenu />

      {/* Panel de ayuda contextual */}
      <HelpPanel doc={helpDoc} open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

/** Avatar en el header que despliega la identidad del usuario + acceso al perfil + cerrar sesión.
 *  Reemplaza a la mini-tarjeta que estaba al pie del sidebar (un nombre largo la apretaba). */
function UserMenu() {
  const actions = useSystemActions();
  const [open, setOpen] = useState(false);
  if (!actions) return null;
  const { usuario, signOut } = actions;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Mi cuenta"
        className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 text-muted-foreground transition-colors hover:bg-accent"
      >
        <Avatar name={usuario.nombre} src={usuario.avatarUrl} size="xs" />
        <div className="min-w-0 text-left leading-tight">
          <p className="max-w-[130px] truncate text-xs font-semibold text-foreground">{usuario.nombre}</p>
          <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{ROLE_LABEL[usuario.role]}</p>
        </div>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 cursor-pointer" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/20">
            {/* Identidad */}
            <div className="flex items-center gap-2.5 p-2">
              <Avatar name={usuario.nombre} src={usuario.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold leading-tight text-foreground">{usuario.nombre}</p>
                  <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                    {ROLE_LABEL[usuario.role]}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">{usuario.email ?? ""}</p>
              </div>
            </div>

            <div className="my-1 h-px bg-border" />

            <Link
              href="/perfil"
              onClick={() => setOpen(false)}
              className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground transition-all duration-150 hover:translate-x-0.5 hover:bg-accent"
            >
              <User className="h-4 w-4 text-muted-foreground" /> Mi perfil
            </Link>
            <button
              onClick={() => { setOpen(false); signOut(); }}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-all duration-150 hover:translate-x-0.5 hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}
