"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/field";

export interface DomicilioValue {
  provincia?: string | null;
  localidad?: string | null;
  direccion?: string | null;
  codigo_postal?: string | null;
  tipo_domicilio?: string | null;
  piso?: string | null;
  depto?: string | null;
}

/**
 * Domicilio estructurado con georef AR: Provincia → Localidad encadenadas (proxy `/api/georef`,
 * gratis, server-side), + Dirección, CP, tipo (casa/departamento) y Piso/Depto (si es depto).
 * Componente controlado y reutilizable (clientes, financiera, etc.).
 */
export function DomicilioFields({
  value,
  onChange,
}: {
  value: DomicilioValue;
  onChange: (patch: Partial<DomicilioValue>) => void;
}) {
  const [provincias, setProvincias] = useState<{ id: string; nombre: string }[]>([]);
  const [localidades, setLocalidades] = useState<{ id: string; nombre: string }[]>([]);
  const [loadingLoc, setLoadingLoc] = useState(false);

  // Provincias una sola vez al montar.
  useEffect(() => {
    fetch("/api/georef?recurso=provincias")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setProvincias(j.data.items); })
      .catch(() => {});
  }, []);

  // Localidades: se cargan cada vez que cambia la provincia (incluye el modo edición al montar).
  const prov = value.provincia ?? "";
  useEffect(() => {
    if (!prov) { setLocalidades([]); return; }
    let vivo = true;
    setLoadingLoc(true);
    fetch(`/api/georef?recurso=localidades&provincia=${encodeURIComponent(prov)}`)
      .then((r) => r.json())
      .then((j) => { if (vivo) setLocalidades(j.ok ? j.data.items : []); })
      .catch(() => { if (vivo) setLocalidades([]); })
      .finally(() => { if (vivo) setLoadingLoc(false); });
    return () => { vivo = false; };
  }, [prov]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Provincia">
        <Select value={value.provincia ?? ""} onChange={(e) => onChange({ provincia: e.target.value, localidad: "" })}>
          <option value="">Seleccioná…</option>
          {provincias.map((p) => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
        </Select>
      </Field>
      <Field
        label="Localidad"
        hint={loadingLoc ? "Cargando localidades…" : (!value.provincia ? "Elegí primero la provincia" : undefined)}
      >
        <Select value={value.localidad ?? ""} onChange={(e) => onChange({ localidad: e.target.value })} disabled={!value.provincia || loadingLoc}>
          <option value="">Seleccioná…</option>
          {localidades.map((l) => <option key={l.id} value={l.nombre}>{l.nombre}</option>)}
        </Select>
      </Field>
      <Field label="Dirección" hint="Calle y número">
        <Input type="text" placeholder="Ej: San Martín 1234" value={value.direccion ?? ""} onChange={(e) => onChange({ direccion: e.target.value })} />
      </Field>
      <Field label="Código postal">
        <Input type="text" inputMode="numeric" placeholder="Ej: 4000" value={value.codigo_postal ?? ""} onChange={(e) => onChange({ codigo_postal: e.target.value })} className="font-mono tabular-nums" />
      </Field>
      <Field label="Tipo de domicilio">
        <Select value={value.tipo_domicilio ?? ""} onChange={(e) => onChange({ tipo_domicilio: e.target.value })}>
          <option value="">Sin especificar</option>
          <option value="casa">Casa</option>
          <option value="departamento">Departamento</option>
        </Select>
      </Field>
      {value.tipo_domicilio === "departamento" && (
        <>
          <Field label="Piso">
            <Input type="text" inputMode="numeric" placeholder="Ej: 3" value={value.piso ?? ""} onChange={(e) => onChange({ piso: e.target.value })} className="text-center font-mono tabular-nums" />
          </Field>
          <Field label="Departamento" hint="Letra o número de la unidad (ej. C)">
            <Input type="text" placeholder="Ej: C" value={value.depto ?? ""} onChange={(e) => onChange({ depto: e.target.value })} className="text-center uppercase" />
          </Field>
        </>
      )}
    </div>
  );
}
