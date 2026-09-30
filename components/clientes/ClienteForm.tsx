"use client";

import { useState, useEffect, useRef } from "react";
import { Check, Circle } from "lucide-react";
import { IconBadge } from "@/components/ui/IconBadge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Emoji } from "@/components/ui/Emoji";
import { FormActions, SIN_CIERRE_ACCIDENTAL } from "@/components/ui/form-kit";
import { Field, Input, Select } from "@/components/ui/field";
import { maskMontoInput, parseMontoInput, numeroAInput, nombreCompleto, formatCuit } from "@/lib/utils";
import { normalizarEstadoCliente } from "@/lib/domain";
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
  provincia: "", localidad: "", codigo_postal: "", tipo_domicilio: "", piso: "", depto: "",
  situacion_laboral: "", ocupacion: "", empleador: "",
  ingreso_mensual: "", otros_ingresos: "",
  telefono_laboral: "", direccion_laboral: "",
  consentimiento_bureau: false,
};

/** Edad (años cumplidos) a partir de la fecha de nacimiento (yyyy-mm-dd). null si no es válida. */
function edadDesde(fechaISO: string): number | null {
  if (!fechaISO) return null;
  const d = new Date(fechaISO);
  if (isNaN(d.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - d.getFullYear();
  const m = hoy.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < d.getDate())) edad--;
  return edad >= 0 && edad < 130 ? edad : null;
}

// Validaciones de formato.
const RE = {
  dni:   /^\d{7,8}$/,                     // DNI argentino: 7 u 8 dígitos
  cuit:  /^\d{2}-?\d{8}-?\d$/,            // CUIT/CUIL: 11 dígitos (guiones opcionales)
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  tel:   /^\d{10}$/,                     // teléfono AR: exactamente 10 dígitos
};

/** Recorta una fecha ISO a yyyy-mm-dd para el input date. */
function toDateInput(s?: string | null) {
  return s ? String(s).slice(0, 10) : "";
}

/** Solo dígitos del valor del documento (un DNI nunca lleva letras ni espacios). */
function soloDigitos(v: string, max: number) {
  return v.replace(/\D/g, "").slice(0, max);
}

/** Bloque del formulario: el mismo encabezado (IconBadge + título) que los paneles del SaaS. */
function SectionCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  // Franja de título propia y cuerpo compacto: el bloque se lee como una tarjeta con nombre,
  // no como un recuadro vacío con campos adentro (Fernando, 30/09/2026: "muy plano").
  return (
    <section className="group overflow-hidden rounded-xl border border-border bg-card/70 shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-border/70 bg-gradient-to-r from-muted/40 to-transparent px-4 py-2.5">
        <IconBadge emoji={icon} hoverable />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
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
  const [dniDup, setDniDup] = useState<{ nombre: string; estado?: string | null } | null>(null);  // otro cliente con ese DNI
  const [cuitDup, setCuitDup] = useState<{ nombre: string } | null>(null); // otro cliente con ese CUIT
  // Control anti-fraude del sueldo (viene del GET, rol-aware).
  const [sueldoControl, setSueldoControl] = useState<{ ediciones: number; max: number; esAdmin: boolean; puedeEditar: boolean } | null>(null);
  const [sueldoOriginal, setSueldoOriginal] = useState(""); // valor cargado, para detectar el cambio
  const [motivoSueldo, setMotivoSueldo] = useState("");
  // Cliente migrado (cartera vieja): datos incompletos por diseño → no exigir DNI/sueldo para
  // poder completarlos de a poco. El sueldo lo pedirá igual el motor de riesgo al dar un crédito.
  const [migrado, setMigrado] = useState(false);
  const [reseteando, setReseteando] = useState(false);
  // El aviso de error vive arriba; el modal scrollea, así que al fallar se lo trae a la vista.
  const errorRef = useRef<HTMLDivElement>(null);
  const mostrarError = () => requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const confirm = useConfirm();
  const toast = useToast();
  // El consentimiento de bureau solo aplica al plan Pro (verificación externa).
  const tieneRiesgo = useHasFeature("bureau_credito");

  // Domicilio: provincias/localidades desde el proxy georef (server-side, gratis).
  const [provincias, setProvincias] = useState<{ id: string; nombre: string }[]>([]);
  const [localidades, setLocalidades] = useState<{ id: string; nombre: string }[]>([]);
  const [loadingLoc, setLoadingLoc] = useState(false);

  const cargarLocalidades = async (prov: string) => {
    if (!prov) { setLocalidades([]); return; }
    setLoadingLoc(true);
    try {
      const r = await fetch(`/api/georef?recurso=localidades&provincia=${encodeURIComponent(prov)}`);
      const j = await r.json();
      setLocalidades(j.ok ? j.data.items : []);
    } catch { setLocalidades([]); }
    finally { setLoadingLoc(false); }
  };

  // Provincias una sola vez al montar.
  useEffect(() => {
    fetch("/api/georef?recurso=provincias")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setProvincias(j.data.items); })
      .catch(() => {});
  }, []);

  // Al elegir provincia: se recargan las localidades y se resetea la localidad elegida.
  const setProvincia = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const prov = e.target.value;
    setFormData((p) => ({ ...p, provincia: prov, localidad: "" }));
    cargarLocalidades(prov);
  };

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

  /**
   * El aviso de DNI repetido, con el ESTADO del homónimo.
   *
   * 🔴 Decía solo "ya existe un cliente con este DNI: Carla". Pero si Carla está fallecida
   * no aparece en el simulador, así que el operador la busca para otorgarle, no la
   * encuentra, concluye que no está cargada y va a crearla — y recién ahí choca con este
   * aviso, que no le explica nada. El estado tiene que estar acá, en el primer cartel.
   */
  const estadoDup = normalizarEstadoCliente(dniDup?.estado);
  const avisoDni = !necesitaCuit ? undefined
    : estadoDup === "fallecido"
      ? `${dniDup!.nombre} tiene este DNI y figura como FALLECIDA/O: por eso no aparece al otorgar un crédito. Si es otra persona con el mismo DNI, cargá el CUIL para diferenciarla.`
    : estadoDup === "inactivo"
      ? `${dniDup!.nombre} tiene este DNI y está dado de baja: por eso no aparece al otorgar un crédito. Reactivalo desde Clientes, o cargá el CUIL si es otra persona.`
      : `Ya existe un cliente con este DNI: ${dniDup!.nombre}. Si es OTRA persona, cargá el CUIL para diferenciarla.`;
  const bloqueadoDup = !!cuitDup || necesitaCuit;

  const fetchCliente = async () => {
    try {
      const res = await fetch(`/api/clientes/${clienteId}`);
      const json = await res.json();
      if (json.ok) {
        const d = json.data;
        setFormData({
          nombre: d.nombre ?? "", apellido: d.apellido ?? "", documento: d.documento ?? "", email: d.email ?? "",
          telefono: d.telefono ?? "", direccion: d.direccion ?? "", zona: d.zona ?? "",
          fecha_nacimiento: toDateInput(d.fecha_nacimiento), cuit_cuil: d.cuit_cuil ?? "",
          estado_civil: d.estado_civil ?? "", nacionalidad: d.nacionalidad ?? "",
          provincia: d.provincia ?? "", localidad: d.localidad ?? "", codigo_postal: d.codigo_postal ?? "",
          tipo_domicilio: d.tipo_domicilio ?? "", piso: d.piso ?? "", depto: d.depto ?? "",
          situacion_laboral: d.situacion_laboral ?? "", ocupacion: d.ocupacion ?? "",
          empleador: d.empleador ?? "",
          ingreso_mensual: d.ingreso_mensual != null ? numeroAInput(d.ingreso_mensual) : "",
          otros_ingresos: d.otros_ingresos != null ? numeroAInput(d.otros_ingresos) : "",
          telefono_laboral: d.telefono_laboral ?? "", direccion_laboral: d.direccion_laboral ?? "",
          consentimiento_bureau: (d as { consentimiento_bureau?: boolean }).consentimiento_bureau ?? false,
        });
        if (d.provincia) cargarLocalidades(d.provincia); // poblar el select de localidades
        setSueldoControl(d.sueldo_control ?? null);
        setSueldoOriginal(d.ingreso_mensual != null ? numeroAInput(d.ingreso_mensual) : "");
        setMigrado((d as { migrado?: boolean }).migrado === true);
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

  // Teléfonos: SOLO dígitos, 10 (formato AR), en vivo.
  const setTel = (field: "telefono" | "telefono_laboral") => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((p) => ({ ...p, [field]: soloDigitos(e.target.value, 10) }));
    clearError(field);
  };

  // CUIT/CUIL: solo dígitos, formateado en vivo a 20-36049884-3.
  const setCuit = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((p) => ({ ...p, cuit_cuil: formatCuit(e.target.value) }));
    clearError("cuit_cuil");
  };

  // Email: feedback inmediato de formato al salir del campo.
  const blurEmail = () => {
    if (formData.email.trim() && !RE.email.test(formData.email.trim())) {
      setErrors((p) => ({ ...p, email: "Email inválido (ej. nombre@correo.com)" }));
    }
  };

  // Campos de monto (es-AR): se enmascaran en vivo y se parsean a número al enviar.
  const setMonto = (field: "ingreso_mensual" | "otros_ingresos") => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((p) => ({ ...p, [field]: maskMontoInput(e.target.value) }));
    clearError(field);
  };

  /** Valida los campos. Devuelve el mapa de errores (vacío si todo OK). */
  const validar = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!formData.nombre.trim()) e.nombre = "Ingresá el nombre";
    if (!formData.apellido.trim()) e.apellido = "Ingresá el apellido";
    const dni = formData.documento.trim();
    // DNI: obligatorio salvo en clientes migrados (se completan de a poco). Si se carga, se valida el formato.
    if (!dni) { if (!migrado) e.documento = "El DNI es obligatorio"; }
    else if (!RE.dni.test(dni)) e.documento = "DNI inválido (7 u 8 dígitos)";
    if (formData.cuit_cuil.trim() && !RE.cuit.test(formData.cuit_cuil.trim())) e.cuit_cuil = "CUIT/CUIL inválido (11 dígitos)";
    if (formData.email.trim() && !RE.email.test(formData.email.trim())) e.email = "Email inválido";
    if (formData.telefono.trim() && !RE.tel.test(formData.telefono.trim())) e.telefono = "Debe tener 10 dígitos";
    if (formData.telefono_laboral.trim() && !RE.tel.test(formData.telefono_laboral.trim())) e.telefono_laboral = "Debe tener 10 dígitos";
    // El ingreso es OBLIGATORIO (variable central del motor) — salvo en clientes migrados, que
    // se completan progresivamente. El motor de riesgo lo exige igual al otorgar un crédito.
    if (!migrado && (!formData.ingreso_mensual.trim() || parseMontoInput(formData.ingreso_mensual) <= 0))
      e.ingreso_mensual = "El ingreso es obligatorio (variable clave del motor financiero)";
    return e;
  };

  // Reseteo del contador de ediciones del sueldo (solo admin; el backend lo hace cumplir).
  const resetearContador = async () => {
    if (!clienteId || reseteando) return;
    setReseteando(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/reset-ingreso`, { method: "POST" });
      if (res.ok) {
        setSueldoControl((c) => (c ? { ...c, ediciones: 0, puedeEditar: true } : c));
        toast.success("Contador de ediciones del sueldo reseteado");
      } else {
        toast.error("No se pudo resetear el contador");
      }
    } catch {
      toast.error("Error de red al resetear");
    } finally {
      setReseteando(false);
    }
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (cuitDup) { setError(`Ya existe un cliente con el CUIT ${formData.cuit_cuil.trim()}: ${cuitDup.nombre}.`); mostrarError(); return; }
    if (necesitaCuit) { setError(avisoDni!); mostrarError(); return; }
    const errs = validar();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // Aviso VISIBLE + scroll al tope: antes el error del campo quedaba fuera de la vista y
      // parecía que "no hacía nada" al guardar.
      const primero = Object.values(errs)[0];
      setError(`No se pudo guardar. Revisá los campos en rojo${primero ? `: ${primero}` : "."}`);
      mostrarError();
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
      const { apellido, ...rest } = formData;

      // Los montos viajan como número (el texto enmascarado "850.000,00" rompería parseFloat en el server).
      const body = {
        ...rest,
        // Modelo normalizado: nombre y apellido viajan en columnas separadas.
        nombre: formData.nombre.trim(),
        apellido: apellido.trim(),
        ingreso_mensual: formData.ingreso_mensual ? parseMontoInput(formData.ingreso_mensual) : "",
        otros_ingresos: formData.otros_ingresos ? parseMontoInput(formData.otros_ingresos) : "",
        // Motivo del cambio de sueldo (lo exige el backend si el salto supera el % configurado).
        ...(clienteId && formData.ingreso_mensual !== sueldoOriginal ? { motivo_sueldo: motivoSueldo.trim() } : {}),
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
      } else {
        // El banner vive arriba del form (a veces fuera de vista); el toast lo hace siempre visible.
        setError(json.error);
        toast.error(json.error ?? "No se pudo guardar");
        // Si faltó el motivo del salto de sueldo, resaltar ese campo.
        if (json.code === "MOTIVO_SUELDO_REQUERIDO") setErrors((p) => ({ ...p, motivo_sueldo: json.error }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Clase de borde rojo para inputs con error.
  const errCls = (field: string) => errors[field] ? "border-destructive focus:border-destructive focus:ring-destructive/20" : "";
  const edad = edadDesde(formData.fecha_nacimiento);
  // Estado del candado del sueldo (para bloquear el campo / pedir motivo).
  const sueldoCambiado = !!clienteId && formData.ingreso_mensual !== sueldoOriginal;
  const sueldoBloqueado = !!sueldoControl && !sueldoControl.puedeEditar;
  const edicionesRestantes = sueldoControl && sueldoControl.max > 0 ? sueldoControl.max - sueldoControl.ediciones : null;

  /*
    Los obligatorios, a la vista (Fernando, 28/09/2026): el formulario tiene cinco secciones
    y solo cuatro campos frenan el alta. La tira de arriba dice cuáles faltan y lleva a cada
    uno de un clic. En un migrado solo nombre y apellido son obligatorios (validar()).
  */
  const obligatorios = [
    { campo: "nombre", label: "Nombre", ok: !!formData.nombre.trim() },
    { campo: "apellido", label: "Apellido", ok: !!formData.apellido.trim() },
    ...(migrado ? [] : [
      { campo: "documento", label: "DNI", ok: RE.dni.test(formData.documento.trim()) },
      { campo: "ingreso_mensual", label: "Ingreso mensual", ok: parseMontoInput(formData.ingreso_mensual || "0") > 0 },
    ]),
  ];
  const completos = obligatorios.filter((o) => o.ok).length;
  const irAlCampo = (campo: string) => {
    const el = document.getElementsByName(campo)[0] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      {/*
        ENCABEZADO DEL FORMULARIO (Fernando, 30/09/2026: "muy plano, muchos espacios vacíos").
        El título y el avance de lo obligatorio en una sola banda con el color de la marca:
        cuánto falta se ve con una barra, y cada dato que falta es un atajo a su campo.
      */}
      <div className="-mx-6 -mt-6 border-b border-border bg-gradient-to-br from-primary/[0.14] via-primary/[0.04] to-transparent px-6 pb-4 pt-6 sm:-mx-7 sm:-mt-7 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pr-10">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-inset ring-primary/25">
              <Emoji name="bust-in-silhouette" className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-xl font-bold tracking-tight text-foreground">{clienteId ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
              <p className="text-sm text-muted-foreground">{clienteId ? "Actualizá la ficha del cliente." : "Cargá los datos del nuevo cliente."}</p>
            </div>
          </div>
          <div className="w-full space-y-2 lg:w-auto lg:min-w-[26rem]">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                Obligatorios{migrado && <span className="ml-2 normal-case tracking-normal text-muted-foreground/80">· cliente migrado</span>}
              </span>
              <span className={`font-mono font-semibold tabular-nums ${completos === obligatorios.length ? "text-success" : "text-foreground"}`}>{completos} de {obligatorios.length}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
              <div className={`h-full rounded-full transition-all duration-300 ${completos === obligatorios.length ? "bg-success" : "bg-primary"}`} style={{ width: `${(completos / obligatorios.length) * 100}%` }} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {obligatorios.map((o) => (
                <button
                  key={o.campo}
                  type="button"
                  onClick={() => irAlCampo(o.campo)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    o.ok
                      ? "bg-success/10 text-success ring-1 ring-inset ring-success/25"
                      : errors[o.campo]
                        ? "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/30 hover:bg-destructive/15"
                        : "bg-card/80 text-muted-foreground ring-1 ring-inset ring-border hover:text-foreground"
                  }`}
                >
                  {o.ok ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div ref={errorRef} className="scroll-mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/*
        Dos columnas en pantallas anchas (Fernando, 28/09/2026: "más tamaño"). A la izquierda
        la persona, sus ingresos y cómo contactarla; a la derecha, dónde vive y dónde trabaja.
        Son dos pilas independientes, así una sección alta no deja huecos en la otra columna.
      */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="space-y-3.5">
          {/* Datos personales */}
          <SectionCard icon="bust-in-silhouette" title="Datos personales">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                required={!migrado}
                error={errors.documento || avisoDni}
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
              <Field label="Fecha de nacimiento" hint={edad != null ? `${edad} años` : undefined}>
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
            </div>
          </SectionCard>

          {/* Ingresos */}
          <SectionCard icon="money-bag" title="Ingresos / capacidad de pago">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Ingreso mensual"
                required={!migrado}
                error={errors.ingreso_mensual || (sueldoBloqueado ? "Límite de ediciones alcanzado — un admin debe resetear el contador" : undefined)}
                hint={sueldoBloqueado ? undefined : (edicionesRestantes != null && !sueldoControl?.esAdmin ? `Te quedan ${edicionesRestantes} edición${edicionesRestantes === 1 ? "" : "es"} del sueldo` : undefined)}
              >
                <ConPesos>
                  <Input
                    name="ingreso_mensual" type="text" inputMode="decimal" placeholder="850.000,00"
                    value={formData.ingreso_mensual} onChange={setMonto("ingreso_mensual")} readOnly={sueldoBloqueado}
                    className={`pl-8 text-right font-mono tabular-nums ${errCls("ingreso_mensual")} ${sueldoBloqueado ? "cursor-not-allowed opacity-60" : ""}`}
                  />
                </ConPesos>
              </Field>
              <Field label="Otros ingresos">
                <ConPesos>
                  <Input name="otros_ingresos" type="text" inputMode="decimal" placeholder="150.000,00" value={formData.otros_ingresos} onChange={setMonto("otros_ingresos")} className="pl-8 text-right font-mono tabular-nums" />
                </ConPesos>
              </Field>
            </div>

            {/* Panel admin: contador de ediciones del sueldo + reseteo (anti-fraude del vendedor) */}
            {sueldoControl?.esAdmin && sueldoControl.max > 0 && sueldoControl.ediciones > 0 && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Ediciones del sueldo por vendedores: <span className="font-mono font-semibold text-foreground">{sueldoControl.ediciones}/{sueldoControl.max}</span>
                </p>
                <button
                  type="button" onClick={resetearContador} disabled={reseteando}
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {reseteando ? "Reseteando…" : "Resetear contador"}
                </button>
              </div>
            )}

            {/* Motivo del cambio de sueldo: aparece al editar el ingreso (requerido si el salto es grande) */}
            {sueldoCambiado && !sueldoBloqueado && (
              <div className="mt-3">
                <Field label="Motivo del cambio de sueldo" error={errors.motivo_sueldo} hint="Requerido si el aumento supera el % configurado. Queda auditado.">
                  <Input name="motivo_sueldo" type="text" placeholder="Ej: actualización por recibo de sueldo nuevo"
                    value={motivoSueldo}
                    onChange={(e) => { setMotivoSueldo(e.target.value); clearError("motivo_sueldo"); }}
                    className={errCls("motivo_sueldo")} />
                </Field>
              </div>
            )}
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
                  <span className="block text-[11px] text-muted-foreground">Ley 25.326 (habeas data)</span>
                </span>
              </label>
            )}
          </SectionCard>

          {/* Contacto: en la columna de la persona (lo que usa Cobranzas todos los días) */}
          <SectionCard icon="mobile-phone" title="Contacto">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Teléfono / WhatsApp" error={errors.telefono} hint="10 dígitos, con característica">
                <Input name="telefono" type="tel" inputMode="tel" placeholder="Ej: 3814123693" value={formData.telefono}
                  onChange={setTel("telefono")} className={cnMono(errCls("telefono"))} />
              </Field>
              <Field label="Email" error={errors.email}>
                <Input name="email" type="email" placeholder="ejemplo@correo.com" value={formData.email}
                  onChange={set("email")} onBlur={blurEmail} className={errCls("email")} />
              </Field>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-3.5">
          {/* Domicilio (georef AR: provincia→localidad; CP manual) */}
          <SectionCard icon="house" title="Domicilio">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Provincia">
                <Select name="provincia" value={formData.provincia} onChange={setProvincia}>
                  <option value="">Seleccioná…</option>
                  {provincias.map((p) => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
                </Select>
              </Field>
              <Field label="Localidad" hint={loadingLoc ? "Cargando localidades…" : undefined}>
                <Select name="localidad" value={formData.localidad} onChange={set("localidad")} disabled={!formData.provincia || loadingLoc}>
                  <option value="">{formData.provincia ? "Seleccioná…" : "Elegí la provincia"}</option>
                  {localidades.map((l) => <option key={l.id} value={l.nombre}>{l.nombre}</option>)}
                </Select>
              </Field>
              <Field label="Dirección" hint="Calle y número">
                <Input name="direccion" type="text" placeholder="Ej: San Martín 1234" value={formData.direccion} onChange={set("direccion")} />
              </Field>
              <Field label="Código postal">
                <Input name="codigo_postal" type="text" inputMode="numeric" placeholder="Ej: 4000" value={formData.codigo_postal} onChange={set("codigo_postal")} className="font-mono tabular-nums" />
              </Field>
              <Field label="Tipo de domicilio">
                <Select name="tipo_domicilio" value={formData.tipo_domicilio} onChange={set("tipo_domicilio")}>
                  <option value="">Sin especificar</option>
                  <option value="casa">Casa</option>
                  <option value="departamento">Departamento</option>
                </Select>
              </Field>
              {/* Vacía, el sistema la completa con el barrio del domicilio y recuerda lo que se
                  escriba acá para los próximos clientes del mismo barrio. */}
              <Field label="Zona de cobranza" hint="Vacía: la completa el mapa">
                <Input name="zona" type="text" placeholder="Ej: Centro" value={formData.zona} onChange={set("zona")} />
              </Field>
              {formData.tipo_domicilio === "departamento" && (
                <>
                  <Field label="Piso">
                    <Input name="piso" type="text" inputMode="numeric" placeholder="Ej: 3" value={formData.piso} onChange={set("piso")} className="text-center font-mono tabular-nums" />
                  </Field>
                  <Field label="Departamento">
                    <Input name="depto" type="text" placeholder="Ej: C" value={formData.depto} onChange={set("depto")} className="text-center uppercase" />
                  </Field>
                </>
              )}
            </div>
          </SectionCard>

          {/* Situación laboral (con los datos de contacto del trabajo) */}
          <SectionCard icon="briefcase" title="Situación laboral">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <Field label="Ocupación / Puesto">
                <Input name="ocupacion" type="text" placeholder="Ej: Comerciante" value={formData.ocupacion} onChange={set("ocupacion")} />
              </Field>
              <Field label="Empleador">
                <Input name="empleador" type="text" placeholder="Ej: Empresa S.A." value={formData.empleador} onChange={set("empleador")} />
              </Field>
              <Field label="Teléfono laboral" error={errors.telefono_laboral}>
                <Input name="telefono_laboral" type="tel" inputMode="tel" placeholder="Ej: 3814555000" value={formData.telefono_laboral}
                  onChange={setTel("telefono_laboral")} className={cnMono(errCls("telefono_laboral"))} />
              </Field>
              <Field label="Dirección laboral" className="sm:col-span-2">
                <Input name="direccion_laboral" type="text" placeholder="Calle y número" value={formData.direccion_laboral} onChange={set("direccion_laboral")} />
              </Field>
            </div>
          </SectionCard>
        </div>
      </div>

      <FormActions
        onCancel={() => onClose(false)}
        loading={loading}
        disabled={bloqueadoDup}
        submitLabel={clienteId ? "Guardar cambios" : "Crear cliente"}
        compacto
      />
    </form>
  );
}

/** Prefijo "$" dentro del campo de un importe. */
function ConPesos({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">$</span>
      {children}
    </div>
  );
}

/**
 * El modal de alta/edición de cliente, igual en todos lados (Clientes y el alta rápida del
 * simulador). Rediseño de Fernando (28/09/2026): más ancho, a dos columnas en pantallas
 * grandes, y NO se cierra al clickear afuera — se perdía todo lo cargado sin preguntar.
 * Quedan la X, Cancelar y Escape.
 */
export function ClienteFormDialog({
  open, clienteId, initialDocumento, onClose,
}: {
  open: boolean;
  clienteId?: string | null;
  initialDocumento?: string;
  onClose: (success?: boolean, creado?: ClienteCreado) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent
        className="w-[95vw] max-h-[92dvh] overflow-y-auto overscroll-contain sm:max-w-3xl sm:p-7 lg:max-w-[76rem]"
        {...SIN_CIERRE_ACCIDENTAL}
      >
        {/* `key`: al pasar de un cliente a otro (o a uno nuevo) el formulario arranca limpio. */}
        {open && <ClienteForm key={clienteId ?? "nuevo"} clienteId={clienteId} initialDocumento={initialDocumento} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

/** Combina el font-mono de DNI/CUIT con la clase de error. */
function cnMono(extra: string) {
  return `font-mono tabular-nums ${extra}`.trim();
}
