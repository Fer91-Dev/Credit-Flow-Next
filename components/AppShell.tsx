"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Bell, Search, LogOut, Menu, X, PlusCircle, Sun, Moon, HelpCircle,
  LayoutDashboard, Users, CreditCard, Banknote, Megaphone,
  Wallet, Receipt, Percent, BarChart3,
  UserCog, Briefcase, Package, ArrowLeftRight, Truck, KeyRound,
  Settings, Gem, ScrollText, Building2,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Footer } from "./Footer";
import { SystemActionsProvider } from "./system-actions";
import { canAccess, type Role } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";
import { HelpPanel } from "@/components/ui/HelpPanel";
import { getHelpDoc } from "@/lib/help/content";
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

/** `icon`: componente de lucide-react (línea, monocromo, hereda `currentColor`). */
type NavItem = { icon: LucideIcon; label: string; to: string };
type NavGroup = { label: string; items: NavItem[] };

/** Home va suelto, FUERA del filtro por rol: `canAccess(cobrador, "/")` es false y el
 *  cobrador (rol legacy) se quedaría sin enlace a su propia pantalla de aterrizaje. */
const HOME_ITEM: NavItem = { icon: LayoutDashboard, label: "Home", to: "/" };
/** Nav del dueño de la plataforma: solo el área de administración del SaaS. */
const OWNER_ITEM: NavItem = { icon: Building2, label: "Administración del SaaS", to: "/plataforma" };

/**
 * Menús agrupados por dominio. La etiqueta del grupo es un SEPARADOR, no un control:
 * no colapsa. El filtrado por rol vacía grupos que el rol no puede ver y se ocultan
 * enteros (ver `groups` en AppShell):
 *  - vendedor → Operación + Caja; cobrador → solo Operación; admin → todo.
 * "Cartera" se quitó del menú a pedido (la ruta sigue viva, sin enlace).
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operación",
    items: [
      { icon: Users,      label: "Clientes",             to: "/clientes" },
      { icon: CreditCard, label: "Créditos",             to: "/creditos" },
      { icon: Banknote,   label: "Pagos",                to: "/pagos" },
      { icon: Megaphone,  label: "Cobranzas y Recupero", to: "/cobranza" },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { icon: Wallet,    label: "Caja",         to: "/caja" },
      { icon: Receipt,   label: "Comprobantes", to: "/comprobantes" },
      { icon: Percent,   label: "Comisiones",   to: "/comisiones" },
      { icon: BarChart3, label: "Reportes",     to: "/reportes" },
    ],
  },
  {
    label: "Administración",
    items: [
      // ETAPA 1 del refactor: "Equipo" unifica Agentes + Usuarios. Las tres conviven
      // a propósito para poder compararlas; al aprobar la nueva se quitan las viejas.
      { icon: UserCog,        label: "Equipo",               to: "/equipo" },
      { icon: Briefcase,      label: "Agentes",              to: "/personal" },
      { icon: Package,        label: "Productos",            to: "/productos" },
      { icon: ArrowLeftRight, label: "Movimientos de stock", to: "/productos/movimientos" },
      { icon: Truck,          label: "Proveedores",          to: "/proveedores" },
      { icon: KeyRound,       label: "Usuarios",             to: "/usuarios" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { icon: Settings,   label: "Configuración",      to: "/configuracion" },
      { icon: Gem,        label: "Plan y facturación", to: "/facturacion" },
      { icon: ScrollText, label: "Auditoría",          to: "/auditoria" },
    ],
  },
];

function SideNavLink({ icon: Icon, label, to, isActive, onClick }: NavItem & { isActive: boolean; onClick?: () => void }) {
  return (
    <Link
      href={to}
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        isActive
          ? "bg-primary/10 font-medium text-primary"
          : "font-normal text-muted-foreground hover:bg-muted/20 hover:text-foreground"
      }`}
    >
      {/* `strokeWidth` bajo: el trazo fino es lo que baja el ruido visual del menú. */}
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Grupo del sidebar: etiqueta separadora (no interactiva) + sus items. */
function NavSection({
  group, isActive, onNavigate,
}: {
  group: NavGroup;
  isActive: (to: string) => boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="mt-5 first:mt-0">
      <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
        {group.label}
      </p>
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <SideNavLink key={item.to} {...item} isActive={isActive(item.to)} onClick={onNavigate} />
        ))}
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
  // Ayuda contextual (mobile): mismo panel que en el header desktop (SystemControls).
  const [helpOpen, setHelpOpen] = useState(false);
  const helpDoc = getHelpDoc(pathname);

  // Identidad del usuario: server-sourced (profiles vía requireAuth en el layout).
  // Fuente única de verdad — el perfil edita profiles.full_name y un router.refresh()
  // tras guardar re-ejecuta el layout y baja el nombre actualizado hasta acá.
  const displayName = nombre?.trim() || "Usuario";

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Navegación compartida desktop/mobile: grupos planos con etiqueta separadora.
  // `onNavigate` cierra el drawer en mobile (no-op en desktop).
  const renderNav = (onNavigate?: () => void) => (
    <>
      {esOwner ? (
        <NavSection
          group={{ label: "Plataforma", items: [OWNER_ITEM] }}
          isActive={isActive}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          <NavSection
            group={{ label: "Principal", items: [HOME_ITEM] }}
            isActive={isActive}
            onNavigate={onNavigate}
          />
          {groups.map((g) => (
            <NavSection key={g.label} group={g} isActive={isActive} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden text-foreground">

      {/* ── SIDEBAR DESKTOP (lg+) ─────────────────────────────────────────── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col bg-sidebar/85 backdrop-blur-xl border-r border-edge">
        {/* Branding — alto alineado con la línea inferior del PageHeader del contenido */}
        <Link href="/" className="flex h-[64px] shrink-0 items-center border-b border-edge px-5 transition-opacity hover:opacity-80">
          <Brand financiera={financiera} size="lg" />
        </Link>

        {/* Nav — Home suelto + grupos colapsables. La identidad del usuario + logout viven ahora
            en el header (menú de usuario en SystemControls), no al pie del sidebar. */}
        <nav className="flex-1 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {renderNav()}
        </nav>
      </aside>

      {/* ── COLUMNA DERECHA ───────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0 overflow-hidden">

        {/* TOPBAR — solo mobile (en desktop los controles viven en el PageHeader) */}
        <header className="lg:hidden sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-edge bg-sidebar/85 backdrop-blur-md px-4">
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

            {/* Ayuda de la sección (solo si hay documento para esta ruta) */}
            {helpDoc && (
              <button
                onClick={() => setHelpOpen(true)}
                title={`Ayuda: ${helpDoc.titulo}`}
                aria-label="Abrir ayuda de la sección"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
              >
                <HelpCircle className="h-5 w-5" />
              </button>
            )}

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

        {/* Panel de ayuda contextual (mobile) */}
        <HelpPanel doc={helpDoc} open={helpOpen} onClose={() => setHelpOpen(false)} />

        {/* MAIN — sin padding vertical en el scrollport, así el PageHeader sticky se
            pega al borde superior real (con padding, el sticky quedaba 32px abajo y
            el contenido se colaba por la franja de arriba). El padding va al contenido. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="w-full min-w-0 px-4 pb-6 md:px-6 md:pb-8 lg:px-8 space-y-8">
            <SystemActionsProvider
              openSearch={() => setPaletteOpen(true)}
              usuario={{ nombre: displayName, email, role, avatarUrl }}
              signOut={signOut}
            >
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

            <nav className="flex-1 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                {allNavItems.map(({ icon: Icon, ...item }) => (
                  <button
                    key={item.to}
                    onClick={() => handlePaletteAction(item.to)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
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
