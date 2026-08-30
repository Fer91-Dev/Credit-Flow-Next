"use client";

import { severidadMora } from "@/lib/domain";

import { useState, useMemo } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MoneyInput, FormActions } from "@/components/ui/form-kit";
import { nombreCompleto, parseMontoInput, maskMontoInput, formatFecha, formatDias } from "@/lib/utils";
import { useCuotas, useTramosMora } from "@/lib/swr";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

export interface CreditoCtx {
  id: string;
  cliente: { nombre: string; apellido?: string | null; telefono?: string };
  saldo_pendiente: number;
  dias_mora: number;
}

interface GestionFormProps {
  credito: CreditoCtx;
  onClose: (success?: boolean) => void;
}

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

export function GestionForm({ credito, onClose }: GestionFormProps) {
  /** Los cortes media/alta/crítica que definió la financiera (Configuración → Cobranza). */
  const tramos = useTramosMora();
  const confirm = useConfirm();
  const toast = useToast();
  /**
   * El cronograma del crédito, para poder proponer QUÉ prometer.
   *
   * Se pide acá y no se recibe por props porque este diálogo se abre desde dos lugares
   * (la agenda del día y la tabla de morosos) y ninguno de los dos tiene las cuotas a mano.
   * Los importes vienen calculados del server —cuota + su mora devengada— que es la misma
   * fuente con la que después se cobra.
   */
  const { cuotas } = useCuotas(credito.id);
  const opciones = useMemo(() => {
    const impagas = cuotas.filter((c) => c.estado !== "pagada");
    const vencidas = impagas.filter((c) => (c.dias_atraso ?? 0) > 0);
    const proxima = impagas[0];
    const out: { clave: string; titulo: string; detalle: string; monto: number }[] = [];
    if (proxima) {
      const monto = proxima.total_cobrar ?? proxima.cuota_total;
      out.push({
        clave: "cuota",
        titulo: `Cuota ${proxima.nro} · vence ${formatFecha(proxima.fecha_vencimiento)}`,
        detalle: (proxima.mora ?? 0) > 0 ? `incluye $${n2(proxima.mora ?? 0)} de mora` : "sin mora",
        monto,
      });
    }
    // "Ponerse al día" solo tiene sentido con MÁS de una cuota vencida: con una sola sería
    // el mismo importe que la opción de arriba, repetido.
    if (vencidas.length > 1) {
      const monto = Math.round(vencidas.reduce((s, c) => s + (c.total_cobrar ?? c.cuota_total), 0) * 100) / 100;
      const mora = Math.round(vencidas.reduce((s, c) => s + (c.mora ?? 0), 0) * 100) / 100;
      out.push({
        clave: "vencido",
        titulo: `Ponerse al día · ${vencidas.length} cuotas vencidas`,
        detalle: mora > 0 ? `incluye $${n2(mora)} de mora` : "sin mora",
        monto,
      });
    }
    return out;
  }, [cuotas]);
  const [form, setForm] = useState({
    tipo: "llamada",
    resultado: "contactado",
    nota: "",
    promesa_monto: "",
    promesa_fecha: "",
    proximo_contacto: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }));

  const esPromesa = form.resultado === "promesa_pago";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirm({
      title: "¿Registrar gestión?",
      description: `Se registrará la gestión de cobranza sobre el crédito de ${nombreCompleto(credito.cliente)}.`,
      confirmLabel: "Registrar gestión",
    });
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const body = {
        credito_id: credito.id,
        tipo: form.tipo,
        resultado: form.resultado,
        nota: form.nota.trim() || undefined,
        promesa_monto: form.promesa_monto ? parseMontoInput(form.promesa_monto) : undefined,
        promesa_fecha: form.promesa_fecha || undefined,
        proximo_contacto: form.proximo_contacto || undefined,
      };
      const res = await fetch("/api/cobranza/acciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) { toast.success("Gestión registrada"); onClose(true); }
      else setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Contexto del crédito */}
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <p className="text-sm font-medium text-foreground">{nombreCompleto(credito.cliente)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Saldo <span className="font-mono text-warning">${n0(credito.saldo_pendiente)}</span>
          {" · "}
          <span className={severidadMora(credito.dias_mora, tramos) === "critica" ? "text-destructive" : "text-warning"}>{formatDias(credito.dias_mora)} de mora</span>
          {credito.cliente.telefono ? ` · ${credito.cliente.telefono}` : ""}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Tipo de gestión" required>
          <Select value={form.tipo} onChange={set("tipo")}>
            <option value="llamada">Llamada</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="visita">Visita</option>
            <option value="otro">Otro</option>
          </Select>
        </Field>
        <Field label="Resultado" required>
          <Select value={form.resultado} onChange={set("resultado")}>
            <option value="contactado">Contactado</option>
            <option value="no_contesta">No contesta</option>
            <option value="promesa_pago">Promesa de pago</option>
            <option value="renegociacion">Renegociación</option>
            <option value="ilocalizable">Ilocalizable</option>
            <option value="otro">Otro</option>
          </Select>
        </Field>
      </div>

      <Field label="Nota">
        <Textarea
          rows={3}
          placeholder="Detalle de la gestión…"
          value={form.nota}
          onChange={set("nota")}
        />
      </Field>

      {/* Promesa de pago — destacada si el resultado es promesa */}
      <div className={`rounded-lg border p-3 space-y-3 transition-colors ${esPromesa ? "border-success/30 bg-success/5" : "border-border"}`}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Promesa de pago {esPromesa ? "" : "(opcional)"}
        </p>

        {/*
          Qué le puede prometer, con el importe puesto.

          El campo era un input vacío: para saber cuánto anotar había que cerrar el diálogo,
          entrar al crédito, mirar el cronograma y volver. Y el monto no es decorativo — el
          cron diario concilia la promesa contra los pagos posteriores, así que una promesa
          sin importe (o con uno inventado) nunca se marca cumplida sola.

          Son las dos promesas que existen en la práctica: "te pago la cuota" o "me pongo al
          día". Los dos importes salen del server ya con su mora.
        */}
        {opciones.length > 0 && (
          <div className="space-y-1.5">
            {opciones.map((o) => {
              const elegida = parseMontoInput(form.promesa_monto) === o.monto;
              return (
                <button
                  key={o.clave}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, promesa_monto: maskMontoInput(o.monto.toFixed(2).replace(".", ",")) }))}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    elegida ? "border-success/40 bg-success/10" : "border-border hover:bg-muted/30"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">{o.titulo}</span>
                    <span className="block text-[10px] text-muted-foreground">{o.detalle}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-sm font-bold text-foreground">
                    ${n2(o.monto)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Monto comprometido">
            <MoneyInput value={form.promesa_monto} onChange={(v) => setForm((p) => ({ ...p, promesa_monto: v }))} />
          </Field>
          <Field label="Fecha comprometida">
            <Input type="date" value={form.promesa_fecha} onChange={set("promesa_fecha")} />
          </Field>
        </div>
      </div>

      <Field label="Próximo contacto (recordatorio)" hint="Agendá cuándo volver a gestionar este crédito">
        <Input type="date" value={form.proximo_contacto} onChange={set("proximo_contacto")} />
      </Field>

      <FormActions
        onCancel={() => onClose(false)}
        loading={loading}
        submitLabel="Registrar gestión"
      />
    </form>
  );
}
