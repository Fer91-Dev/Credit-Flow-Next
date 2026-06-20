"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Home, Users, FileText, Wallet, Bell, Search, LogOut, Menu, X,
  Terminal, ShieldAlert, BarChart3, PlusCircle, Settings, History,
  FileBarChart, Landmark, Sun, Moon, UserCog, Truck,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Footer } from "./Footer";

const NAV_PRIMARY = [
  { icon: Home,        label: "Home",           to: "/" },
  { icon: BarChart3,   label: "Cartera",        to: "/cartera" },
  { icon: Users,       label: "Clientes",       to: "/clientes" },
  { icon: FileText,    label: "Créditos",       to: "/creditos" },
  { icon: ShieldAlert, label: "Cobranza",       to: "/cobranza" },
  { icon: Wallet,      label: "Pagos",          to: "/pagos" },
] as const;

const NAV_SECONDARY = [
  { icon: Landmark,     label: "Caja",          to: "/caja" },
  { icon: UserCog,      label: "Personal",      to: "/personal" },
  { icon: Truck,        label: "Proveedores",   to: "/proveedores" },
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
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [user, setUser] = useState<{ email?: string; full_name?: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // TODO Fase 2+: cargar datos del usuario desde Supabase SSR
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
    // TODO Fase 2+: implementar sign out con Supabase
    router.push("/auth");
  }

  const initials = (user?.full_name ?? "U").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const handlePaletteAction = (to: string) => {
    setPaletteOpen(false);
    router.push(to);
  };

  const isActive = (to: string) => {
    if (to === "/") return pathname === "/";
    return pathname?.startsWith(to);
  };

  if (!mounted) return null;

  const allNavItems = [...NAV_PRIMARY, ...NAV_SECONDARY];
  const pageTitle = allNavItems.find(item => isActive(item.to))?.label ?? "CreditFlow";
  const isDark = resolvedTheme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  return (
    <div className="flex min-h-screen text-foreground">

      {/* ── SIDEBAR DESKTOP (lg+) ─────────────────────────────────────────── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-60 flex-col bg-card border-r border-border">
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-white">
            <Terminal className="h-5 w-5" />
          </div>
          <span className="text-base font-bold tracking-tight text-foreground font-mono">CreditFlow</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Principal
          </p>
          {NAV_PRIMARY.map((item) => (
            <SideNavLink key={item.to} {...item} isActive={isActive(item.to)} />
          ))}

          <div className="my-3 border-t border-border" />

          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Sistema
          </p>
          {NAV_SECONDARY.map((item) => (
            <SideNavLink key={item.to} {...item} isActive={isActive(item.to)} />
          ))}
        </nav>

        {/* User + signout */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-muted text-sm font-bold text-white">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{user?.full_name ?? "Usuario"}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email ?? ""}</p>
            </div>
            <button
              onClick={signOut}
              title="Cerrar sesión"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── COLUMNA DERECHA ───────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col lg:pl-60">

        {/* TOPBAR */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card/95 backdrop-blur-sm px-4 lg:px-6">
          {/* Burger — solo mobile */}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Logo — solo mobile */}
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-white">
              <Terminal className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold tracking-tight text-foreground font-mono">CreditFlow</span>
          </div>

          {/* Título de página — solo desktop */}
          <h2 className="hidden lg:block text-sm font-semibold text-foreground">{pageTitle}</h2>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Search — desktop */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden lg:flex items-center gap-2 h-9 w-56 rounded-lg border border-border bg-background pl-3 pr-2 text-left text-sm text-muted-foreground hover:border-primary transition-colors"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="flex-1">Buscar</span>
              <kbd className="rounded bg-muted px-1.5 font-mono text-[10px] font-medium border border-border text-foreground">
                ⌘K
              </kbd>
            </button>

            {/* Search icon — solo mobile */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent lg:hidden"
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

            {/* Avatar — solo mobile */}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-muted text-sm font-bold text-white lg:hidden">
              {initials}
            </div>
          </div>
        </header>

        {/* MAIN */}
        <main className="flex-1 overflow-x-hidden py-6 md:py-8">
          <div className="mx-auto w-full max-w-screen-2xl min-w-0 px-4 md:px-6 lg:px-8 space-y-8">
            {children}
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
          <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-card border-r border-border shadow-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-white">
                  <Terminal className="h-5 w-5" />
                </div>
                <span className="text-base font-bold text-foreground font-mono">CreditFlow</span>
              </div>
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
                <p className="truncate text-sm font-semibold text-foreground">{user?.full_name ?? "Usuario"}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email ?? ""}</p>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Principal
              </p>
              {NAV_PRIMARY.map((item) => (
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
              {NAV_SECONDARY.map((item) => (
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
