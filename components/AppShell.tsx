"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Bell, Search, LogOut, Menu, X, ChevronDown, PlusCircle, Sun, Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Footer } from "./Footer";
import { SystemActionsProvider } from "./system-actions";
import { canAccess, ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";
import { Emoji } from "@/components/ui/Emoji";
import type { Financiera } from "@/lib/swr";

/** Marca co-branded: logo + nombre de la financiera, con "powered by CreditFlow". Fallback
 *  a la marca CreditFlow si la financiera no cargó nombre/logo. */
function Brand({ financiera, size = "lg" }: { financiera?: Financiera | null; size?: "lg" | "sm" }) {
  const nombre = financiera?.nombre?.trim();
  const marca = nombre || "CreditFlow";
  const inicial = (nombre?.[0] ?? "C").toUpperCase();
  const box = size === "lg" ? "h-11 w-11 rounded-2xl text-xl" : "h-9 w-9 rounded-xl text-base";
  const txt = size === "lg" ? "text-base" : "text-sm";
  return (
    <div className="flex min-w-0 items-center gap-3">
      {financiera?.logo_url ? (
        <img src={financiera.logo_url} alt={marca} className={`${box} shrink-0 bg-card object-contain p-0.5 ring-1 ring-border`} />
      ) : (
        <div className={`${box} flex shrink-0 items-center justify-center bg-gradient-to-br from-primary to-success font-mono font-bold leading-none text-white shadow-lg shadow-primary/30 ring-1 ring-white/15`}>
          {inicial}
        </div>
      )}
      <div className="min-w-0 leading-tight">
        <span className={`block truncate ${txt} font-bold tracking-tight text-foreground`}>{marca}</span>
        {nombre && <span className="block text-[9px] uppercase tracking-wider text-muted-foreground/50">powered by CreditFlow</span>}
      </div>
    </div>
  );
}
import { Avatar } from "@/components/ui/Avatar";

/** `icon`: nombre del SVG Fluent Emoji en `public/emoji/<icon>.svg` (Microsoft, vía Iconify). */
type NavItem = { icon: string; label: string; to: string };
type NavGroup = { label: string; items: NavItem[] };

/** Home queda suelto arriba (no entra en ningún grupo colapsable). */
const HOME_ITEM: NavItem = { icon: "house", label: "Home", to: "/" };
/** Nav del dueño de la plataforma: solo el área de administración del SaaS. */
const OWNER_ITEM: NavItem = { icon: "gem-stone", label: "Administración del SaaS", to: "/plataforma" };

/**
 * Menús agrupados por dominio (colapsables). El filtrado por rol vacía grupos
 * que el rol no puede ver y se ocultan enteros (ver `groups` en AppShell):
 *  - vendedor → Operación + Caja; cobrador → solo Operación; admin → todo.
 * "Cartera" se quitó del menú a pedido (la ruta sigue viva, sin enlace).
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operación",
    items: [
      { icon: "busts-in-silhouette", label: "Clientes",             to: "/clientes" },
      { icon: "credit-card",         label: "Créditos",             to: "/creditos" },
      { icon: "dollar-banknote",     label: "Pagos",                to: "/pagos" },
      { icon: "megaphone",           label: "Cobranzas y Recupero", to: "/cobranza" },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { icon: "bank",      label: "Caja",         to: "/caja" },
      { icon: "receipt",   label: "Comprobantes", to: "/comprobantes" },
      { icon: "bar-chart", label: "Reportes",     to: "/reportes" },
    ],
  },
  {
    label: "Administración",
    items: [
      { icon: "office-worker",   label: "Agentes",     to: "/personal" },
      { icon: "package",         label: "Productos",   to: "/productos" },
      { icon: "counterclockwise-arrows-button", label: "Movimientos de stock", to: "/productos/movimientos" },
      { icon: "delivery-truck",  label: "Proveedores", to: "/proveedores" },
      { icon: "locked-with-key", label: "Usuarios",    to: "/usuarios" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { icon: "gear",       label: "Configuración",       to: "/configuracion" },
      { icon: "gem-stone",  label: "Plan y facturación",  to: "/facturacion" },
      { icon: "scroll",     label: "Auditoría",           to: "/auditoria" },
    ],
  },
];

function SideNavLink({ icon, label, to, isActive, onClick, nested = false }: NavItem & { isActive: boolean; onClick?: () => void; nested?: boolean }) {
  return (
    <Link
      href={to}
      onClick={onClick}
      className={`group flex items-center rounded-lg font-medium transition-colors duration-200 ease-out ${
        nested ? "gap-2.5 px-2.5 py-1.5 text-[13px]" : "gap-3 px-3 py-2.5 text-sm"
      } ${
        isActive
          ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/30"
          : "text-muted-foreground hover:bg-muted/10 hover:text-foreground"
      }`}
    >
      <Emoji name={icon} className={nested ? "h-[18px] w-[18px]" : "h-5 w-5"} />
      <span className={isActive ? "font-semibold" : ""}>{label}</span>
    </Link>
  );
}

/** Grupo colapsable del sidebar: cabecera con chevron + sus items. */
function NavSection({
  group, open, groupActive, isActive, onToggle, onNavigate,
}: {
  group: NavGroup;
  open: boolean;
  groupActive: boolean;
  isActive: (to: string) => boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="pt-3 first:pt-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors ${
          groupActive ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground"
        }`}
      >
        <span>{group.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
      </button>
      {/* Despliegue suave: grid-rows 0fr→1fr anima la altura sin saltos. */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className={`ml-4 mt-0.5 space-y-0.5 border-l border-border/40 pl-2 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}>
            {group.items.map((item) => (
              <SideNavLink key={item.to} {...item} isActive={isActive(item.to)} onClick={onNavigate} nested />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children, role, nombre, email, avatarUrl, financiera, esOwner = false }: { children: React.ReactNode; role: Role; nombre: string | null; email: string | null; avatarUrl: string | null; financiera?: Financiera | null; esOwner?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();

  // Menú agrupado, filtrado por rol (cosmético: la barrera real es el guard
  // server + API). Cada grupo se queda solo con los items accesibles; los
  // grupos que quedan vacíos no se renderizan.
  // El dueño de plataforma NO ve el menú de financiera: solo su área de administración.
  const groups = esOwner
    ? []
    : NAV_GROUPS
        .map((g) => ({ ...g, items: g.items.filter((i) => canAccess(role, i.to)) }))
        .filter((g) => g.items.length > 0);
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  // Colapso por grupo. Valor explícito tras togglear; si no hay, el grupo se
  // abre por defecto solo si contiene la ruta activa (ver `renderNav`).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Identidad del usuario: server-sourced (profiles vía requireAuth en el layout).
  // Fuente única de verdad — el perfil edita profiles.full_name y un router.refresh()
  // tras guardar re-ejecuta el layout y baja el nombre actualizado hasta acá.
  const displayName = nombre?.trim() || "Usuario";

  useEffect(() => {
    setMounted(true);
    // Restaura el colapso de grupos que el usuario fijó manualmente.
    try {
      const saved = localStorage.getItem("cf:navGroups");
      if (saved) setOpenGroups(JSON.parse(saved));
    } catch { /* sin persistencia, se usan los defaults */ }
  }, []);

  const setGroupOpen = (label: string, open: boolean) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: open };
      try { localStorage.setItem("cf:navGroups", JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function signOut() {
    // Logout real: invalida la sesión en Supabase (limpia cookies) y redirige.
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/auth");
      router.refresh();
    }
  }


  const handlePaletteAction = (to: string) => {
    setPaletteOpen(false);
    router.push(to);
  };

  const allNavItems = esOwner ? [OWNER_ITEM] : [HOME_ITEM, ...groups.flatMap((g) => g.items)];

  // Coincidencia por PREFIJO MÁS LARGO: cuando dos ítems matchean la ruta actual (ej.
  // "/productos" y "/productos/movimientos"), solo se resalta el más específico — evita
  // que ambos queden marcados como activos a la vez en rutas anidadas.
  const activeTo = (() => {
    let mejor: string | null = null;
    for (const item of allNavItems) {
      const matchea = item.to === "/" ? pathname === "/" : pathname === item.to || pathname?.startsWith(item.to + "/");
      if (matchea && (!mejor || item.to.length > mejor.length)) mejor = item.to;
    }
    return mejor;
  })();
  const isActive = (to: string) => to === activeTo;

  if (!mounted) return null;
  const isDark = resolvedTheme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  // Navegación compartida desktop/mobile: Home suelto + grupos colapsables.
  // `onNavigate` cierra el drawer en mobile (no-op en desktop).
  const renderNav = (onNavigate?: () => void) => (
    <>
      {esOwner ? (
        <SideNavLink {...OWNER_ITEM} isActive={isActive(OWNER_ITEM.to)} onClick={onNavigate} />
      ) : (
      <>
      <SideNavLink {...HOME_ITEM} isActive={isActive(HOME_ITEM.to)} onClick={onNavigate} />
      {groups.map((g) => {
        const groupActive = g.items.some((i) => isActive(i.to));
        const open = openGroups[g.label] ?? groupActive;
        return (
          <NavSection
            key={g.label}
            group={g}
            open={open}
            groupActive={groupActive}
            isActive={isActive}
            onToggle={() => setGroupOpen(g.label, !open)}
            onNavigate={onNavigate}
          />
        );
      })}
      </>
      )}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden text-foreground">

      {/* ── SIDEBAR DESKTOP (lg+) ─────────────────────────────────────────── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col bg-card/50 backdrop-blur-xl border-r border-border/40">
        {/* Branding — alto alineado con la línea inferior del PageHeader del contenido */}
        <Link href="/" className="flex h-[98px] shrink-0 items-center border-b border-border/70 px-5 transition-opacity hover:opacity-80">
          <Brand financiera={financiera} size="lg" />
        </Link>

        {/* Nav — Home suelto + grupos colapsables */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {renderNav()}
        </nav>

        {/* User — mini-tarjeta integrada */}
        <div className="shrink-0 p-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-muted/20 p-2 transition-colors duration-200 hover:bg-muted/30">
            <Link href="/perfil" title="Ver mi perfil" className="shrink-0 transition-opacity hover:opacity-80">
              <Avatar name={displayName} src={avatarUrl} size="xs" />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold leading-tight text-foreground">
                  {displayName}
                </p>
                <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                  {ROLE_LABEL[role]}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground leading-tight">
                {email ?? ""}
              </p>
            </div>
            <button
              onClick={signOut}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── COLUMNA DERECHA ───────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0 overflow-hidden">

        {/* TOPBAR — solo mobile (en desktop los controles viven en el PageHeader) */}
        <header className="lg:hidden sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card/95 backdrop-blur-sm px-4">
          {/* Burger — solo mobile */}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Logo — solo mobile */}
          <Link href="/" className="flex shrink-0 items-center lg:hidden transition-opacity hover:opacity-80">
            <Brand financiera={financiera} size="sm" />
          </Link>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Search icon */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              aria-label="Buscar"
            >
              <Search className="h-5 w-5" />
            </button>

            <button className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
              <Bell className="h-5 w-5" />
            </button>

            {/* Toggle claro/oscuro */}
            <button
              onClick={toggleTheme}
              title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

          </div>
        </header>

        {/* MAIN — sin padding vertical en el scrollport, así el PageHeader sticky se
            pega al borde superior real (con padding, el sticky quedaba 32px abajo y
            el contenido se colaba por la franja de arriba). El padding va al contenido. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="w-full min-w-0 px-4 pb-6 md:px-6 md:pb-8 lg:px-8 space-y-8">
            <SystemActionsProvider openSearch={() => setPaletteOpen(true)}>
              {children}
            </SystemActionsProvider>
          </div>
        </main>

        <Footer />
      </div>

      {/* ── MOBILE DRAWER ─────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-card/70 backdrop-blur-xl border-r border-border/50 shadow-2xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
              <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center transition-opacity hover:opacity-80">
                <Brand financiera={financiera} size="sm" />
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 border-b border-border px-4 py-4">
              <Avatar name={displayName} src={avatarUrl} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{email ?? ""}</p>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {renderNav(() => setMobileOpen(false))}
            </nav>

            <div className="shrink-0 border-t border-border p-3">
              <button
                onClick={signOut}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <LogOut className="h-4 w-4" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── COMMAND PALETTE ───────────────────────────────────────────────── */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-md"
            onClick={() => setPaletteOpen(false)}
          />
          <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center border-b border-border px-3.5">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                placeholder="Escribe un comando o navega a..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 w-full bg-transparent px-3 text-sm text-foreground placeholder-muted-foreground outline-none"
              />
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border">
                ESC
              </kbd>
            </div>

            <div className="max-h-72 overflow-y-auto p-2">
              <p className="px-3 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Navegación rápida
              </p>
              <div className="space-y-0.5">
                {allNavItems.map((item) => (
                  <button
                    key={item.to}
                    onClick={() => handlePaletteAction(item.to)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                  >
                    <Emoji name={item.icon} className="h-5 w-5" />
                    <span>Ir a {item.label}</span>
                  </button>
                ))}
              </div>

              <p className="mt-4 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Acciones Rápidas
              </p>
              <div className="space-y-0.5">
                <button
                  onClick={() => handlePaletteAction("/pagos")}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                >
                  <PlusCircle className="h-4 w-4 text-success" />
                  <span>Registrar nuevo abono/pago</span>
                </button>
                <button
                  onClick={() => handlePaletteAction("/clientes")}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                >
                  <PlusCircle className="h-4 w-4 text-primary" />
                  <span>Crear nuevo cliente</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
