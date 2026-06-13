"use client";

import { useState, useEffect } from "react";
import { Field, Input } from "@/components/ui/field";

interface ClienteFormProps {
  clienteId?: string | null;
  onClose: (success?: boolean) => void;
}

export function ClienteForm({ clienteId, onClose }: ClienteFormProps) {
  const [formData, setFormData] = useState({
    nombre: "", documento: "", email: "", telefono: "", direccion: "",
  });
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
        const { nombre, documento, email, telefono, direccion } = json.data;
        setFormData({ nombre, documento: documento || "", email: email || "", telefono: telefono || "", direccion: direccion || "" });
      }
    } catch { setError("Error al cargar cliente"); }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(clienteId ? `/api/clientes/${clienteId}` : "/api/clientes", {
        method: clienteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const json = await res.json();
      if (json.ok) onClose(true);
      else setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Sección: Datos personales */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Datos personales
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre completo" required className="col-span-2">
            <Input
              name="nombre" type="text" placeholder="Ej: Juan Rodríguez"
              value={formData.nombre} onChange={set("nombre")} required autoFocus
            />
          </Field>
          <Field label="DNI / CUIT / Documento">
            <Input
              name="documento" type="text" placeholder="Ej: 36049884"
              value={formData.documento} onChange={set("documento")}
            />
          </Field>
          <Field label="Dirección">
            <Input
              name="direccion" type="text" placeholder="Calle y número"
              value={formData.direccion} onChange={set("direccion")}
            />
          </Field>
        </div>
      </div>

      {/* Sección: Contacto */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Contacto
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input
              name="email" type="email" placeholder="ejemplo@correo.com"
              value={formData.email} onChange={set("email")}
            />
          </Field>
          <Field label="Teléfono / WhatsApp">
            <Input
              name="telefono" type="tel" placeholder="Ej: 3814123693"
              value={formData.telefono} onChange={set("telefono")}
            />
          </Field>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex gap-2 justify-end pt-1 border-t border-border">
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
