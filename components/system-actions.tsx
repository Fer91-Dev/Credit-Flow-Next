"use client";

import { createContext, useContext } from "react";

/** Acciones globales del sistema expuestas por AppShell a los headers de página. */
interface SystemActions {
  openSearch: () => void;
}

const SystemActionsContext = createContext<SystemActions | null>(null);

export function SystemActionsProvider({
  openSearch,
  children,
}: {
  openSearch: () => void;
  children: React.ReactNode;
}) {
  return (
    <SystemActionsContext.Provider value={{ openSearch }}>
      {children}
    </SystemActionsContext.Provider>
  );
}

/** Devuelve las acciones del sistema, o null si se usa fuera del AppShell. */
export function useSystemActions(): SystemActions | null {
  return useContext(SystemActionsContext);
}
