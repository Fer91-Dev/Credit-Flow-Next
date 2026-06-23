"use client";

import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { ArrowLeft } from "lucide-react";
import { CreditoForm } from "./CreditoForm";
import { SystemControls } from "@/components/ui/SystemControls";
import { KEYS } from "@/lib/swr";

/**
 * Vista dedicada del Simulador de crédito (ruta /creditos/nuevo).
 * Full-bleed: rompe el padding/ancho del <main> para ocupar toda la sección
 * (no es un modal ni una tarjeta flotante). Al cerrar/otorgar vuelve a la lista
 * de créditos y revalida la caché.
 */
export function NuevoCreditoView() {
  const router = useRouter();

  const handleClose = (success?: boolean) => {
    if (success) {
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.dashboard);
    }
    router.push("/creditos");
  };

  return (
    <div className="-mx-4 -my-6 md:-mx-6 md:-my-8 lg:-mx-8 flex h-[calc(100dvh-3rem)] flex-col bg-background">
      {/* Header de la sección — misma fila de controles que el resto del SaaS */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push("/creditos")}
            title="Volver a créditos"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="font-mono text-base font-black text-primary leading-none">$</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground leading-tight truncate">Simulador de crédito</h1>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">Sistema Francés · amortización por cuotas iguales</p>
          </div>
        </div>
        <SystemControls />
      </div>

      {/* Workspace a pantalla completa (sin tarjeta) */}
      <div className="flex-1 min-h-0">
        <CreditoForm creditoId={null} onClose={handleClose} />
      </div>
    </div>
  );
}
