"use client";

import { useState, useEffect } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { maskMontoInput, parseMontoInput, numeroAInput } from "@/lib/utils";

/** Cliente recién creado, devuelto a quien abrió el formulario. */
export interface ClienteCreado { id: string; nombre: string; documento?: string | null }

interface ClienteFormProps {
  clienteId?: string | null;
  /** DNI/documento para precargar en un alta rápida. */
  initialDocumento?: string;
  onClose: (success?: boolean, creado?: ClienteCreado) => void;
}

const EMPTY = {
  nombre: "", documento: "", email: "", telefono: "", direccion: "",
  fecha_nacimiento: "", cuit_cuil: "", estado_civil: "", nacionalidad: "",
  situacion_laboral: "", ocupacion: "", empleador: "", antiguedad_laboral_meses: "",
  ingreso_mensual: "", otros_ingresos: "",
  telefono_laboral: "", direccion_laboral: "",
};

/** Recorta una fecha ISO a yyyy-mm-dd para el input date. */
function toDateInput(s?: string | null) {
  return s ? String(s).slice(0, 10) : "";
}

export function ClienteForm({ clienteId, initialDocumento, onClose }: ClienteFormProps) {
  const [formData, setFormData] = useState({ ...EMPTY, documento: initialDocumento ?? "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clienteId) fetchCliente();
  }, [clienteId]);

  const fetchCliente = async () => {
    try {
      const res = await fetch(`/api/clientes/${clienteId}`);
      const json = await res.json();
      if (json.ok) {
        const d = json.data;
        setFormData({
          nombre: d.nombre ?? "", documento: d.documento ?? "", email: d.email ?? "",
          telefono: d.telefono ?? "", direccion: d.direccion ?? "",
          fecha_nacimiento: toDateInput(d.fecha_nacimiento), cuit_cuil: d.cuit_cuil ?? "",
          estado_civil: d.estado_civil ?? "", nacionalidad: d.nacionalidad ?? "",
          situacion_laboral: d.situacion_laboral ?? "", ocupacion: d.ocupacion ?? "",
          empleador: d.empleador ?? "",
          antiguedad_laboral_meses: d.antiguedad_laboral_meses != null ? String(d.antiguedad_laboral_meses) : "",
          ingreso_mensual: d.ingreso_mensual != null ? numeroAInput(d.ingreso_mensual) : "",
          otros_ingresos: d.otros_ingresos != null ? numeroAInput(d.otros_ingresos) : "",
          telefono_laboral: d.telefono_laboral ?? "", direccion_laboral: d.direccion_laboral ?? "",
        });
      }
    } catch { setError("Error al cargar cliente"); }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFormData((p) => ({ ...p, [field]: e.target.value }));

  // Campos de monto (es-AR): se enmascaran en vivo y se parsean a número al enviar.
  const setMonto = (field: "ingreso_mensual" | "otros_ingresos") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData((p) => ({ ...p, [field]: maskMontoInput(e.target.value) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Los montos viajan como número (el texto enmascarado "850.000,00" rompería parseFloat en el server).
      const body = {
        ...formData,
        ingreso_mensual: formData.ingreso_mensual ? parseMontoInput(formData.ingreso_mensual) : "",
        otros_ingresos: formData.otros_ingresos ? parseMontoInput(formData.otros_ingresos) : "",
      };
      const res = await fetch(clienteId ? `/api/clientes/${clienteId}` : "/api/clientes", {
        method: clienteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) onClose(true, json.data as ClienteCreado);
      else setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Datos personales */}
      <section>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Datos personales</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre completo" required className="col-span-2">
            <Input name="nombre" type="text" placeholder="Ej: Juan Rodríguez" value={formData.nombre} onChange={set("nombre")} required autoFocus />
          </Field>
          <Field label="DNI / Documento">
            <Input name="documento" type="text" inputMode="numeric" placeholder="Ej: 36049884" value={formData.documento} onChange={set("documento")} />
          </Field>
          <Field label="CUIT / CUIL">
            <Input name="cuit_cuil" type="text" placeholder="Ej: 20-36049884-3" value={formData.cuit_cuil} onChange={set("cuit_cuil")} />
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
        </div>
      </section>

      {/* Situación laboral */}
      <section>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Situación laboral</p>
        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Antigüedad (meses)">
            <Input name="antiguedad_laboral_meses" type="number" min="0" step="1" placeholder="Ej: 24" value={formData.antiguedad_laboral_meses} onChange={set("antiguedad_laboral_meses")} />
          </Field>
          <Field label="Ocupación / Puesto">
            <Input name="ocupacion" type="text" placeholder="Ej: Comerciante" value={formData.ocupacion} onChange={set("ocupacion")} />
          </Field>
          <Field label="Empleador">
            <Input name="empleador" type="text" placeholder="Ej: Empresa S.A." value={formData.empleador} onChange={set("empleador")} />
          </Field>
        </div>
      </section>

      {/* Ingresos */}
      <section>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Ingresos / capacidad de pago</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ingreso mensual ($)">
            <Input name="ingreso_mensual" type="text" inputMode="decimal" placeholder="850.000,00" value={formData.ingreso_mensual} onChange={setMonto("ingreso_mensual")} className="text-right font-mono tabular-nums" />
          </Field>
          <Field label="Otros ingresos ($)">
            <Input name="otros_ingresos" type="text" inputMode="decimal" placeholder="150.000,00" value={formData.otros_ingresos} onChange={setMonto("otros_ingresos")} className="text-right font-mono tabular-nums" />
          </Field>
        </div>
      </section>

      {/* Contacto */}
      <section>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Contacto</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input name="email" type="email" placeholder="ejemplo@correo.com" value={formData.email} onChange={set("email")} />
          </Field>
          <Field label="Teléfono / WhatsApp">
            <Input name="telefono" type="tel" placeholder="Ej: 3814123693" value={formData.telefono} onChange={set("telefono")} />
          </Field>
          <Field label="Teléfono laboral">
            <Input name="telefono_laboral" type="tel" placeholder="Ej: 3814555000" value={formData.telefono_laboral} onChange={set("telefono_laboral")} />
          </Field>
          <Field label="Dirección laboral">
            <Input name="direccion_laboral" type="text" placeholder="Calle y número" value={formData.direccion_laboral} onChange={set("direccion_laboral")} />
          </Field>
        </div>
      </section>

      {/* Acciones */}
      <div className="flex gap-2 justify-end pt-3 border-t border-border sticky bottom-0 bg-card">
        <button
          type="button" onClick={() => onClose(false)}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit" disabled={loading}
          className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Guardando..." : clienteId ? "Actualizar cliente" : "Crear cliente"}
        </button>
      </div>
    </form>
  );
}
