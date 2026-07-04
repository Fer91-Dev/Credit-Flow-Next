"use client";

import { useState, useEffect } from "react";
import { Emoji } from "@/components/ui/Emoji";
import { Field, Input, Select } from "@/components/ui/field";
import { FormActions } from "@/components/ui/form-kit";
import { maskMontoInput, parseMontoInput, numeroAInput, nombreCompleto } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { useHasFeature } from "@/components/providers/FeaturesProvider";

/** Cliente recién creado, devuelto a quien abrió el formulario. */
export interface ClienteCreado { id: string; nombre: string; apellido?: string | null; documento?: string | null }

interface ClienteFormProps {
  clienteId?: string | null;
  /** DNI/documento para precargar en un alta rápida. */
  initialDocumento?: string;
  onClose: (success?: boolean, creado?: ClienteCreado) => void;
}

const EMPTY = {
  nombre: "", apellido: "", documento: "", email: "", telefono: "", direccion: "", zona: "",
  fecha_nacimiento: "", cuit_cuil: "", estado_civil: "", nacionalidad: "",
  situacion_laboral: "", ocupacion: "", empleador: "",
  antiguedad_anios: "", antiguedad_meses: "",
  ingreso_mensual: "", otros_ingresos: "",
  telefono_laboral: "", direccion_laboral: "",
  consentimiento_bureau: false,
};

/** Convierte meses totales guardados en años + meses para los inputs. */
function splitMeses(total?: number | null): { anios: string; meses: string } {
  const m = Number(total);
  if (!m || m <= 0) return { anios: "", meses: "" };
  return { anios: String(Math.floor(m / 12)), meses: String(m % 12) };
}

// Validaciones de formato.
const RE = {
  dni:   /^\d{7,8}$/,                     // DNI argentino: 7 u 8 dígitos
  cuit:  /^\d{2}-?\d{8}-?\d$/,            // CUIT/CUIL: 11 dígitos (guiones opcionales)
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  tel:   /^[\d\s()+-]{6,20}$/,           // teléfono: dígitos y símbolos comunes
};

/** Recorta una fecha ISO a yyyy-mm-dd para el input date. */
function toDateInput(s?: string | null) {
  return s ? String(s).slice(0, 10) : "";
}

/** Solo dígitos del valor del documento (un DNI nunca lleva letras ni espacios). */
function soloDigitos(v: string, max: number) {
  return v.replace(/\D/g, "").slice(0, max);
}

function SectionCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-muted/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border/60">
          <Emoji name={icon} className="h-4 w-4" />
        </div>
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">{title}</p>
      </div>
      {children}
    </section>
  );
}

export function ClienteForm({ clienteId, initialDocumento, onClose }: ClienteFormProps) {
  // El documento precargado puede venir "sucio" (ej. "Juan 36049884" desde el
  // buscador): nos quedamos solo con los dígitos.
  const [formData, setFormData] = useState({ ...EMPTY, documento: soloDigitos(initialDocumento ?? "", 8) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dniDup, setDniDup] = useState<{ nombre: string } | null>(null);  // otro cliente con ese DNI
  const [cuitDup, setCuitDup] = useState<{ nombre: string } | null>(null); // otro cliente con ese CUIT
  const confirm = useConfirm();
  const toast = useToast();
  const tieneRiesgo = useHasFeature("riesgo_originacion");

  useEffect(() => {
    if (clienteId) fetchCliente();
  }, [clienteId]);

  // Chequeo en vivo (debounce): prioridad DNI; si el DNI ya existe se diferencia por
  // CUIT. Avisa al instante para no cargar datos de un DNI repetido sin CUIT.
  useEffect(() => {
    const dni = formData.documento.trim();
    const cuit = formData.cuit_cuil.trim();
    const dniValido = RE.dni.test(dni);
    const cuitValido = RE.cuit.test(cuit);
    if (!dniValido && !cuitValido) { setDniDup(null); setCuitDup(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (dniValido) params.set("documento", dni);
        if (cuitValido) params.set("cuit", cuit);
        if (clienteId) params.set("excluir", clienteId);
        const res = await fetch(`/api/clientes/existe?${params.toString()}`, { signal: ctrl.signal });
        const json = await res.json();
        if (json.ok) {
          setDniDup(dniValido && json.data.dni.existe ? json.data.dni.cliente : null);
          setCuitDup(cuitValido && json.data.cuit.existe ? json.data.cuit.cliente : null);
        }
      } catch { /* abort o red: ignorar */ }
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [formData.documento, formData.cuit_cuil, clienteId]);

  // DNI repetido + sin CUIT válido → hay que diferenciar con el CUIT.
  const necesitaCuit = !!dniDup && !RE.cuit.test(formData.cuit_cuil.trim());
  const bloqueadoDup = !!cuitDup || necesitaCuit;

  const fetchCliente = async () => {
    try {
      const res = await fetch(`/api/clientes/${clienteId}`);
      const json = await res.json();
      if (json.ok) {
        const d = json.data;
        const { anios, meses } = splitMeses(d.antiguedad_laboral_meses);
        setFormData({
          nombre: d.nombre ?? "", apellido: d.apellido ?? "", documento: d.documento ?? "", email: d.email ?? "",
          telefono: d.telefono ?? "", direccion: d.direccion ?? "", zona: d.zona ?? "",
          fecha_nacimiento: toDateInput(d.fecha_nacimiento), cuit_cuil: d.cuit_cuil ?? "",
          estado_civil: d.estado_civil ?? "", nacionalidad: d.nacionalidad ?? "",
          situacion_laboral: d.situacion_laboral ?? "", ocupacion: d.ocupacion ?? "",
          empleador: d.empleador ?? "",
          antiguedad_anios: anios, antiguedad_meses: meses,
          ingreso_mensual: d.ingreso_mensual != null ? numeroAInput(d.ingreso_mensual) : "",
          otros_ingresos: d.otros_ingresos != null ? numeroAInput(d.otros_ingresos) : "",
          telefono_laboral: d.telefono_laboral ?? "", direccion_laboral: d.direccion_laboral ?? "",
          consentimiento_bureau: (d as { consentimiento_bureau?: boolean }).consentimiento_bureau ?? false,
        });
      }
    } catch { setError("Error al cargar cliente"); }
  };

  // Limpia el error de un campo cuando el usuario lo edita.
  const clearError = (field: string) =>
    setErrors((p) => { if (!p[field]) return p; const n = { ...p }; delete n[field]; return n; });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((p) => ({ ...p, [field]: e.target.value }));
    clearError(field);
  };

  // DNI: solo dígitos en vivo (nunca puede contener nombre ni letras).
  const setDni = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((p) => ({ ...p, documento: soloDigitos(e.target.value, 8) }));
    clearError("documento");
  };

  // Teléfonos: solo dígitos y símbolos de teléfono (+, -, espacio, paréntesis) en vivo.
  const setTel = (field: "telefono" | "telefono_laboral") => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((p) => ({ ...p, [field]: e.target.value.replace(/[^\d\s()+-]/g, "").slice(0, 20) }));
    clearError(field);
  };

  // CUIT/CUIL: solo dígitos y guiones en vivo (ej. 20-36049884-3).
  const setCuit = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((p) => ({ ...p, cuit_cuil: e.target.value.replace(/[^\d-]/g, "").slice(0, 13) }));
    clearError("cuit_cuil");
  };

  // Email: feedback inmediato de formato al salir del campo.
  const blurEmail = () => {
    if (formData.email.trim() && !RE.email.test(formData.email.trim())) {
      setErrors((p) => ({ ...p, email: "Email inválido (ej. nombre@correo.com)" }));
    }
  };

  // Campos de monto (es-AR): se enmascaran en vivo y se parsean a número al enviar.
  const setMonto = (field: "ingreso_mensual" | "otros_ingresos") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData((p) => ({ ...p, [field]: maskMontoInput(e.target.value) }));

  /** Valida los campos. Devuelve el mapa de errores (vacío si todo OK). */
  const validar = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!formData.nombre.trim()) e.nombre = "Ingresá el nombre";
    if (!formData.apellido.trim()) e.apellido = "Ingresá el apellido";
    const dni = formData.documento.trim();
    if (!dni) e.documento = "El DNI es obligatorio";
    else if (!RE.dni.test(dni)) e.documento = "DNI inválido (7 u 8 dígitos)";
    if (formData.cuit_cuil.trim() && !RE.cuit.test(formData.cuit_cuil.trim())) e.cuit_cuil = "CUIT/CUIL inválido (11 dígitos)";
    if (formData.email.trim() && !RE.email.test(formData.email.trim())) e.email = "Email inválido";
    if (formData.telefono.trim() && !RE.tel.test(formData.telefono.trim())) e.telefono = "Teléfono inválido";
    if (formData.telefono_laboral.trim() && !RE.tel.test(formData.telefono_laboral.trim())) e.telefono_laboral = "Teléfono inválido";
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (cuitDup) { setError(`Ya existe un cliente con el CUIT ${formData.cuit_cuil.trim()}: ${cuitDup.nombre}.`); return; }
    if (necesitaCuit) { setError(`Ya existe un cliente con el DNI ${formData.documento.trim()}: ${dniDup?.nombre}. Cargá el CUIL para diferenciarla.`); return; }
    const errs = validar();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setError(null);
      return;
    }
    setErrors({});

    // Confirmación previa: nombre completo para que el operador verifique a quién afecta.
    const nombreFull = nombreCompleto({ nombre: formData.nombre.trim(), apellido: formData.apellido.trim() });
    const ok = await confirm(
      clienteId
        ? {
            title: "¿Guardar cambios?",
            description: `Se actualizarán los datos de ${nombreFull}.`,
            confirmLabel: "Guardar cambios",
          }
        : {
            title: "¿Crear cliente?",
            description: `Se dará de alta a ${nombreFull} (DNI ${formData.documento.trim()}).`,
            confirmLabel: "Crear cliente",
          },
    );
    if (!ok) return;

    setLoading(true);
    setError(null);
    try {
      // Campos solo-UI que NO viajan tal cual al server: se transforman.
      const { apellido, antiguedad_anios, antiguedad_meses, ...rest } = formData;
      const anios = parseInt(antiguedad_anios) || 0;
      const meses = parseInt(antiguedad_meses) || 0;
      const hayAntiguedad = antiguedad_anios !== "" || antiguedad_meses !== "";

      // Los montos viajan como número (el texto enmascarado "850.000,00" rompería parseFloat en el server).
      const body = {
        ...rest,
        // Modelo normalizado: nombre y apellido viajan en columnas separadas.
        nombre: formData.nombre.trim(),
        apellido: apellido.trim(),
        // Antigüedad total en meses = años*12 + meses (sin romper el modelo actual).
        antiguedad_laboral_meses: hayAntiguedad ? anios * 12 + meses : "",
        ingreso_mensual: formData.ingreso_mensual ? parseMontoInput(formData.ingreso_mensual) : "",
        otros_ingresos: formData.otros_ingresos ? parseMontoInput(formData.otros_ingresos) : "",
      };
      const res = await fetch(clienteId ? `/api/clientes/${clienteId}` : "/api/clientes", {
        method: clienteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(clienteId ? `Cliente ${nombreFull} actualizado` : `Cliente ${nombreFull} creado`);
        onClose(true, json.data as ClienteCreado);
      } else setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  // Clase de borde rojo para inputs con error.
  const errCls = (field: string) => errors[field] ? "border-destructive focus:border-destructive focus:ring-destructive/20" : "";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[72vh] overflow-y-auto pr-1">
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Datos personales */}
      <SectionCard icon="bust-in-silhouette" title="Datos personales">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nombre" required error={errors.nombre}>
            <Input name="nombre" type="text" placeholder="Ej: Juan" value={formData.nombre}
              onChange={set("nombre")} className={errCls("nombre")} autoFocus />
          </Field>
          <Field label="Apellido" required error={errors.apellido}>
            <Input name="apellido" type="text" placeholder="Ej: Rodríguez" value={formData.apellido}
              onChange={set("apellido")} className={errCls("apellido")} />
          </Field>
          <Field
            label="DNI"
            required
            error={errors.documento || (necesitaCuit ? `Ya existe un cliente con este DNI: ${dniDup?.nombre}. Si es OTRA persona, cargá el CUIL para diferenciarla.` : undefined)}
            hint={dniDup && !necesitaCuit ? "DNI repetido — diferenciado por el CUIT" : "Solo números, sin puntos"}
          >
            <Input name="documento" type="text" inputMode="numeric" placeholder="Ej: 36049884" value={formData.documento}
              onChange={setDni} className={cnMono(necesitaCuit ? "border-destructive focus:border-destructive focus:ring-destructive/20" : errCls("documento"))} />
          </Field>
          <Field
            label={necesitaCuit ? "CUIL / CUIT (requerido)" : "CUIT / CUIL"}
            required={necesitaCuit}
            error={errors.cuit_cuil || (cuitDup ? `Ya existe un cliente con este CUIT: ${cuitDup.nombre}.` : undefined)}
            hint={necesitaCuit ? "Cargalo para diferenciar la persona del DNI repetido" : undefined}
          >
            <Input name="cuit_cuil" type="text" inputMode="numeric" placeholder="Ej: 20-36049884-3" value={formData.cuit_cuil}
              onChange={setCuit} className={cnMono((cuitDup || necesitaCuit) ? "border-destructive focus:border-destructive focus:ring-destructive/20" : errCls("cuit_cuil"))} />
          </Field>
          <Field label="Fecha de nacimiento">
            <Input name="fecha_nacimiento" type="date" value={formData.fecha_nacimiento} onChange={set("fecha_nacimiento")} />
          </Field>
          <Field label="Estado civil">
            <Select name="estado_civil" value={formData.estado_civil} onChange={set("estado_civil")}>
              <option value="">Sin especificar</option>
              <option value="soltero">Soltero/a</option>
              <option value="casado">Casado/a</option>
              <option value="divorciado">Divorciado/a</option>
              <option value="viudo">Viudo/a</option>
              <option value="union_convivencial">Unión convivencial</option>
            </Select>
          </Field>
          <Field label="Nacionalidad">
            <Input name="nacionalidad" type="text" placeholder="Ej: Argentina" value={formData.nacionalidad} onChange={set("nacionalidad")} />
          </Field>
          <Field label="Dirección">
            <Input name="direccion" type="text" placeholder="Calle y número" value={formData.direccion} onChange={set("direccion")} />
          </Field>
          <Field label="Zona / Barrio">
            <Input name="zona" type="text" placeholder="Ej: Centro, Norte…" value={formData.zona} onChange={set("zona")} />
          </Field>
        </div>
      </SectionCard>

      {/* Situación laboral */}
      <SectionCard icon="briefcase" title="Situación laboral">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Situación">
            <Select name="situacion_laboral" value={formData.situacion_laboral} onChange={set("situacion_laboral")}>
              <option value="">Sin especificar</option>
              <option value="relacion_dependencia">Relación de dependencia</option>
              <option value="autonomo">Autónomo</option>
              <option value="monotributista">Monotributista</option>
              <option value="jubilado">Jubilado/Pensionado</option>
              <option value="desempleado">Desempleado</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
          <Field label="Antigüedad laboral" hint="Años y meses en el empleo actual">
            <div className="grid grid-cols-2 gap-2">
              <Input name="antiguedad_anios" type="number" min="0" step="1" placeholder="Años"
                value={formData.antiguedad_anios} onChange={set("antiguedad_anios")} className="text-center font-mono tabular-nums" />
              <Input name="antiguedad_meses" type="number" min="0" max="11" step="1" placeholder="Meses"
                value={formData.antiguedad_meses} onChange={set("antiguedad_meses")} className="text-center font-mono tabular-nums" />
            </div>
          </Field>
          <Field label="Ocupación / Puesto">
            <Input name="ocupacion" type="text" placeholder="Ej: Comerciante" value={formData.ocupacion} onChange={set("ocupacion")} />
          </Field>
          <Field label="Empleador">
            <Input name="empleador" type="text" placeholder="Ej: Empresa S.A." value={formData.empleador} onChange={set("empleador")} />
          </Field>
        </div>
      </SectionCard>

      {/* Ingresos */}
      <SectionCard icon="money-bag" title="Ingresos / capacidad de pago">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Ingreso mensual ($)">
            <Input name="ingreso_mensual" type="text" inputMode="decimal" placeholder="850.000,00" value={formData.ingreso_mensual} onChange={setMonto("ingreso_mensual")} className="text-right font-mono tabular-nums" />
          </Field>
          <Field label="Otros ingresos ($)">
            <Input name="otros_ingresos" type="text" inputMode="decimal" placeholder="150.000,00" value={formData.otros_ingresos} onChange={setMonto("otros_ingresos")} className="text-right font-mono tabular-nums" />
          </Field>
        </div>
        {tieneRiesgo && (
          <label className={`mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2.5 transition-colors ${formData.consentimiento_bureau ? "bg-primary/[0.06] ring-1 ring-inset ring-primary/25" : "bg-muted/20"}`}>
            <input
              type="checkbox"
              checked={formData.consentimiento_bureau}
              onChange={(e) => setFormData((p) => ({ ...p, consentimiento_bureau: e.target.checked }))}
              className="mt-0.5 accent-primary"
            />
            <span className="text-xs text-foreground">
              El cliente presta conformidad para la consulta a bureaus de crédito (BCRA/Nosis/Veraz).
              <span className="block text-[11px] text-muted-foreground">Requisito legal (Ley 25.326 — habeas data) para consultas externas.</span>
            </span>
          </label>
        )}
      </SectionCard>

      {/* Contacto */}
      <SectionCard icon="mobile-phone" title="Contacto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Email" error={errors.email}>
            <Input name="email" type="email" placeholder="ejemplo@correo.com" value={formData.email}
              onChange={set("email")} onBlur={blurEmail} className={errCls("email")} />
          </Field>
          <Field label="Teléfono / WhatsApp" error={errors.telefono}>
            <Input name="telefono" type="tel" inputMode="tel" placeholder="Ej: 3814123693" value={formData.telefono}
              onChange={setTel("telefono")} className={errCls("telefono")} />
          </Field>
          <Field label="Teléfono laboral" error={errors.telefono_laboral}>
            <Input name="telefono_laboral" type="tel" inputMode="tel" placeholder="Ej: 3814555000" value={formData.telefono_laboral}
              onChange={setTel("telefono_laboral")} className={errCls("telefono_laboral")} />
          </Field>
          <Field label="Dirección laboral">
            <Input name="direccion_laboral" type="text" placeholder="Calle y número" value={formData.direccion_laboral} onChange={set("direccion_laboral")} />
          </Field>
        </div>
      </SectionCard>

      {/* Acciones */}
      <div className="sticky bottom-0 border-t border-border bg-card">
        <FormActions
          onCancel={() => onClose(false)}
          loading={loading}
          disabled={bloqueadoDup}
          submitLabel={clienteId ? "Actualizar cliente" : "Crear cliente"}
        />
      </div>
    </form>
  );
}

/** Combina el font-mono de DNI/CUIT con la clase de error. */
function cnMono(extra: string) {
  return `font-mono tabular-nums ${extra}`.trim();
}
