"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastApi {
  show: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Notificaciones efímeras (arriba a la derecha). Disparar tras crear/editar/eliminar. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}

const META: Record<ToastVariant, { icon: typeof CheckCircle2; accent: string; ring: string }> = {
  success: { icon: CheckCircle2, accent: "text-success",     ring: "border-success/30" },
  error:   { icon: AlertCircle,  accent: "text-destructive",  ring: "border-destructive/30" },
  info:    { icon: Info,         accent: "text-primary",      ring: "border-primary/30" },
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, variant: ToastVariant = "success") => {
    const id = ++counter;
    setItems((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => remove(id), 3500);
  }, [remove]);

  const api: ToastApi = {
    show,
    success: (m) => show(m, "success"),
    error: (m) => show(m, "error"),
    info: (m) => show(m, "info"),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Viewport — fijo arriba a la derecha, por encima de todo (incluidos modales) */}
      <div className="pointer-events-none fixed top-4 right-4 z-[200] flex w-[min(92vw,360px)] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const { icon: Icon, accent, ring } = META[t.variant];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border ${ring} bg-card/95 backdrop-blur-md px-3.5 py-3 shadow-lg shadow-black/20`}
              >
                <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${accent}`} />
                <p className="flex-1 text-sm text-foreground leading-snug">{t.message}</p>
                <button
                  onClick={() => remove(t.id)}
                  className="shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
                  aria-label="Cerrar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
