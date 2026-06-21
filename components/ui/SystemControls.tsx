"use client";

import { useEffect, useState } from "react";
import { Search, Bell, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSystemActions } from "@/components/system-actions";

/**
 * Controles globales del sistema (buscar / notificaciones / tema).
 * Vive en el PageHeader de cada sección. Solo desktop — en mobile estos
 * controles siguen en la barra superior del AppShell.
 */
export function SystemControls() {
  const actions = useSystemActions();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

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
      <button
        title="Notificaciones"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
      >
        <Bell className="h-4 w-4" />
      </button>

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
