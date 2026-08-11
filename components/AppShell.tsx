"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Bell, Search, LogOut, Menu, X, PlusCircle, Sun, Moon, HelpCircle,
  LayoutDashboard, Users, CreditCard, Banknote, Megaphone,
  Wallet, Receipt, Percent, BarChart3,
  UserCog, Package, ArrowLeftRight, Truck,
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
function Brand({ financiera, size = "lg", soloIcono = false }: { financiera?: Financiera | null; size?: "lg" | "sm"; soloIcono?: boolean }) {
  const nombre = financiera?.nombre?.trim();
  const marca = nombre || "CreditFlow";
  const inicial = (nombre?.[0] ?? "C").toUpperCase();
  const box = size === "lg" ? "h-11 w-11 rounded-2xl text-xl" : "h-9 w-9 rounded-xl text-base";
  const txt = size === "lg" ? "text-base" : "text-sm";
  return (
    <div className={`flex min-w-0 items-center ${soloIcono ? "justify-center" : "gap-3"}`}>
      {financiera?.logo_url ? (
        <img src={financiera.logo_url} alt={marca} className={`${box} shrink-0 bg-card object-contain p-0.5 ring-1 ring-border`} />
      ) : (
        <div className={`${box} flex shrink-0 items-center justify-center bg-gradient-to-br from-primary to-success font-mono font-bold leading-none text-white shadow-lg shadow-primary/30 ring-1 ring-white/15`}>
          {inicial}
        </div>
      )}
      {/* Contraído: queda solo el isotipo. El nombre de la financiera no entra en 64px y
          truncarlo a dos letras se lee peor que no ponerlo. */}
      {!soloIcono && (
        <div className="min-w-0 leading-tight">
          <span className={`block truncate ${txt} font-bold tracking-tight text-foreground`}>{marca}</span>
          {nombre && <span className="block text-[9px] uppercase tracking-wider text-muted-foreground/50">powered by CreditFlow</span>}
        </div>
      )}
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
      // "Equipo" unifica lo que antes eran Agentes + Usuarios (etapa 3 del refactor:
      // esas dos secciones se apagaron y sus rutas ya no existen).
      { icon: UserCog,        label: "Equipo",               to: "/equipo" },
      { icon: Package,        label: "Productos",            to: "/productos" },
      { icon: ArrowLeftRight, label: "Movimientos de stock", to: "/productos/movimientos" },
      { icon: Truck,          label: "Proveedores",          to: "/proveedores" },
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

/** Lo que el sidebar contraído le avisa al shell para dibujar el rótulo flotante. */
type AvisoRotulo = (label: string, el: HTMLElement | null) => void;

function SideNavLink({ icon: Icon, label, to, isActive, onClick, colapsado, onRotulo }: NavItem & {
  isActive: boolean; onClick?: () => void; colapsado?: boolean; onRotulo?: AvisoRotulo;
}) {
  // Contraído no queda texto: el nombre tiene que llegar por el rótulo flotante y por el
  // lector de pantalla, o el menú se vuelve un jeroglífico de íconos.
  const avisar = (el: HTMLElement | null) => { if (colapsado) onRotulo?.(label, el); };
  return (
    <Link
      href={to}
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      aria-label={colapsado ? label : undefined}
      onMouseEnter={(e) => avisar(e.currentTarget)}
      onMouseLeave={() => avisar(null)}
      onFocus={(e) => avisar(e.currentTarget)}
      onBlur={() => avisar(null)}
      className={`group relative flex items-center rounded-lg py-2 text-sm transition-all duration-150 ease-out ${
        colapsado ? "justify-center px-0" : "gap-3 px-3"
      } ${
        isActive
          ? "bg-primary/10 font-medium text-primary"
          : `font-normal text-muted-foreground hover:bg-muted/40 hover:text-foreground ${colapsado ? "" : "hover:translate-x-0.5"}`
      }`}
    >
      {/* Barra de acento del ítem activo: da un ancla vertical que el fondo solo no
          logra. Más corta que el ítem, así no toca las esquinas redondeadas. */}
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity duration-150 ${
          isActive ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* `strokeWidth` bajo: el trazo fino es lo que baja el ruido visual del menú.
          Al heredar currentColor, el ícono se tiñe de indigo con el hover y el foco. */}
      <Icon
        className={`h-[18px] w-[18px] shrink-0 transition-colors duration-150 ${
          isActive ? "" : "text-muted-foreground/70 group-hover:text-primary"
        }`}
        strokeWidth={1.75}
      />
      {!colapsado && <span className="truncate">{label}</span>}
    </Link>
  );
}

/** Grupo del sidebar: etiqueta separadora (no interactiva) + sus items. */
function NavSection({
  group, isActive, onNavigate, colapsado, onRotulo, primero,
}: {
  group: NavGroup;
  isActive: (to: string) => boolean;
  onNavigate?: () => void;
  colapsado?: boolean;
  onRotulo?: AvisoRotulo;
  /** Primer grupo del menú: no lleva separador arriba (ya está el borde de la marca). */
  primero?: boolean;
}) {
  return (
    <div className="mt-5 first:mt-0">
      {/* Contraído, la etiqueta del grupo se reemplaza por una línea: el agrupamiento se
          sigue leyendo, que es para lo que estaba, y no hace falta abreviar la palabra. */}
      {colapsado ? (
        !primero && <div aria-hidden className="mb-2 mt-1 h-px bg-border/70" />
      ) : (
        <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {group.label}
        </p>
      )}
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <SideNavLink
            key={item.to} {...item}
            isActive={isActive(item.to)} onClick={onNavigate}
            colapsado={colapsado} onRotulo={onRotulo}
          />
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

  /**
   * Sidebar contraído a una franja de íconos (solo desktop).
   *
   * Le devuelve 192px de ancho al contenido, que es donde se nota: el simulador tiene la
   * tabla del plan de pagos con hasta ocho columnas de importes y venía apretada.
   *
   * Arranca en `false` y se lee de localStorage recién montado: si se leyera durante el
   * render inicial, el HTML del servidor y el del cliente no coincidirían.
   */
  const [colapsado, setColapsado] = useState(false);
  /**
   * Rótulo flotante del modo contraído. Va en `position: fixed` a nivel del shell y no dentro
   * del ítem, porque el `<nav>` scrollea y cualquier cosa que asome fuera de los 64px de la
   * franja quedaría recortada.
   */
  const [rotulo, setRotulo] = useState<{ label: string; top: number } | null>(null);
  const mostrarRotulo: AvisoRotulo = (label, el) => {
    if (!el) { setRotulo(null); return; }
    const r = el.getBoundingClientRect();
    setRotulo({ label, top: r.top + r.height / 2 });
  };

  useEffect(() => {
    try { setColapsado(localStorage.getItem("cf:navColapsado") === "1"); } catch { /* modo privado */ }
  }, []);
  const alternarColapso = () => {
    setRotulo(null); // si no, queda el rótulo colgado al expandir
    setColapsado((v) => {
      const n = !v;
      try { localStorage.setItem("cf:navColapsado", n ? "1" : "0"); } catch { /* modo privado */ }
      return n;
    });
  };

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
  // `compacto` solo lo pide el sidebar de escritorio; el drawer mobile siempre va completo.
  const renderNav = (onNavigate?: () => void, compacto = false) => (
    <>
      {esOwner ? (
        <NavSection
          group={{ label: "Plataforma", items: [OWNER_ITEM] }}
          isActive={isActive}
          onNavigate={onNavigate}
          colapsado={compacto}
          onRotulo={mostrarRotulo}
          primero
        />
      ) : (
        <>
          <NavSection
            group={{ label: "Principal", items: [HOME_ITEM] }}
            isActive={isActive}
            onNavigate={onNavigate}
            colapsado={compacto}
            onRotulo={mostrarRotulo}
            primero
          />
          {groups.map((g) => (
            <NavSection
              key={g.label} group={g} isActive={isActive} onNavigate={onNavigate}
              colapsado={compacto} onRotulo={mostrarRotulo}
            />
          ))}
        </>
      )}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden text-foreground">

      {/* ── SIDEBAR DESKTOP (lg+) ─────────────────────────────────────────── */}
      <aside
        className={`group/side hidden lg:flex fixed inset-y-0 left-0 z-30 flex-col bg-sidebar/85 backdrop-blur-xl border-r border-edge transition-[width] duration-200 ease-out ${
          colapsado ? "w-16" : "w-64"
        }`}
      >
        {/* Branding — alto alineado con la línea inferior del PageHeader del contenido */}
        <Link
          href="/"
          className={`flex h-[76px] shrink-0 items-center border-b border-edge transition-opacity hover:opacity-80 ${colapsado ? "justify-center px-0" : "px-5"}`}
        >
          <Brand financiera={financiera} size={colapsado ? "sm" : "lg"} soloIcono={colapsado} />
        </Link>

        {/* Nav — Home suelto + grupos colapsables. La identidad del usuario + logout viven ahora
            en el header (menú de usuario en SystemControls), no al pie del sidebar. */}
        <nav className={`flex-1 overflow-y-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${colapsado ? "px-2" : "px-3"}`}>
          {renderNav(undefined, colapsado)}
        </nav>

        {/*
          Aleta de contraer/expandir, montada SOBRE el borde derecho.

          Estuvo un rato como botón al pie del menú y no funcionaba: con su separador arriba
          se leía como una sección más del menú, y esa línea chocaba con la del footer. Acá no
          ocupa lugar en la lista ni agrega bordes — aparece al pasar el mouse por el sidebar y
          desaparece sola.
        */}
        <button
          type="button"
          onClick={alternarColapso}
          aria-label={colapsado ? "Expandir el menú" : "Contraer el menú"}
          aria-expanded={!colapsado}
          title={colapsado ? "Expandir el menú" : "Contraer el menú"}
          className="group/aleta absolute right-0 top-1/2 z-40 flex -translate-y-1/2 translate-x-1/2 items-center justify-center px-2 py-5 opacity-0 transition-opacity duration-150 group-hover/side:opacity-100 focus-visible:opacity-100"
        >
          {/* El área de clic es el padding del botón; esto es solo la marca visible. */}
          <span
            aria-hidden
            className="h-14 w-[3px] rounded-full bg-border transition-colors duration-150 group-hover/aleta:bg-primary"
          />
        </button>
      </aside>

      {/*
        Rótulo del modo contraído. Fijo a nivel del shell: el `<nav>` scrollea, así que un
        rótulo dentro del ítem quedaría recortado en el borde de la franja de 64px.
      */}
      {colapsado && rotulo && (
        <div
          role="tooltip"
          className="pointer-events-none fixed left-[4.25rem] z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-lg lg:block"
          style={{ top: rotulo.top }}
        >
          {rotulo.label}
        </div>
      )}

      {/* ── COLUMNA DERECHA ───────────────────────────────────────────────── */}
      <div className={`flex flex-1 flex-col min-w-0 overflow-hidden transition-[padding] duration-200 ease-out ${colapsado ? "lg:pl-16" : "lg:pl-64"}`}>

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
