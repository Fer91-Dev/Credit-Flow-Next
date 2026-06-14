"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Home, Users, FileText, Wallet, Bell, Search, LogOut, Menu, X,
  Terminal, ShieldAlert, BarChart3, PlusCircle, Settings, History, FileBarChart
} from "lucide-react";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { icon: Home, label: "Command Center", to: "/" },
  { icon: BarChart3, label: "Cartera", to: "/cartera" },
  { icon: Users, label: "Clientes", to: "/clientes" },
  { icon: FileText, label: "Créditos", to: "/creditos" },
  { icon: ShieldAlert, label: "Cobranza", to: "/cobranza" },
  { icon: Wallet, label: "Pagos", to: "/pagos" },
] as const;

function TopNavLink({ icon: Icon, label, to, isActive }: { icon: any; label: string; to: string; isActive: boolean }) {
  return (
    <Link
      href={to}
      className={`relative flex items-center py-4 group transition-colors text-sm font-medium ${
        isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
      }`}
    >
      <Icon className="h-[18px] w-[18px] mr-2" />
      <span>{label}</span>
      {isActive && <span className="absolute -bottom-px left-0 h-0.5 w-full rounded-full bg-primary" />}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
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
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function signOut() {
    // TODO Fase 2+: implementar sign out con Supabase
    // await supabase.auth.signOut();
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

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-3 px-4 md:px-6 lg:px-8 xl:gap-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent xl:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-white">
            <Terminal className="h-5 w-5" />
          </div>
          <span className="text-base md:text-lg font-bold tracking-tight text-foreground font-mono">CreditFlow</span>
        </div>

        <nav className="hidden min-w-0 items-center gap-5 xl:flex">
          {NAV_ITEMS.map((i) => (
            <TopNavLink key={i.to} {...i} isActive={isActive(i.to)} />
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
          {/* BOTÓN SEARCH PALETTE */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="relative hidden 2xl:flex items-center gap-2 h-10 w-56 rounded-lg border border-border bg-background pl-3 pr-2 text-left text-sm text-muted-foreground hover:border-primary transition-all"
          >
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">Buscar (Cmd+K)</span>
            <kbd className="hidden sm:inline-block rounded bg-muted px-1.5 font-mono text-[10px] font-medium border border-border text-foreground">
              ⌘K
            </kbd>
          </button>

          <Link
            href="/reportes"
            title="Reportes"
            className={`relative hidden h-10 w-10 items-center justify-center rounded-lg hover:bg-accent sm:flex ${
              isActive("/reportes") ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <FileBarChart className="h-5 w-5" />
          </Link>

          <Link
            href="/auditoria"
            title="Auditoría"
            className={`relative hidden h-10 w-10 items-center justify-center rounded-lg hover:bg-accent sm:flex ${
              isActive("/auditoria") ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <History className="h-5 w-5" />
          </Link>

          <Link
            href="/configuracion"
            title="Configuración"
            className={`relative hidden h-10 w-10 items-center justify-center rounded-lg hover:bg-accent sm:flex ${
              isActive("/configuracion") ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <Settings className="h-5 w-5" />
          </Link>

          <button className="relative hidden h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent sm:flex">
            <Bell className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2 md:gap-3 md:border-l md:border-border md:pl-3">
            <div className="hidden text-right 2xl:block">
              <p className="text-sm font-semibold text-foreground">{user?.full_name ?? "Usuario"}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-muted text-sm font-bold text-white">
              {initials}
            </div>
            <button
              onClick={signOut}
              title="Cerrar sesión"
              className="hidden md:flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      </header>

      {/* MOBILE SHELL */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden animate-fade-in" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-card border-r border-border shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
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
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-muted text-sm font-bold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{user?.full_name ?? "Usuario"}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {NAV_ITEMS.map(({ icon: Icon, label, to }) => (
                <Link key={to} href={to} onClick={() => setMobileOpen(false)} className="block">
                  <div
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all ${
                      isActive(to)
                        ? "bg-muted border border-primary text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{label}</span>
                  </div>
                </Link>
              ))}

              <Link href="/reportes" onClick={() => setMobileOpen(false)} className="block">
                <div
                  className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all ${
                    isActive("/reportes")
                      ? "bg-muted border border-primary text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <FileBarChart className="h-5 w-5" />
                  <span>Reportes</span>
                </div>
              </Link>

              <Link href="/auditoria" onClick={() => setMobileOpen(false)} className="block">
                <div
                  className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all ${
                    isActive("/auditoria")
                      ? "bg-muted border border-primary text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <History className="h-5 w-5" />
                  <span>Auditoría</span>
                </div>
              </Link>

              <Link href="/configuracion" onClick={() => setMobileOpen(false)} className="block">
                <div
                  className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all ${
                    isActive("/configuracion")
                      ? "bg-muted border border-primary text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Settings className="h-5 w-5" />
                  <span>Configuración</span>
                </div>
              </Link>
            </nav>

            <div className="border-t border-border p-3">
              <button
                onClick={signOut}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-5 w-5" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* COMMAND PALETTE POPUP */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={() => setPaletteOpen(false)} />
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
                {NAV_ITEMS.map((item) => {
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

      {/* MAIN CONTAINER */}
      <main className="flex-1 overflow-x-hidden bg-background py-6 md:py-8">
        <div className="mx-auto w-full max-w-screen-xl min-w-0 px-4 md:px-6 lg:px-8 space-y-6">
          {children}
        </div>
      </main>
    </div>
  );
}
