"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/auth/roles";

export interface UsuarioActual {
  nombre: string;
  email: string | null;
  role: Role;
  avatarUrl: string | null;
}

/** Acciones + identidad globales que AppShell expone a los headers de página. */
interface SystemActions {
  openSearch: () => void;
  usuario: UsuarioActual;
  signOut: () => void;
}

const SystemActionsContext = createContext<SystemActions | null>(null);

export function SystemActionsProvider({
  openSearch,
  usuario,
  signOut,
  children,
}: {
  openSearch: () => void;
  usuario: UsuarioActual;
  signOut: () => void;
  children: React.ReactNode;
}) {
  return (
    <SystemActionsContext.Provider value={{ openSearch, usuario, signOut }}>
      {children}
    </SystemActionsContext.Provider>
  );
}

/** Devuelve las acciones del sistema, o null si se usa fuera del AppShell. */
export function useSystemActions(): SystemActions | null {
  return useContext(SystemActionsContext);
}
