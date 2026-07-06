"use client";

import useSWR from "swr";
import { Check, Sparkles, MessageCircle, Mail } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { PLANES, PLAN_CLAVES, CONTACTO_SAAS, type PlanClave } from "@/lib/planes";
import { formatFecha, formatMonto } from "@/lib/utils";

const MSG_PRO = "Hola! Quiero contratar el plan Pro de CreditFlow (filtro de clientes / motor de riesgo). ¿Cómo coordinamos el pago?";
const WHATSAPP_URL = `https://wa.me/${CONTACTO_SAAS.whatsapp}?text=${encodeURIComponent(MSG_PRO)}`;
const EMAIL_URL = `mailto:${CONTACTO_SAAS.email}?subject=${encodeURIComponent("Quiero el plan Pro de CreditFlow")}&body=${encodeURIComponent(MSG_PRO)}`;

interface Suscripcion {
  plan: PlanClave;
  estado: string;
  proveedor: string;
  monto: number;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  notas: string | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Plan del tenant (lo ve el admin de cada financiera). La administración de planes de TODAS
 *  las financieras vive en /plataforma (solo dueño). */
export function FacturacionView() {
  const { data, isLoading } = useSWR<{ ok: boolean; data: { suscripcion: Suscripcion } }>("/api/suscripciones/estado", fetcher);
  const sus = data?.data?.suscripcion;
  const planActual: PlanClave = sus?.plan ?? "free";

  return (
    <div className="space-y-6">
      <PageHeader icon="gem-stone" title="Plan y facturación" subtitle="Tu plan del SaaS y qué incluye cada nivel." accent="primary" />

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <div className="max-w-4xl space-y-6">
          {/* Plan vigente */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Plan actual</p>
                <div className="mt-1 flex items-center gap-2">
                  <h2 className="text-2xl font-bold text-foreground">{PLANES[planActual].label}</h2>
                  <StatusBadge label={sus?.estado ?? "activa"} variant={sus?.estado === "activa" ? "success" : sus?.estado === "vencida" ? "warning" : "muted"} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{PLANES[planActual].descripcion}</p>
              </div>
              {sus?.periodo_hasta && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Próximo vencimiento</p>
                  <p className="font-mono text-sm font-semibold text-foreground">{formatFecha(sus.periodo_hasta)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Comparativa de planes */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PLAN_CLAVES.map((clave) => {
              const plan = PLANES[clave];
              const esActual = clave === planActual;
              const esPro = clave === "pro";
              return (
                <div key={clave} className={`rounded-xl border bg-card p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] ${esActual ? "border-primary/40 ring-1 ring-inset ring-primary/25" : "border-border"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {esPro && <Sparkles className="h-4 w-4 text-primary" />}
                      <h3 className="text-lg font-semibold text-foreground">{plan.label}</h3>
                    </div>
                    {esActual && <StatusBadge label="Tu plan" variant="primary" />}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{plan.descripcion}</p>
                  <ul className="mt-4 space-y-2">
                    {plan.incluye.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <Check className={`mt-0.5 h-4 w-4 shrink-0 ${esPro ? "text-primary" : "text-success"}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                  {esPro && !esActual && (
                    <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
                      <MessageCircle className="h-4 w-4" /> Quiero el Pro
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {/* Contratación / contacto (modo manual: el pago se coordina por fuera) */}
          {planActual === "pro" ? (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
              Ya tenés el plan <strong className="text-foreground">Pro</strong> activo — el filtro inteligente de clientes (motor de riesgo + bureaus) está habilitado. ¿Dudas? Escribinos por{" "}
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">WhatsApp</a> o{" "}
              <a href={EMAIL_URL} className="text-primary hover:underline">email</a>.
            </div>
          ) : (
            <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-5">
              <h3 className="text-sm font-semibold text-foreground">¿Cómo contratar el Pro?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Escribinos y coordinamos el pago (transferencia){CONTACTO_SAAS.precioPro > 0 ? <> · <strong className="text-foreground">{formatMonto(CONTACTO_SAAS.precioPro)}/mes</strong></> : ""}. Apenas se confirma, activamos tu plan Pro.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-success-foreground transition-opacity hover:opacity-90 sm:flex-1">
                  <MessageCircle className="h-4 w-4" /> WhatsApp {CONTACTO_SAAS.whatsappDisplay}
                </a>
                <a href={EMAIL_URL} className="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:flex-1">
                  <Mail className="h-4 w-4" /> {CONTACTO_SAAS.email}
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
