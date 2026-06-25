"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Mail, Smartphone, Sparkles, ExternalLink, Check, Zap, Loader2 } from "lucide-react";
import type { Credito } from "@/lib/swr";
import { useConfiguracion } from "@/lib/swr";
import {
  calculateRecoveryOffer,
  construirMensajeCampana,
  linkWhatsapp,
  TEMPLATE_DEFAULT,
  type CanalCampana,
} from "@/lib/domain";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { nombreCompleto } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

const CANAL_META: Record<CanalCampana, { label: string; icon: typeof MessageCircle }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  email: { label: "Email", icon: Mail },
  sms: { label: "SMS", icon: Smartphone },
};

interface CampaignModalProps {
  creditos: Credito[];
  onClose: (success?: boolean) => void;
}

export function CampaignModal({ creditos, onClose }: CampaignModalProps) {
  const { config } = useConfiguracion();
  const confirm = useConfirm();
  const toast = useToast();
  const whatsappApiActiva = !!(config?.whatsappConfig?.enabled);

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    canal: "whatsapp" as CanalCampana,
    promoActiva: true,
    promo_valor: "50",
    promo_vence: "",
    mensaje_template: TEMPLATE_DEFAULT,
  });
  const [loading, setLoading] = useState(false);
  const [enviandoApi, setEnviandoApi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [campanaId, setCampanaId] = useState<string | null>(null);
  const [enviados, setEnviados] = useState<Set<string>>(new Set());

  const descuentoPct = form.promoActiva ? Math.min(100, Math.max(0, parseFloat(form.promo_valor) || 0)) : 0;

  // Oferta por crédito (cálculo client-side con el mismo dominio que el server).
  const objetivos = useMemo(
    () =>
      creditos.map((c) => {
        const oferta = calculateRecoveryOffer({
          saldo: c.saldo_pendiente,
          interesMora: c.interes_mora ?? 0,
          diasMora: c.dias_mora,
          descuentoPct,
        });
        return { credito: c, oferta };
      }),
    [creditos, descuentoPct],
  );

  const totalSinDescuento = objetivos.reduce((s, o) => s + o.oferta.montoSinDescuento, 0);
  const totalAhorro = objetivos.reduce((s, o) => s + o.oferta.ahorro, 0);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      setError("Poné un nombre a la campaña");
      return;
    }
    const ok = await confirm({
      title: "¿Crear campaña?",
      description: `Se creará la campaña "${form.nombre.trim()}" con ${creditos.length} crédito${creditos.length !== 1 ? "s" : ""} en mora por ${CANAL_META[form.canal].label}.`,
      confirmLabel: "Crear campaña",
    });
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const body = {
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || undefined,
        canal: form.canal,
        promo_tipo: form.promoActiva ? "quita_interes" : "ninguna",
        promo_valor: descuentoPct,
        promo_vence: form.promo_vence || undefined,
        mensaje_template: form.mensaje_template.trim() || undefined,
        credito_ids: creditos.map((c) => c.id),
      };
      const res = await fetch("/api/cobranza/campanas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "No se pudo crear la campaña");
        return;
      }
      // WhatsApp y Email pasan al paso de lanzamiento; SMS cierra directamente.
      if (form.canal === "whatsapp" || form.canal === "email") {
        setCampanaId(json.data?.id ?? null);
        setLaunched(true);
      } else { toast.success("Campaña creada"); onClose(true); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const mensajePara = (o: (typeof objetivos)[number]) =>
    construirMensajeCampana(form.mensaje_template, {
      nombre: nombreCompleto(o.credito.cliente),
      monto: o.oferta.montoConDescuento,
      saldo: o.credito.saldo_pendiente,
      dias: o.credito.dias_mora,
      descuento: o.oferta.ahorro,
    });

  const abrirWhatsapp = (o: (typeof objetivos)[number]) => {
    window.open(linkWhatsapp(o.credito.cliente.telefono, mensajePara(o)), "_blank");
    setEnviados((prev) => new Set(prev).add(o.credito.id));
  };

  const enviarPorApi = async () => {
    if (!campanaId) return;
    const ok = await confirm({
      title: "¿Enviar la campaña?",
      description: `Se enviará el mensaje a ${objetivos.length} cliente${objetivos.length !== 1 ? "s" : ""} por ${CANAL_META[form.canal].label}. Esta acción contacta a los clientes y no se puede deshacer.`,
      confirmLabel: "Enviar ahora",
    });
    if (!ok) return;
    setEnviandoApi(true);
    setError(null);
    try {
      const res = await fetch(`/api/cobranza/campanas/${campanaId}/enviar`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) { setError(json.error || "Error al enviar"); toast.error(json.error || "Error al enviar"); return; }
      // Marcar todos como enviados
      const todos = new Set(objetivos.map(o => o.credito.id));
      setEnviados(todos);
      toast.success(`Campaña enviada a ${objetivos.length} cliente${objetivos.length !== 1 ? "s" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setEnviandoApi(false);
    }
  };

  // ── Paso 2: lanzamiento ──
  if (launched) {
    const todosMarcados = objetivos.length > 0 && objetivos.every(o => enviados.has(o.credito.id));
    const esEmail = form.canal === "email";
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 flex items-center gap-2.5">
          <Check className="h-4 w-4 text-success shrink-0" />
          <p className="text-sm text-success">
            Campaña creada.{" "}
            {esEmail
              ? `Enviá los emails a los ${objetivos.length} cliente${objetivos.length !== 1 ? "s" : ""} de la campaña.`
              : whatsappApiActiva
                ? "Podés enviar todo vía API de WhatsApp o abrir cada conversación manualmente."
                : "Abrí el WhatsApp de cada cliente para enviar el mensaje."}
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        {/* Botón de envío masivo vía API */}
        {(esEmail || whatsappApiActiva) && !todosMarcados && (
          <button
            onClick={enviarPorApi}
            disabled={enviandoApi}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-success text-white text-sm font-medium hover:bg-success/90 disabled:opacity-50 transition-colors"
          >
            {enviandoApi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {enviandoApi
              ? "Enviando…"
              : esEmail
                ? `Enviar ${objetivos.length} email${objetivos.length !== 1 ? "s" : ""}`
                : `Enviar ${objetivos.length} mensajes vía WhatsApp API`}
          </button>
        )}

        <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
          {objetivos.map((o) => {
            const enviado = enviados.has(o.credito.id);
            const sinTel = !o.credito.cliente.telefono;
            return (
              <div key={o.credito.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{nombreCompleto(o.credito.cliente)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Oferta <span className="font-mono text-foreground">${n0(o.oferta.montoConDescuento)}</span>
                    {o.oferta.ahorro > 0 && <span className="text-success"> · ahorra ${n0(o.oferta.ahorro)}</span>}
                    {sinTel && <span className="text-warning"> · sin teléfono</span>}
                  </p>
                </div>
                {/* Manual WhatsApp (solo para canal whatsapp) */}
                {!esEmail && (
                  <button
                    onClick={() => abrirWhatsapp(o)}
                    disabled={sinTel}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border shrink-0 ${
                      enviado
                        ? "bg-success/10 text-success border-success/30"
                        : sinTel
                          ? "opacity-40 cursor-not-allowed border-border text-muted-foreground"
                          : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                    }`}
                  >
                    {enviado ? <Check className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    {enviado ? "Enviado" : "Manual"}
                  </button>
                )}
                {/* Estado de envío para email */}
                {esEmail && enviado && (
                  <span className="flex items-center gap-1 text-xs text-success font-medium">
                    <Check className="h-3.5 w-3.5" /> Enviado
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end pt-1 border-t border-border">
          <button
            onClick={() => onClose(true)}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Listo
          </button>
        </div>
      </div>
    );
  }

  // ── Paso 1: configuración ──
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Audiencia */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          Audiencia: <span className="font-semibold text-foreground">{creditos.length} cliente{creditos.length !== 1 ? "s" : ""}</span> en mora ·
          deuda total <span className="font-mono text-warning">${n0(totalSinDescuento)}</span>
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre de la campaña" required>
          <Input placeholder="Ej: Recupero Junio" value={form.nombre} onChange={set("nombre")} />
        </Field>
        <Field label="Canal" required>
          <Select value={form.canal} onChange={set("canal")}>
            {(Object.keys(CANAL_META) as CanalCampana[]).map((k) => (
              <option key={k} value={k}>{CANAL_META[k].label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Descripción">
        <Input placeholder="Objetivo de la campaña (opcional)" value={form.descripcion} onChange={set("descripcion")} />
      </Field>

      {/* Promoción */}
      <div className={`rounded-lg border p-3 space-y-3 transition-colors ${form.promoActiva ? "border-success/30 bg-success/5" : "border-border"}`}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.promoActiva}
            onChange={(e) => setForm((p) => ({ ...p, promoActiva: e.target.checked }))}
            className="h-4 w-4 rounded border-border accent-success"
          />
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-success" /> Quita de intereses de mora
          </span>
        </label>
        {form.promoActiva && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="% de descuento sobre interés">
              <Input type="number" min="0" max="100" step="5" value={form.promo_valor} onChange={set("promo_valor")} />
            </Field>
            <Field label="Válida hasta" hint="Plazo para acogerse">
              <Input type="date" value={form.promo_vence} onChange={set("promo_vence")} />
            </Field>
          </div>
        )}
        {form.promoActiva && totalAhorro > 0 && (
          <p className="text-[11px] text-success">
            Ahorro total ofrecido: <span className="font-mono font-semibold">${n0(totalAhorro)}</span>
          </p>
        )}
      </div>

      {/* Mensaje */}
      <Field label="Mensaje" hint="Placeholders: [Nombre] [Monto] [Saldo] [Dias] [Descuento]">
        <Textarea rows={3} value={form.mensaje_template} onChange={set("mensaje_template")} />
      </Field>

      {/* Preview de oferta por cliente */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-muted/30 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
          Oferta por cliente
        </div>
        <div className="max-h-[28vh] overflow-y-auto divide-y divide-border/50">
          {objetivos.map((o) => (
            <div key={o.credito.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="text-foreground truncate">{nombreCompleto(o.credito.cliente)}</span>
              <span className="flex items-center gap-3 shrink-0 font-mono">
                {o.oferta.ahorro > 0 && <span className="text-success">−${n0(o.oferta.ahorro)}</span>}
                <span className="font-semibold text-foreground">${n0(o.oferta.montoConDescuento)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1 border-t border-border">
        <button type="button" onClick={() => onClose(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Creando…" : "Crear campaña"}
        </button>
      </div>
    </form>
  );
}
