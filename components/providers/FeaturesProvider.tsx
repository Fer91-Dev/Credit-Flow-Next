"use client";

import { createContext, useContext } from "react";
import { Lock, Sparkles } from "lucide-react";
import { FEATURES, hasFeature, type FeatureKey } from "@/lib/entitlements";

/**
 * Entitlements en el cliente. El layout server inyecta `tenants.features` (ya resueltos
 * por `requireAuth`) y cualquier componente puede consultarlos con `useHasFeature` o
 * envolver una sección con `<FeatureGate>`. OJO: esto es cosmético — la barrera real es
 * `requireFeature` en el Route Handler.
 */
const FeaturesContext = createContext<string[]>([]);

export function FeaturesProvider({ features, children }: { features: string[]; children: React.ReactNode }) {
  return <FeaturesContext.Provider value={features}>{children}</FeaturesContext.Provider>;
}

export function useFeatures(): string[] {
  return useContext(FeaturesContext);
}

export function useHasFeature(key: FeatureKey): boolean {
  return hasFeature(useContext(FeaturesContext), key);
}

/**
 * Envuelve una sección premium: si el tenant tiene la feature, renderiza los hijos;
 * si no, muestra un estado "función del plan" (upsell) con candado.
 */
export function FeatureGate({ feature, children }: { feature: FeatureKey; children: React.ReactNode }) {
  const enabled = useHasFeature(feature);
  if (enabled) return <>{children}</>;

  const meta = FEATURES[feature];
  return (
    <div className="rounded-xl border border-border bg-card p-8 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <div className="relative">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/25">
            <Lock className="h-6 w-6 text-primary" />
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/25">
          <Sparkles className="h-3.5 w-3.5" /> Plan {meta.plan}
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">{meta.label}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{meta.descripcion}</p>
        </div>
        <p className="text-xs text-muted-foreground/70">
          Esta función no está incluida en tu plan actual. Contactá al administrador del sistema para habilitarla.
        </p>
      </div>
    </div>
  );
}
