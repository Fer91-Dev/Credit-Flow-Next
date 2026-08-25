"use client";

import { useState } from "react";
import { Plus, Trash2, ShieldCheck, AlertTriangle, Power, DownloadCloud, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  CATEGORIAS_META, CATEGORIA_META_LABEL, CATEGORIA_META_NOTA, CATEGORIA_ESPERADA,
  PLACEHOLDERS_CONTACTO, MOTIVO_LABEL,
  revisarPlantillaMeta, variablesDeCuerpoMeta, renderPlantillaMeta,
  type CategoriaMeta, type PlantillaMeta, type MotivoContacto,
} from "@/lib/domain";

/**
 * Alta de las plantillas que Meta ya aprobó para WhatsApp Business.
 *
 * 🔴 ESTA PANTALLA NO APRUEBA NADA. La aprobación la da Meta en el Administrador de
 * WhatsApp; acá solo se REGISTRA una que ya está aprobada, para poder elegirla al contactar
 * o al armar una campaña. Por eso el cuerpo se pega tal cual, con sus variables numeradas:
 * si el texto guardado no es idéntico al aprobado, Meta no entrega el mensaje.
 *
 * Lo único que el sistema valida es que el registro sea COHERENTE — sobre todo que ninguna
 * variable quede sin dato asignado, porque una variable sin asignar viaja al cliente escrita
 * en crudo.
 */

/** Cliente de ejemplo para la vista previa. Los mismos números que el editor de mensajes. */
const EJEMPLO = {
  nombre: "Juan Pérez",
  financiera: "tu financiera",
  vencido: 39187.4,
  deuda: 152340.5,
  cuotas: 1,
  nroCuota: 2,
  dias: 12,
  cuota: 38085.13,
  vencimiento: "2026-09-10",
};

const MOTIVOS: MotivoContacto[] = ["mora", "promocion", "informacion"];

/**
 * Para qué sirve una plantilla de cada motivo. Se lee al elegir, que es cuando importa: una
 * plantilla de mora usada para una promo le reclama una deuda a quien ibas a ofrecerle algo.
 */
const MOTIVO_NOTA: Record<MotivoContacto, string> = {
  mora: "Reclamos de cuotas atrasadas. Solo aparece cuando estás contactando por mora, y es la única que sirve para campañas de recupero.",
  promocion: "Ofertas y propuestas. Meta la trata como publicidad: va aprobada como «Marketing».",
  informacion: "Avisos que no son reclamo ni oferta.",
};

function nuevaPlantilla(): PlantillaMeta {
  return {
    id: `meta-${Date.now().toString(36)}`,
    motivo: "mora",
    nombre: "",
    idioma: "es_AR",
    categoria: "utility",
    cuerpo: "",
    variables: [],
    activa: true,
  };
}

export function PlantillasMetaEditor({ valor, onChange }: {
  valor: PlantillaMeta[];
  onChange: (plantillas: PlantillaMeta[]) => void;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [omitidas, setOmitidas] = useState<{ nombre: string; idioma: string; motivo: string }[]>([]);
  const toast = useToast();

  const patch = (id: string, cambio: Partial<PlantillaMeta>) =>
    onChange(valor.map((p) => (p.id === id ? { ...p, ...cambio } : p)));

  const agregar = () => {
    const p = nuevaPlantilla();
    onChange([...valor, p]);
    setAbierta(p.id);
  };

  /**
   * Trae las plantillas aprobadas desde el Administrador de WhatsApp de Meta.
   *
   * 🔴 LA MEZCLA RESPETA EL TRABAJO LOCAL. Lo que se decidió acá —a qué dato apunta cada
   * variable, para qué motivo es, si está activa— NO viene de Meta y no se puede perder al
   * volver a importar: se pisan solo el cuerpo, el idioma y la categoría, que son lo que
   * Meta manda. Si no fuera así, cada importación borraría el mapeo de variables y las
   * plantillas quedarían mandando texto en crudo sin que nadie lo note.
   */
  const importar = async () => {
    if (importando) return;
    setImportando(true);
    setOmitidas([]);
    try {
      const res = await fetch("/api/configuracion/plantillas-meta/importar", { method: "POST" });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudieron traer las plantillas"); return; }

      const traidas: PlantillaMeta[] = json.data.plantillas ?? [];
      const porClave = new Map(valor.map((p) => [`${p.nombre}|${p.idioma}`, p]));
      let nuevas = 0;

      for (const t of traidas) {
        const previa = porClave.get(`${t.nombre}|${t.idioma}`);
        if (previa) {
          porClave.set(`${t.nombre}|${t.idioma}`, {
            ...previa,
            cuerpo: t.cuerpo,
            categoria: t.categoria,
            // Si el cuerpo cambió de cantidad de variables, el editor lo marca solo.
          });
        } else {
          porClave.set(`${t.nombre}|${t.idioma}`, t);
          nuevas++;
        }
      }
      onChange([...porClave.values()]);
      setOmitidas(json.data.omitidas ?? []);

      toast.success(
        traidas.length === 0
          ? "Meta no devolvió ninguna plantilla aprobada."
          : `${traidas.length} plantilla${traidas.length === 1 ? "" : "s"} de Meta · ${nuevas} nueva${nuevas === 1 ? "" : "s"}. Asigná las variables y guardá.`,
      );
    } catch {
      toast.error("No se pudo conectar con Meta");
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="space-y-3">
      {/*
        El encuadre va una sola vez y arriba: sin esto, alguien carga un texto inventado
        creyendo que el sistema lo manda a aprobar, y después no entiende por qué no llegan
        los mensajes.
      */}
      <div className="flex gap-2.5 rounded-xl border border-border bg-muted/25 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Las plantillas se aprueban en el <span className="text-foreground">Administrador de WhatsApp de Meta</span>.
            Acá se registran las que ya están aprobadas, para poder elegirlas al contactar o al armar una campaña.
          </p>
          <p>
            Copiá el cuerpo <span className="text-foreground">exactamente</span> como quedó aprobado, con sus variables
            numeradas. Si el texto no coincide, Meta no entrega el mensaje.
          </p>
          <p>Usarlas no es obligatorio: sin plantilla se manda texto libre, y el sistema avisa del riesgo antes de enviar.</p>
        </div>
      </div>

      {valor.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground">
            No hay plantillas registradas. Los mensajes salen como texto libre.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {valor.map((p) => (
            <FilaPlantilla
              key={p.id}
              p={p}
              abierta={abierta === p.id}
              onToggle={() => setAbierta(abierta === p.id ? null : p.id)}
              onPatch={(c) => patch(p.id, c)}
              onBorrar={() => { onChange(valor.filter((x) => x.id !== p.id)); setAbierta(null); }}
            />
          ))}
        </div>
      )}

      {/* Lo que Meta tiene pero todavía no se puede usar, con el motivo. Es información que
          solo está de su lado: sin esto, el operador no entiende por qué falta una. */}
      {omitidas.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/25 p-3">
          <p className="text-[11px] font-semibold text-foreground">
            {omitidas.length} plantilla{omitidas.length === 1 ? "" : "s"} de Meta que todavía no se pueden usar
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {omitidas.map((o, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                <span className="font-mono text-foreground">{o.nombre}</span>
                {o.idioma && <span className="text-muted-foreground/60"> · {o.idioma}</span>} — {o.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={agregar}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Registrar una plantilla aprobada
        </button>
        {/*
          Copiar y pegar el cuerpo es la forma más fácil de romper una plantilla sin enterarse:
          un espacio de más y Meta deja de entregar el mensaje, sin ningún error visible.
          Traerlas de la fuente elimina esa clase entera de error.
        */}
        <button
          type="button"
          onClick={importar}
          disabled={importando}
          className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        >
          {importando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
          Traer las aprobadas de Meta
        </button>
      </div>
    </div>
  );
}

function FilaPlantilla({ p, abierta, onToggle, onPatch, onBorrar }: {
  p: PlantillaMeta;
  abierta: boolean;
  onToggle: () => void;
  onPatch: (c: Partial<PlantillaMeta>) => void;
  onBorrar: () => void;
}) {
  const errores = revisarPlantillaMeta(p);
  const nVars = variablesDeCuerpoMeta(p.cuerpo);
  const preview = p.cuerpo ? renderPlantillaMeta(p, EJEMPLO) : "";

  return (
    <div className={`rounded-xl border transition-colors ${errores.length ? "border-warning/40" : "border-border"} bg-card`}>
      {/* Cabecera: se lee de un vistazo cuál es cada una y si está en uso. */}
      <div className="flex items-center gap-2 p-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.activa ? "bg-success" : "bg-muted-foreground/40"}`} />
          <span className="truncate font-mono text-xs text-foreground">{p.nombre || "sin nombre"}</span>
          {/* El motivo primero: es lo que dice en qué pantalla va a aparecer. */}
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {MOTIVO_LABEL[p.motivo]}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/60">
            {p.idioma} · {CATEGORIA_META_LABEL[p.categoria]}
          </span>
          {errores.length > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />}
        </button>
        <button
          type="button"
          onClick={() => onPatch({ activa: !p.activa })}
          title={p.activa ? "Desactivar (Meta puede pausarla)" : "Activar"}
          className={`rounded-lg p-1.5 transition-colors ${p.activa ? "text-success hover:bg-success/10" : "text-muted-foreground/50 hover:bg-muted"}`}
        >
          <Power className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onBorrar}
          title="Eliminar el registro"
          className="rounded-lg p-1.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {abierta && (
        <div className="space-y-3 border-t border-border p-3">
          {/*
            El MOTIVO va primero y solo: es lo que decide dónde aparece la plantilla. Al
            cambiarlo se ajusta también la categoría, porque las dos cosas tienen que ser
            coherentes o Meta no entrega el mensaje.
          */}
          <Field label="¿Para qué mensajes es?" hint={MOTIVO_NOTA[p.motivo]}>
            <Select
              value={p.motivo}
              onChange={(e) => {
                const motivo = e.target.value as MotivoContacto;
                onPatch({ motivo, categoria: CATEGORIA_ESPERADA[motivo] ?? p.categoria });
              }}
            >
              {MOTIVOS.map((m) => (
                <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Nombre en Meta" hint="Tal cual lo aprobó: minúsculas, números y guiones bajos.">
              <Input
                value={p.nombre}
                onChange={(e) => onPatch({ nombre: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                placeholder="aviso_mora_ar"
                className="font-mono"
              />
            </Field>
            <Field label="Idioma" hint="El código de Meta.">
              <Input value={p.idioma} onChange={(e) => onPatch({ idioma: e.target.value })} placeholder="es_AR" className="font-mono" />
            </Field>
            <Field label="Categoría" hint={CATEGORIA_META_NOTA[p.categoria]}>
              <Select value={p.categoria} onChange={(e) => onPatch({ categoria: e.target.value as CategoriaMeta })}>
                {CATEGORIAS_META.map((c) => (
                  <option key={c} value={c}>{CATEGORIA_META_LABEL[c]}</option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="Cuerpo aprobado"
            hint="Pegalo exactamente como quedó aprobado, con sus variables numeradas."
          >
            <Textarea
              rows={4}
              value={p.cuerpo}
              onChange={(e) => onPatch({ cuerpo: e.target.value })}
              placeholder="Hola {{1}}, tenés una cuota vencida por {{2}}. Comunicate con nosotros."
              className="font-mono text-xs"
            />
          </Field>

          {/* Qué dato va en cada variable. Sin esto, la variable viaja escrita en crudo. */}
          {nVars > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Qué dato va en cada variable</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Array.from({ length: nVars }, (_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-center font-mono text-[11px] text-primary">{`{{${i + 1}}}`}</span>
                    <Select
                      value={p.variables[i] ?? ""}
                      onChange={(e) => {
                        const vars = [...p.variables];
                        while (vars.length < nVars) vars.push("");
                        vars[i] = e.target.value;
                        onPatch({ variables: vars });
                      }}
                    >
                      <option value="">— elegí un dato —</option>
                      {PLACEHOLDERS_CONTACTO.map((ph) => (
                        <option key={ph.clave} value={ph.clave}>{ph.clave} — {ph.descripcion}</option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errores.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-2.5">
              {errores.map((e, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-warning">{e}</li>
              ))}
            </ul>
          )}

          {/* La vista previa usa el MISMO renderizador que el envío real: si acá se lee una
              cosa y al cliente le llega otra, es el bug que ya apareció con los importes. */}
          {preview && (
            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Así le llega a un cliente de ejemplo
              </p>
              <p className="whitespace-pre-line text-xs leading-relaxed text-foreground">{preview}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
