"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmTone = "default" | "danger";

interface ConfirmOptions {
  /** Título del diálogo. */
  title: string;
  /** Texto explicativo (qué se va a hacer / consecuencia). */
  description?: ReactNode;
  /** Texto del botón que confirma. Por defecto "Confirmar". */
  confirmLabel?: string;
  /** Texto del botón que cancela. Por defecto "Cancelar". */
  cancelLabel?: string;
  /** "danger" tiñe el botón de confirmar de destructivo (eliminar/anular). */
  tone?: ConfirmTone;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Confirmación previa imperativa y promise-based.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "¿Eliminar cliente?", tone: "danger" }))) return;
 *
 * Resuelve `true` si el usuario confirma, `false` si cancela o cierra.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>");
  return ctx;
}

const DEFAULTS: Required<Pick<ConfirmOptions, "confirmLabel" | "cancelLabel" | "tone">> = {
  confirmLabel: "Confirmar",
  cancelLabel: "Cancelar",
  tone: "default",
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOpen(false);
  }, []);

  // Cierre por overlay / Escape → equivale a cancelar.
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) settle(false);
    },
    [settle],
  );

  const tone = opts?.tone ?? DEFAULTS.tone;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="max-w-md bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{opts?.title}</AlertDialogTitle>
            {opts?.description ? (
              <AlertDialogDescription asChild>
                <div className="text-sm text-muted-foreground">{opts.description}</div>
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {opts?.cancelLabel ?? DEFAULTS.cancelLabel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={cn(
                tone === "danger" &&
                  buttonVariants({ variant: "destructive" }),
              )}
            >
              {opts?.confirmLabel ?? DEFAULTS.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
