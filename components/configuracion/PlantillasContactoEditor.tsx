"use client";

import { useRef, useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useFinanciera } from "@/lib/swr";
import {
  MOTIVO_LABEL, PLACEHOLDERS_CONTACTO, renderPlantillaContacto,
  type MotivoContacto, type PlantillasContacto,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * Los textos que se le mandan al cliente desde su ficha, uno por motivo.
 *
 * Existían desde el principio pero solo se podían cambiar por API: la financiera estaba
 * atada a los textos por defecto, que a propósito son neutros y no dicen nada de ella.
 *
 * 🔴 LA VISTA PREVIA USA EL RENDERIZADOR DEL ENVÍO REAL (`renderPlantillaContacto`, en el
 * dominio). No es un detalle de prolijidad: si la pantalla tuviera su propia sustitución,
 * mostraría un mensaje y al cliente le llegaría otro. Es el mismo error de dos fórmulas que
 * ya apareció con los cargos y con la mora.
 */

/**
 * Cliente de ejemplo para la vista previa. Los números son coherentes entre sí a propósito:
 * lo VENCIDO (una cuota + mora) es menor que la deuda total del crédito, que es la relación
 * real y la que hay que entender al elegir entre `[vencido]` y `[deuda]`.
 */
const EJEMPLO = {
  nombre: "Juan Pérez",
  vencido: 39187.4,   // cuota 2 + su mora
  deuda: 152340.5,    // todo el crédito
  cuotas: 1,
  nroCuota: 2,
  dias: 12,
  cuota: 38085.13,
  vencimiento: "2026-09-10",
};

const MOTIVOS: MotivoContacto[] = ["mora", "promocion", "informacion"];

const AYUDA_MOTIVO: Record<MotivoContacto, string> = {
  mora: "Se manda cuando el cliente está atrasado. Es el único motivo que cuenta como gestión de cobranza.",
  promocion: "Ofertas y propuestas. No cuenta como gestión: no ensucia la efectividad del equipo.",
  informacion: "Avisos que no son ni reclamo ni oferta.",
};

export function PlantillasContactoEditor({ valor, onChange }: {
  valor: PlantillasContacto;
  onChange: (patch: Partial<PlantillasContacto>) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoContacto>("mora");
  const { financiera } = useFinanciera();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const claveTexto = motivo as keyof PlantillasContacto;
  const claveAsunto = `asunto_${motivo}` as keyof PlantillasContacto;
  const texto = valor[claveTexto];
  const asunto = valor[claveAsunto];

  const datos = { ...EJEMPLO, financiera: financiera?.nombre || "tu financiera" };
  const previewTexto = renderPlantillaContacto(texto, datos);
  const previewAsunto = renderPlantillaContacto(asunto, datos);

  /** Inserta `[clave]` donde está el cursor, que es donde el operador lo quiere. */
  const insertar = (clave: string) => {
    const el = textareaRef.current;
    const token = `[${clave}]`;
    if (!el) { onChange({ [claveTexto]: `${texto}${token}` } as Partial<PlantillasContacto>); return; }
    const { selectionStart: a, selectionEnd: b } = el;
    const nuevo = `${texto.slice(0, a)}${token}${texto.slice(b)}`;
    onChange({ [claveTexto]: nuevo } as Partial<PlantillasContacto>);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };

  return (
    <div className="space-y-4">
      {/* Un motivo por vez: los tres a la vez son seis campos de texto y nadie los revisa. */}
      <div className="flex flex-wrap gap-1.5">
        {MOTIVOS.map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMotivo(m)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              m === motivo
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {MOTIVO_LABEL[m]}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{AYUDA_MOTIVO[motivo]}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Asunto del email" hint="El WhatsApp no lleva asunto; se ignora en ese canal.">
            <Input
              value={asunto}
              onChange={e => onChange({ [claveAsunto]: e.target.value } as Partial<PlantillasContacto>)}
            />
          </Field>

          <Field label="Mensaje">
            <Textarea
              ref={textareaRef}
              rows={6}
              value={texto}
              onChange={e => onChange({ [claveTexto]: e.target.value } as Partial<PlantillasContacto>)}
            />
          </Field>

          {/* Los datos que se pueden intercalar. La lista sale del dominio: acá no se puede
              ofrecer una clave que después el envío no reemplace. */}
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Datos que podés intercalar · clic para insertar
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS_CONTACTO.map(p => (
                <button
                  key={p.clave}
                  type="button"
                  onClick={() => insertar(p.clave)}
                  title={p.descripcion}
                  className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                >
                  [{p.clave}]
                </button>
              ))}
            </div>
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {PLACEHOLDERS_CONTACTO.map(p => (
                <div key={p.clave} className="flex gap-1.5 text-[11px]">
                  <dt className="shrink-0 font-mono text-muted-foreground/70">[{p.clave}]</dt>
                  <dd className="truncate text-muted-foreground/70">{p.descripcion}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Vista previa: cómo lo recibe el cliente, con un caso de ejemplo. */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Así lo recibe el cliente
          </p>

          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> Email
            </p>
            <p className="mb-1 text-xs font-semibold text-foreground">{previewAsunto || <span className="text-muted-foreground/50">(sin asunto)</span>}</p>
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{previewTexto}</p>
          </div>

          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </p>
            <p className="whitespace-pre-wrap rounded-lg bg-success/10 p-2 text-xs text-foreground">{previewTexto}</p>
          </div>

          <p className="text-[11px] text-muted-foreground/60">
            Ejemplo: {datos.nombre} · cuota {EJEMPLO.nroCuota} vencida hace {EJEMPLO.dias} días ·
            {" "}vencido ${EJEMPLO.vencido.toLocaleString("es-AR", { minimumFractionDigits: 2 })} de
            {" "}${EJEMPLO.deuda.toLocaleString("es-AR", { minimumFractionDigits: 2 })} del crédito.
            Al enviarlo se usan los datos reales del cliente.
          </p>
        </div>
      </div>
    </div>
  );
}
