"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldOff, ArrowLeft, Pencil, KeyRound, UserX, UserCheck, Plus, LayoutGrid, List, Trash2 } from "lucide-react";
import { useEquipo, useUsuarios, useVendedores, type MiembroEquipo, type Usuario, type Vendedor } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { FiltrosPanel, FiltroChip } from "@/components/ui/FiltrosPanel";
import { Field, Select } from "@/components/ui/field";
import { Avatar } from "@/components/ui/Avatar";
import { MetaBar } from "@/components/ui/MetaBar";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { VendedorDetail } from "@/components/equipo/VendedorDetail";
import { PersonalForm, CrearCuentaDialog } from "@/components/equipo/AgenteForm";
import { UsuarioForm, CambiarPasswordDialog } from "@/components/equipo/CuentaForm";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { formatMonto } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/auth/roles";

/** Filtro por fecha de alta. "" = sin filtro. */
type Reciente = "" | "hoy" | "mes" | "anio";

const RECIENTE_LABEL: Record<Exclude<Reciente, "">, string> = {
  hoy: "Hoy",
  mes: "Este mes",
  anio: "Este año",
};

/** Inicio del período de "recién cargados", en hora local. */
function desdeDe(r: Exclude<Reciente, "">): number {
  const now = new Date();
  if (r === "hoy") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (r === "mes") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return new Date(now.getFullYear(), 0, 1).getTime();
}

/**
 * **Equipo** — vista unificada de las personas de la financiera.
 *
 * Reemplaza la separación entre "Usuarios" (quién puede entrar) y "Agentes" (a quién se
 * le atribuyen créditos y comisiones), que obligaba a saltar entre dos pantallas para
 * entender a una misma persona.
 *
 * Es la ÚNICA pantalla de personas: desde la etapa 3 (2026-08-01) `/personal` y `/usuarios`
 * ya no existen. Hace todo — alta de integrante (ficha + cuenta), editar cuenta, cambiar
 * contraseña, activar/desactivar acceso, dar acceso a una ficha que no lo tiene y eliminar.
 * Los diálogos viven en `AgenteForm`/`CuentaForm`: son los de las vistas viejas MOVIDOS tal
 * cual, no copias, así que el alta atómica con rollback quedó intacta.
 *
 * Se unificó la INTERFAZ, no el modelo: siguen siendo `profiles` + `vendedores` leídas
 * juntas por `GET /api/equipo`. No se tocó ningún endpoint existente.
 */
export function EquipoView() {
  const { equipo, isLoading, error, mutate } = useEquipo();
  // Los diálogos esperan objetos `Usuario` y `Vendedor` reales, así que se traen de sus
  // hooks y se busca el que corresponde por id: sin mapeos a mano que puedan divergir.
  const { usuarios, mutate: mutateUsuarios } = useUsuarios();
  const { vendedores, mutate: mutateVendedores } = useVendedores();
  const confirm = useConfirm();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [rol, setRol] = useState("");
  const [tipo, setTipo] = useState(""); // "" | agente | solo_cuenta | sin_acceso
  const [recientes, setRecientes] = useState<Reciente>(""); // alta reciente
  const [abierto, setAbierto] = useState<string | null>(null); // vendedor_id

  // Preferencia de vista (tarjetas / tabla).
  const [vista, setVista] = useState<"cards" | "tabla">("tabla");
  useEffect(() => {
    const v = localStorage.getItem("cf:equipoVista");
    if (v === "cards" || v === "tabla") setVista(v);
  }, []);
  const cambiarVista = (v: "cards" | "tabla") => { setVista(v); localStorage.setItem("cf:equipoVista", v); };

  // Diálogos
  const [formIntegrante, setFormIntegrante] = useState(false);       // alta: ficha + cuenta
  const [editandoCuenta, setEditandoCuenta] = useState<Usuario | null>(null);
  const [formCuentaAbierto, setFormCuentaAbierto] = useState(false);
  const [passwordDe, setPasswordDe] = useState<Usuario | null>(null);
  const [crearCuentaDe, setCrearCuentaDe] = useState<Vendedor | null>(null);

  /** Refresca las tres fuentes: la lista unificada y las dos de origen. */
  const refrescar = () => { mutate(); mutateUsuarios(); mutateVendedores(); };

  const usuarioDe = (m: MiembroEquipo) => usuarios.find((u) => u.id === m.profile_id) ?? null;
  const vendedorDe = (m: MiembroEquipo) => vendedores.find((v) => v.id === m.vendedor_id) ?? null;

  /** Fichas que YA tienen cuenta — el form las deshabilita (un agente = una cuenta). */
  const legajosConCuenta = useMemo(
    () => new Set(usuarios.map((u) => u.vendedor_id).filter(Boolean) as string[]),
    [usuarios]
  );

  const toggleAcceso = async (m: MiembroEquipo) => {
    const u = usuarioDe(m);
    if (!u) return;
    const ok = await confirm({
      title: u.activo ? "¿Desactivar acceso?" : "¿Reactivar acceso?",
      description: u.activo
        ? `${m.nombre} no va a poder entrar al sistema. Su ficha de agente y su historial quedan intactos.`
        : `${m.nombre} vuelve a poder entrar al sistema.`,
      confirmLabel: u.activo ? "Desactivar" : "Reactivar",
      tone: u.activo ? "danger" : "default",
    });
    if (!ok) return;
    const res = await fetch(`/api/usuarios/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !u.activo }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      toast.error(json?.error || "No se pudo actualizar el acceso");
      return;
    }
    refrescar();
    toast.success(u.activo ? `Acceso de ${m.nombre} desactivado` : `Acceso de ${m.nombre} reactivado`);
  };

  /**
   * Baja definitiva. Antes vivía partida en dos pantallas (Agentes borraba la ficha,
   * Usuarios borraba el login); acá es UNA acción que elige el endpoint según lo que
   * la persona tenga. Cuando hay ficha, manda la ficha: es la que arrastra el historial
   * (créditos, comisiones, caja), y su endpoint ya sabe borrar el login de arrastre.
   */
  const eliminarMiembro = async (m: MiembroEquipo) => {
    const u = usuarioDe(m);
    const v = vendedorDe(m);

    // Cuenta suelta, sin ficha comercial (ej. un administrativo): solo se va el acceso.
    if (!v) {
      if (!u) return;
      const ok = await confirm({
        title: "¿Eliminar usuario?",
        description: `Se eliminará DEFINITIVAMENTE el acceso de ${u.email}. Esta acción no se puede deshacer.`,
        confirmLabel: "Eliminar",
        tone: "danger",
      });
      if (!ok) return;
      const res = await fetch(`/api/usuarios/${u.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => null);
      if (!res.ok) { toast.error(j?.error || "No se pudo eliminar el usuario"); return; }
      refrescar();
      toast.success(`Usuario ${u.email} eliminado`);
      return;
    }

    const ok = await confirm({
      title: "¿Eliminar del equipo?",
      description: `Se eliminará la ficha de ${m.nombre}. Los créditos vinculados quedarán sin vendedor.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;

    // Segundo paso: el login es una capa aparte (Supabase Auth ≠ nuestras tablas).
    // Conservarlo deja el email ocupado y no se puede reutilizar para otro agente.
    let eliminarCuenta = false;
    if (v.tiene_cuenta) {
      eliminarCuenta = await confirm({
        title: "¿Eliminar también la cuenta de acceso?",
        description: `${m.nombre} tiene una cuenta de login${v.email ? ` (${v.email})` : ""}. Si la conservás, ese email quedará ocupado y no vas a poder reutilizarlo para otro agente. Si la eliminás, se borra el login por completo.`,
        confirmLabel: "Sí, eliminar el login",
        cancelLabel: "No, conservar",
        tone: "danger",
      });
    }

    const res = await fetch(`/api/vendedores/${v.id}${eliminarCuenta ? "?eliminar_cuenta=true" : ""}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      toast.error(j?.error ?? "No se pudo eliminar");
      return;
    }
    // Si estaba abierta la ficha de quien se borró, cerrarla: si no, queda pidiendo
    // datos de un id que ya no existe.
    if (abierto === v.id) setAbierto(null);
    refrescar();
    toast.success(`${m.nombre} eliminado${eliminarCuenta ? " (con su cuenta de acceso)" : ""}`);
  };

  const filtradas = useMemo(() => {
    const t = search.trim().toLowerCase();
    const desde = recientes ? desdeDe(recientes) : null;
    return equipo.filter((m) => {
      if (desde != null && !(m.created_at && new Date(m.created_at).getTime() >= desde)) return false;
      if (t && !(
        m.nombre.toLowerCase().includes(t) ||
        (m.email ?? "").toLowerCase().includes(t) ||
        (m.username ?? "").toLowerCase().includes(t) ||
        (m.zona ?? "").toLowerCase().includes(t)
      )) return false;
      if (rol && m.role !== rol) return false;
      if (tipo === "agente" && !m.vendedor_id) return false;
      if (tipo === "solo_cuenta" && m.vendedor_id) return false;
      if (tipo === "sin_acceso" && m.tiene_cuenta) return false;
      return true;
    });
  }, [equipo, search, rol, tipo, recientes]);

  const kpis = useMemo(() => ({
    total: equipo.length,
    agentes: equipo.filter((m) => m.vendedor_id).length,
    sinAcceso: equipo.filter((m) => !m.tiene_cuenta).length,
    inactivos: equipo.filter((m) => m.tiene_cuenta && !m.acceso_activo).length,
    // Plata: los MISMOS totales que hoy encabezan Agentes. Cuando esa sección se
    // apagó (etapa 3) esta pantalla es la única que responde "cuánto colocó el
    // equipo y cuánto hay que liquidar".
    vendido: equipo.reduce((s, m) => s + (m.resumen?.monto_vendido ?? 0), 0),
    comision: equipo.reduce((s, m) => s + (m.resumen?.comision_total ?? 0), 0),
  }), [equipo]);

  const filtrosActivos = (rol ? 1 : 0) + (tipo ? 1 : 0) + (recientes ? 1 : 0);
  const limpiarTodo = () => { setSearch(""); setRol(""); setTipo(""); setRecientes(""); };

  /**
   * Acciones de cuenta de una persona. Es UNA sola definición porque la usan la tabla
   * y las tarjetas: si estuviera duplicada, agregar una acción en un lado y olvidarla
   * en el otro sería cuestión de tiempo.
   */
  const accionesDe = (m: MiembroEquipo) => {
    const u = usuarioDe(m);
    const v = vendedorDe(m);
    return (
      // `stopPropagation`: la fila/tarjeta abre la ficha; estos botones no deben dispararla.
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {u ? (
          <>
            <IconBtn title="Editar cuenta" onClick={() => { setEditandoCuenta(u); setFormCuentaAbierto(true); }}>
              <Pencil className="h-3.5 w-3.5" />
            </IconBtn>
            <IconBtn title="Cambiar contraseña" onClick={() => setPasswordDe(u)}>
              <KeyRound className="h-3.5 w-3.5" />
            </IconBtn>
            <IconBtn
              title={u.activo ? "Desactivar acceso" : "Reactivar acceso"}
              onClick={() => toggleAcceso(m)}
              danger={u.activo}
            >
              {u.activo ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
            </IconBtn>
          </>
        ) : v ? (
          <button
            type="button"
            onClick={() => setCrearCuentaDe(v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <KeyRound className="h-3 w-3" /> Crear cuenta
          </button>
        ) : null}
        {/* Fuera del condicional: se puede dar de baja a cualquiera de los tres casos
            (con ficha, sin ficha o sin cuenta) y `eliminarMiembro` resuelve cuál es. */}
        <IconBtn title="Eliminar" onClick={() => eliminarMiembro(m)} danger>
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
    );
  };

  // La ficha se muestra EN LÍNEA reemplazando la lista, igual que en Agentes — no es
  // un modal. Se reusa el mismo VendedorDetail tal cual, sin tocarlo.
  if (abierto) {
    const m = equipo.find((x) => x.vendedor_id === abierto);
    return (
      <div className="space-y-6">
        {/* El título se queda en "Equipo": el header dice DÓNDE estás, no a quién
            estás mirando. El nombre va en el subtítulo — mismo criterio que Agentes.
            Cambiarlo hacía sentir que te habías ido a otra sección. */}
        <PageHeader
          icon="busts-in-silhouette"
          title="Equipo"
          subtitle={m?.nombre ? `Ficha de ${m.nombre}` : "Ficha del integrante"}
          accent="primary"
        />
        <button
          type="button"
          onClick={() => setAbierto(null)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al equipo
        </button>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <VendedorDetail vendedorId={abierto} onChanged={() => mutate()} />
        </div>
      </div>
    );
  }

  const columns: Column<MiembroEquipo>[] = [
    {
      header: "Persona",
      cell: (m) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={m.nombre} size="sm" />
          <p className="truncate text-sm font-medium text-foreground">{m.nombre}</p>
        </div>
      ),
    },
    {
      // Usuario y email en columnas propias: son dos datos distintos (con qué entra /
      // dónde se le escribe) y apilados bajo el nombre no se podían leer ni comparar.
      header: "Usuario",
      className: "hidden sm:table-cell",
      cell: (m) =>
        m.username ? (
          <span className="font-mono text-xs text-foreground">{m.username}</span>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        ),
    },
    {
      header: "Email",
      className: "hidden md:table-cell",
      cell: (m) =>
        m.email ? (
          <span className="truncate text-xs text-muted-foreground">{m.email}</span>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        ),
    },
    {
      header: "Acceso",
      cell: (m) =>
        !m.tiene_cuenta ? (
          <span className="inline-flex items-center gap-1 text-xs text-warning">
            <ShieldOff className="h-3 w-3" /> Sin cuenta
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge variant="primary" label={m.role ? ROLE_LABEL[m.role] : "sin rol"} />
            {!m.acceso_activo && <StatusBadge variant="muted" label="Inactivo" />}
          </div>
        ),
    },
    {
      header: "Créditos",
      mono: true,
      className: "hidden xl:table-cell",
      cell: (m) => (m.resumen ? String(m.resumen.creditos_otorgados) : "—"),
    },
    {
      header: "Otorgado",
      mono: true,
      className: "hidden lg:table-cell",
      cell: (m) => (m.resumen ? formatMonto(m.resumen.monto_vendido) : "—"),
    },
    {
      // El monto a liquidar, no el %. El porcentaje es un parámetro de configuración
      // que ya se ve en la ficha; lo que se mira todos los meses es la plata.
      // Es la comisión DEL PERÍODO de la meta vigente. Cuando no hay meta el número
      // pasa a ser el acumulado histórico, y eso se marca: si no, dos filas mostrarían
      // números que no se pueden comparar sin que nada lo avise.
      header: "Comisión",
      mono: true,
      className: "hidden lg:table-cell",
      cell: (m) =>
        m.resumen ? (
          <span
            className="font-semibold text-warning"
            title={m.resumen.comision_es_acumulada
              ? "Comisión acumulada (el agente no tiene meta vigente)"
              : `Comisión del período ${m.meta_periodo ?? "vigente"}`}
          >
            {formatMonto(m.resumen.comision_total, 0)}
            {m.resumen.comision_es_acumulada && (
              <span className="ml-1 font-sans text-[10px] font-normal text-muted-foreground/60">acum.</span>
            )}
          </span>
        ) : (
          "—"
        ),
    },
    {
      // `MetaBar` compartida: es la lectura de "cómo viene el equipo contra su meta",
      // que es para qué se mira esta pantalla.
      header: "Avance de meta",
      className: "hidden xl:table-cell w-44",
      cell: (m) =>
        m.vendedor_id ? (
          <MetaBar meta={m.meta_venta ?? 0} avance={m.resumen?.avance_meta ?? 0} periodo={m.meta_periodo} />
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        ),
    },
    {
      header: "Acciones",
      align: "right",
      className: "w-px whitespace-nowrap",
      cell: accionesDe,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon="busts-in-silhouette"
        title="Equipo"
        subtitle="Las personas de la financiera: su acceso al sistema y su ficha de agente"
        accent="primary"
      />

      {/* Los KPIs juntan las dos miradas que hoy están partidas: la de acceso (Usuarios)
          y la de plata (Agentes). "Requieren atención" fusiona los dos contadores de
          alerta —sin cuenta e inactivos—: por separado ocupaban media fila para mostrar
          cero casi siempre. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon="busts-in-silhouette"
          label="Personas"
          value={String(kpis.total)}
          sub={`${kpis.agentes} con ficha de agente`}
        />
        <KpiCard
          icon="dollar-banknote"
          label="Otorgado (total)"
          value={formatMonto(kpis.vendido, 0)}
          sub="acumulado del equipo"
          accent="success"
          mono
        />
        <KpiCard
          icon="bar-chart"
          label="Comisiones"
          value={formatMonto(kpis.comision, 0)}
          sub="a liquidar del período"
          accent="warning"
          mono
        />
        <KpiCard
          icon={kpis.sinAcceso + kpis.inactivos > 0 ? "warning" : "locked-with-key"}
          label="Requieren atención"
          value={String(kpis.sinAcceso + kpis.inactivos)}
          accent={kpis.sinAcceso + kpis.inactivos > 0 ? "warning" : "muted"}
          sub={
            kpis.sinAcceso + kpis.inactivos === 0
              ? "todos con acceso activo"
              : [
                  kpis.sinAcceso ? `${kpis.sinAcceso} sin cuenta` : null,
                  kpis.inactivos ? `${kpis.inactivos} con acceso inactivo` : null,
                ].filter(Boolean).join(" · ")
          }
        />
      </div>

      {/* Toolbar propia: el CTA nunca va dentro del PageHeader (regla del proyecto). */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex h-10 items-center rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => cambiarVista("cards")}
            title="Ver como tarjetas"
            aria-pressed={vista === "cards"}
            className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${vista === "cards" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/20"}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => cambiarVista("tabla")}
            title="Ver como tabla"
            aria-pressed={vista === "tabla"}
            className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${vista === "tabla" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/20"}`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
        {/* UNA sola puerta para dar de alta a cualquiera. El formulario decide qué crear
            según el "Rol de acceso" que se elija: Vendedor → ficha de agente + cuenta;
            Administrador → solo la cuenta, porque sin vender no tiene sentido una ficha
            (y creársela igual la dejaba de relleno en Comisiones, en el filtro de
            empleados del Home y en el selector de a quién entregarle plata). */}
        <button
          type="button"
          onClick={() => setFormIntegrante(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Nuevo integrante
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="sm:max-w-md sm:flex-1">
          <BuscadorF3
            value={search}
            onChange={setSearch}
            // Mismo criterio que Créditos: limpia búsqueda Y filtros, así F3 siempre
            // devuelve la lista completa y no queda como que "no hace nada".
            onF3={limpiarTodo}
            f3Hint="para limpiar la búsqueda y los filtros"
            size="md"
            placeholder="Buscar por nombre, email, usuario o zona…"
          />
        </div>
        <FiltrosPanel
          activos={filtrosActivos}
          onLimpiar={() => { setRol(""); setTipo(""); setRecientes(""); }}
          align="right"
          chips={
            <>
              {rol && <FiltroChip onClear={() => setRol("")}>Rol: {ROLE_LABEL[rol as keyof typeof ROLE_LABEL]}</FiltroChip>}
              {tipo && (
                <FiltroChip onClear={() => setTipo("")}>
                  {tipo === "agente" ? "Con ficha" : tipo === "solo_cuenta" ? "Sin ficha" : "Sin cuenta"}
                </FiltroChip>
              )}
              {recientes && (
                <FiltroChip onClear={() => setRecientes("")}>Alta: {RECIENTE_LABEL[recientes]}</FiltroChip>
              )}
            </>
          }
        >
          <Field label="Rol de acceso">
            <Select value={rol} onChange={(e) => setRol(e.target.value)}>
              <option value="">Todos</option>
              <option value="admin">Administrador</option>
              <option value="vendedor">Vendedor</option>
              {/* "Cobrador" NO se ofrece: el rol está deprecado, no se puede crear
                  ninguno y filtrar por él solo devolvía una lista vacía. */}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="agente">Con ficha de agente</option>
              <option value="solo_cuenta">Solo cuenta (no vende)</option>
              <option value="sin_acceso">Sin cuenta de acceso</option>
            </Select>
          </Field>
          {/* "Recién cargados" de Agentes, acá como un filtro más del panel estándar
              (en Agentes era una barra aparte, contra la convención del SaaS). */}
          <Field label="Recién cargados">
            <Select value={recientes} onChange={(e) => setRecientes(e.target.value as Reciente)}>
              <option value="">Cualquier fecha de alta</option>
              <option value="hoy">Hoy</option>
              <option value="mes">Este mes</option>
              <option value="anio">Este año</option>
            </Select>
          </Field>
        </FiltrosPanel>
      </div>

      {vista === "cards" ? (
        <EquipoCards
          filas={filtradas}
          loading={isLoading}
          error={!!error}
          filtrado={!!(search || filtrosActivos)}
          onAbrir={(m) => { if (m.vendedor_id) setAbierto(m.vendedor_id); }}
          acciones={accionesDe}
        />
      ) : (
        <DataTable<MiembroEquipo>
          columns={columns}
          rows={filtradas}
          rowKey={(m) => m.key}
          loading={isLoading}
          error={error ? "No se pudo cargar el equipo" : undefined}
          pageSize={12}
          onRowClick={(m) => { if (m.vendedor_id) setAbierto(m.vendedor_id); }}
          empty={{
            icon: "busts-in-silhouette",
            title: "Sin personas para mostrar",
            hint: search || filtrosActivos ? "Probá quitando filtros o la búsqueda." : "Todavía no hay nadie cargado.",
          }}
        />
      )}

      {/* ── Diálogos: los MISMOS de Usuarios y Agentes, importados ─────────────
          No son copias. Cualquier arreglo en ellos vale para las tres pantallas, y
          el alta atómica (cuenta de Auth + profile + legajo, con rollback) queda
          intacta — es el código más delicado de esta zona y no se reescribió. */}

      {/* Alta de integrante: crea el legajo Y su cuenta de acceso en un solo paso. */}
      <PersonalForm
        open={formIntegrante}
        vendedor={null}
        onClose={(ok) => { setFormIntegrante(false); if (ok) refrescar(); }}
      />

      {/* Editar / crear cuenta de acceso suelta (sin legajo, ej. un administrativo). */}
      <UsuarioForm
        open={formCuentaAbierto}
        usuario={editandoCuenta}
        linkedVendedorIds={legajosConCuenta}
        onClose={(ok) => { setFormCuentaAbierto(false); setEditandoCuenta(null); if (ok) refrescar(); }}
      />

      <CambiarPasswordDialog usuario={passwordDe} onClose={() => setPasswordDe(null)} />

      {/* Dar acceso a un legajo que todavía no lo tiene. */}
      <CrearCuentaDialog
        vendedor={crearCuentaDe}
        onClose={(ok) => { setCrearCuentaDe(null); if (ok) refrescar(); }}
      />
    </div>
  );
}

/**
 * Vista de TARJETAS del equipo. Misma información que la tabla, en una grilla que
 * respira: sirve cuando se quiere mirar a las personas de a una (rendimiento y meta
 * a la vista) en vez de comparar filas.
 *
 * Las acciones NO se redefinen acá: llegan por `acciones`, la misma función que usa
 * la tabla.
 */
function EquipoCards({
  filas, loading, error, filtrado, onAbrir, acciones,
}: {
  filas: MiembroEquipo[];
  loading: boolean;
  error: boolean;
  /** true si hay búsqueda o filtros activos (cambia el texto del estado vacío). */
  filtrado: boolean;
  onAbrir: (m: MiembroEquipo) => void;
  acciones: (m: MiembroEquipo) => React.ReactNode;
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        No se pudo cargar el equipo
      </div>
    );
  }
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (filas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/60 p-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/70 bg-muted/20">
          <Emoji name="busts-in-silhouette" className="h-8 w-8 opacity-80" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-muted-foreground">Sin personas para mostrar</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground/50">
            {filtrado ? "Probá quitando filtros o la búsqueda." : "Todavía no hay nadie cargado."}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filas.map((m) => {
        // Solo quien tiene legajo tiene ficha que abrir; una cuenta suelta (ej. un
        // administrativo) no lleva a ningún lado y no debe simular ser clickeable.
        const abrible = !!m.vendedor_id;
        return (
          <div
            key={m.key}
            onClick={abrible ? () => onAbrir(m) : undefined}
            {...(abrible
              ? {
                  role: "button" as const,
                  tabIndex: 0,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(m); }
                  },
                }
              : {})}
            className={`space-y-3 rounded-xl border border-border bg-card p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              abrible ? "cursor-pointer hover:border-primary/40 active:bg-muted/20" : ""
            } ${m.tiene_cuenta && !m.acceso_activo ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={m.nombre} size="sm" status={m.acceso_activo ? "online" : "offline"} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{m.nombre}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {m.tiene_cuenta ? (
                      <>
                        <StatusBadge variant="primary" label={m.role ? ROLE_LABEL[m.role] : "sin rol"} />
                        {!m.acceso_activo && <StatusBadge variant="muted" label="Inactivo" />}
                      </>
                    ) : (
                      <StatusBadge variant="warning" label="Sin cuenta" />
                    )}
                  </div>
                </div>
              </div>
              {acciones(m)}
            </div>

            <p className="truncate text-xs text-muted-foreground">
              {m.email ?? "sin email"}
              {m.username && <span className="ml-1.5 font-mono">· {m.username}</span>}
            </p>

            {m.vendedor_id ? (
              <>
                <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Créditos</p>
                    <p className="font-mono text-sm">{m.resumen?.creditos_otorgados ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Otorgado</p>
                    <p className="font-mono text-sm">{formatMonto(m.resumen?.monto_vendido ?? 0, 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">
                      {m.resumen?.comision_es_acumulada ? "Comisión acum." : "Comisión"}
                    </p>
                    <p className="font-mono text-sm font-semibold text-warning">
                      {formatMonto(m.resumen?.comision_total ?? 0, 0)}
                    </p>
                  </div>
                </div>
                <MetaBar meta={m.meta_venta ?? 0} avance={m.resumen?.avance_meta ?? 0} periodo={m.meta_periodo} />
              </>
            ) : (
              <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground/60">
                Sin ficha de agente — no otorga créditos.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Botón de acción de fila: cuadrado, discreto, con tono destructivo opcional. */
function IconBtn({
  title, onClick, danger, children,
}: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
        danger
          ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
