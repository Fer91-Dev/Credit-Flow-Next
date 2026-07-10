"use client";

import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { ArrowLeft } from "lucide-react";
import { CreditoForm } from "./CreditoForm";
import { SystemControls } from "@/components/ui/SystemControls";
import { Emoji } from "@/components/ui/Emoji";
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
    <div className="-mx-4 -mb-6 md:-mx-6 md:-mb-8 lg:-mx-8 flex h-[calc(100dvh-3rem)] flex-col bg-background">
      {/* Header de la sección — misma altura (64px) que el PageHeader y el branding del sidebar */}
      <div className="flex h-[64px] items-center justify-between gap-3 border-b border-edge px-5 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push("/creditos")}
            title="Volver a créditos"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
            <Emoji name="credit-card" className="h-5 w-5" />
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
