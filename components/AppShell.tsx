"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Home, Users, FileText, Wallet, Bell, Search, LogOut, Menu, X,
  ShieldAlert, BarChart3, PlusCircle, Settings, History,
  FileBarChart, Landmark, Sun, Moon, UserCog, Truck, ShieldCheck, Receipt,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Footer } from "./Footer";
import { SystemActionsProvider } from "./system-actions";
import { canAccess, ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";

const NAV_PRIMARY = [
  { icon: Home,        label: "Home",           to: "/" },
  { icon: BarChart3,   label: "Cartera",        to: "/cartera" },
  { icon: Users,       label: "Clientes",       to: "/clientes" },
  { icon: FileText,    label: "Créditos",       to: "/creditos" },
  { icon: ShieldAlert, label: "Cobranzas y Recupero", to: "/cobranza" },
  { icon: Wallet,      label: "Pagos",          to: "/pagos" },
] as const;

const NAV_SECONDARY = [
  { icon: Landmark,     label: "Caja",          to: "/caja" },
  { icon: Receipt,      label: "Comprobantes",  to: "/comprobantes" },
  { icon: UserCog,      label: "Personal",      to: "/personal" },
  { icon: Truck,        label: "Proveedores",   to: "/proveedores" },
  { icon: ShieldCheck,  label: "Usuarios",      to: "/usuarios" },
  { icon: FileBarChart, label: "Reportes",      to: "/reportes" },
  { icon: History,      label: "Auditoría",     to: "/auditoria" },
  { icon: Settings,     label: "Configuración", to: "/configuracion" },
] as const;

type NavItem = { icon: React.ElementType; label: string; to: string };

function SideNavLink({ icon: Icon, label, to, isActive, onClick }: NavItem & { isActive: boolean; onClick?: () => void }) {
  return (
    <Link
      href={to}
      onClick={onClick}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-out ${
        isActive
          ? "bg-primary/10 text-foreground shadow-md shadow-primary/10"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground hover:translate-x-0.5"
      }`}
    >
      {/* Indicador izquierdo del item activo (animado) */}
      <span
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-primary transition-all duration-200 ease-out ${
          isActive ? "h-5 opacity-100" : "h-0 opacity-0"
        }`}
      />
      <Icon
        className={`h-[18px] w-[18px] shrink-0 transition-colors duration-200 ${
          isActive ? "text-primary" : "group-hover:text-foreground"
        }`}
      />
      <span className={isActive ? "font-semibold" : ""}>{label}</span>
    </Link>
  );
}

export function AppShell({ children, role, nombre, email }: { children: React.ReactNode; role: Role; nombre: string | null; email: string | null }) {
  const router = useRouter();
  const pathname = usePathname();

  // Menú filtrado por rol (cosmético: la barrera real es el guard server + API).
  const navPrimary = NAV_PRIMARY.filter((i) => canAccess(role, i.to));
  const navSecondary = NAV_SECONDARY.filter((i) => canAccess(role, i.to));
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mounted, setMounted] = useState(false);

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

  const initials = (nombre?.trim() || email || "U").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const handlePaletteAction = (to: string) => {
    setPaletteOpen(false);
    router.push(to);
  };

  const isActive = (to: string) => {
    if (to === "/") return pathname === "/";
    return pathname?.startsWith(to);
  };

  if (!mounted) return null;

  const allNavItems = [...navPrimary, ...navSecondary];
  const isDark = resolvedTheme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  return (
    <div className="flex h-screen overflow-hidden text-foreground">

      {/* ── SIDEBAR DESKTOP (lg+) ─────────────────────────────────────────── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col bg-card/60 backdrop-blur-xl border-r border-border/50 shadow-[2px_0_32px_rgba(0,0,0,0.15)] dark:shadow-[2px_0_32px_rgba(0,0,0,0.5)]">
        {/* Branding — alto alineado con la línea inferior del PageHeader del contenido */}
        <Link href="/" className="flex h-[98px] shrink-0 items-center gap-3.5 border-b border-border/70 px-5 transition-opacity hover:opacity-80">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-success text-white shadow-lg shadow-primary/30 ring-1 ring-white/15">
            <span className="text-xl font-bold font-mono leading-none -tracking-[0.02em]">C</span>
          </div>
          <span className="text-base font-bold tracking-tight text-foreground font-mono">CreditFlow</span>
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <p className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">
            Principal
          </p>
          {navPrimary.map((item) => (
            <SideNavLink key={item.to} {...item} isActive={isActive(item.to)} />
          ))}

          <div className="my-4 mx-3 border-t border-border/50" />

          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">
            Sistema
          </p>
          {navSecondary.map((item) => (
            <SideNavLink key={item.to} {...item} isActive={isActive(item.to)} />
          ))}
        </nav>

        {/* User + signout */}
        <div className="shrink-0 border-t border-border/60 p-3">
          <div className="flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors duration-200 hover:bg-muted/30">
            <Link href="/perfil" title="Ver mi perfil" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-muted text-sm font-bold text-white shadow-md shadow-black/25 hover:opacity-80 transition-opacity">
              {initials}
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-foreground break-words leading-snug">
                  {displayName}
                </p>
                <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {ROLE_LABEL[role]}
                </span>
              </div>
              <p className="text-xs text-muted-foreground break-all leading-snug mt-0.5">
                {email ?? ""}
              </p>
              <button
                onClick={signOut}
                className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-destructive transition-colors"
              >
                <LogOut className="h-3 w-3" />
                Cerrar sesión
              </button>
            </div>
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
          <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden transition-opacity hover:opacity-80">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-white shadow-md shadow-primary/30 ring-1 ring-white/15">
              <span className="text-base font-bold font-mono leading-none -tracking-[0.02em]">C</span>
            </div>
            <span className="text-sm font-bold tracking-tight text-foreground font-mono">CreditFlow</span>
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

        {/* MAIN */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden py-6 md:py-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mx-auto w-full max-w-screen-2xl min-w-0 px-4 md:px-6 lg:px-8 space-y-8">
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
              <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-white shadow-md shadow-primary/30 ring-1 ring-white/15">
                  <span className="text-[17px] font-bold font-mono leading-none -tracking-[0.02em]">C</span>
                </div>
                <span className="text-base font-bold text-foreground font-mono">CreditFlow</span>
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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-muted text-sm font-bold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{email ?? ""}</p>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Principal
              </p>
              {navPrimary.map((item) => (
                <SideNavLink
                  key={item.to}
                  {...item}
                  isActive={isActive(item.to)}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
              <div className="my-3 border-t border-border" />
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Sistema
              </p>
              {navSecondary.map((item) => (
                <SideNavLink
                  key={item.to}
                  {...item}
                  isActive={isActive(item.to)}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
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
                {allNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.to}
                      onClick={() => handlePaletteAction(item.to)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                    >
                      <Icon className="h-4 w-4" />
                      <span>Ir a {item.label}</span>
                    </button>
                  );
                })}
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
