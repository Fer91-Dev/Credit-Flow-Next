"use client";

import { useMemo, useState } from "react";
import { ShieldOff, ArrowLeft, Pencil, KeyRound, UserX, UserCheck, Plus } from "lucide-react";
import { useEquipo, useUsuarios, useVendedores, type MiembroEquipo, type Usuario, type Vendedor } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { FiltrosPanel, FiltroChip } from "@/components/ui/FiltrosPanel";
import { Field, Select } from "@/components/ui/field";
import { Avatar } from "@/components/ui/Avatar";
import { VendedorDetail } from "@/components/personal/VendedorDetail";
import { PersonalForm, CrearCuentaDialog } from "@/components/personal/PersonalView";
import { UsuarioForm, CambiarPasswordDialog } from "@/components/usuarios/UsuariosView";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { formatMonto } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/auth/roles";

/**
 * **Equipo** — vista unificada de las personas de la financiera.
 *
 * Reemplaza la separación entre "Usuarios" (quién puede entrar) y "Agentes" (a quién se
 * le atribuyen créditos y comisiones), que obligaba a saltar entre dos pantallas para
 * entender a una misma persona.
 *
 * ETAPA 2: ya es AUTOSUFICIENTE — alta de integrante (legajo + cuenta), editar cuenta,
 * cambiar contraseña, activar/desactivar acceso y dar acceso a un legajo que no lo tiene.
 * Los diálogos son los MISMOS de Usuarios y Agentes (exportados, no copiados), así que el
 * alta atómica con rollback quedó intacta.
 *
 * Sigue conviviendo con las secciones viejas, que funcionan igual. No se tocó el modelo ni
 * ningún endpoint existente.
 */
export function EquipoView() {
  const { equipo, isLoading, error, mutate } = useEquipo();
  // Los diálogos de cuenta y legajo son los MISMOS de Usuarios y Agentes (exportados,
  // no copiados). Esperan objetos `Usuario` y `Vendedor` reales, así que se traen de
  // sus hooks y se busca el que corresponde por id: sin mapeos a mano que puedan
  // divergir del original.
  const { usuarios, mutate: mutateUsuarios } = useUsuarios();
  const { vendedores, mutate: mutateVendedores } = useVendedores();
  const confirm = useConfirm();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [rol, setRol] = useState("");
  const [tipo, setTipo] = useState(""); // "" | agente | solo_cuenta | sin_acceso
  const [abierto, setAbierto] = useState<string | null>(null); // vendedor_id

  // Diálogos
  const [formIntegrante, setFormIntegrante] = useState(false);       // alta: legajo + cuenta
  const [editandoCuenta, setEditandoCuenta] = useState<Usuario | null>(null);
  const [formCuentaAbierto, setFormCuentaAbierto] = useState(false);
  const [passwordDe, setPasswordDe] = useState<Usuario | null>(null);
  const [crearCuentaDe, setCrearCuentaDe] = useState<Vendedor | null>(null);

  /** Refresca las tres fuentes: la lista unificada y las dos de origen. */
  const refrescar = () => { mutate(); mutateUsuarios(); mutateVendedores(); };

  const usuarioDe = (m: MiembroEquipo) => usuarios.find((u) => u.id === m.profile_id) ?? null;
  const vendedorDe = (m: MiembroEquipo) => vendedores.find((v) => v.id === m.vendedor_id) ?? null;

  /** Legajos que YA tienen cuenta — el form los deshabilita (un agente = una cuenta). */
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
        ? `${m.nombre} no va a poder entrar al sistema. Su legajo y su historial quedan intactos.`
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

  const filtradas = useMemo(() => {
    const t = search.trim().toLowerCase();
    return equipo.filter((m) => {
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
  }, [equipo, search, rol, tipo]);

  const kpis = useMemo(() => ({
    total: equipo.length,
    agentes: equipo.filter((m) => m.vendedor_id).length,
    sinAcceso: equipo.filter((m) => !m.tiene_cuenta).length,
    inactivos: equipo.filter((m) => m.tiene_cuenta && !m.acceso_activo).length,
  }), [equipo]);

  const filtrosActivos = (rol ? 1 : 0) + (tipo ? 1 : 0);

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
      header: "Otorgado",
      mono: true,
      className: "hidden lg:table-cell",
      cell: (m) => (m.resumen ? formatMonto(m.resumen.monto_vendido) : "—"),
    },
    {
      header: "Comisión",
      mono: true,
      className: "hidden xl:table-cell",
      cell: (m) => (m.comision_pct != null ? `${m.comision_pct}%` : "—"),
    },
    {
      header: "Acciones",
      align: "right",
      className: "w-px whitespace-nowrap",
      cell: (m) => {
        const u = usuarioDe(m);
        const v = vendedorDe(m);
        return (
          // `stopPropagation`: la fila abre la ficha; estos botones no deben dispararla.
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
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon="busts-in-silhouette"
        title="Equipo"
        subtitle="Las personas de la financiera: su acceso al sistema y su legajo comercial"
        accent="primary"
      />

      {/* Aviso de convivencia — se va cuando la vista quede aprobada (etapa 3). */}
      <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-3.5 text-xs text-foreground">
        <span className="font-semibold">Vista nueva, en prueba.</span> Junta lo que hoy está
        separado en Usuarios y Agentes, con todas las acciones acá mismo. Las dos secciones
        viejas siguen funcionando sin cambios mientras la evaluás.
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon="busts-in-silhouette" label="Personas" value={String(kpis.total)} />
        <KpiCard icon="briefcase" label="Con legajo" value={String(kpis.agentes)} sub="otorgan créditos" />
        <KpiCard icon="locked-with-key" label="Sin cuenta" value={String(kpis.sinAcceso)} sub="no pueden entrar" />
        <KpiCard icon="warning" label="Acceso inactivo" value={String(kpis.inactivos)} />
      </div>

      {/* Toolbar propia: el CTA nunca va dentro del PageHeader (regla del proyecto). */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setFormIntegrante(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
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
            onF3={() => { setSearch(""); setRol(""); setTipo(""); }}
            f3Hint="para limpiar la búsqueda y los filtros"
            size="md"
            placeholder="Buscar por nombre, email, usuario o zona…"
          />
        </div>
        <FiltrosPanel
          activos={filtrosActivos}
          onLimpiar={() => { setRol(""); setTipo(""); }}
          align="right"
          chips={
            <>
              {rol && <FiltroChip onClear={() => setRol("")}>Rol: {ROLE_LABEL[rol as keyof typeof ROLE_LABEL]}</FiltroChip>}
              {tipo && (
                <FiltroChip onClear={() => setTipo("")}>
                  {tipo === "agente" ? "Con legajo" : tipo === "solo_cuenta" ? "Sin legajo" : "Sin cuenta"}
                </FiltroChip>
              )}
            </>
          }
        >
          <Field label="Rol de acceso">
            <Select value={rol} onChange={(e) => setRol(e.target.value)}>
              <option value="">Todos</option>
              <option value="admin">Administrador</option>
              <option value="vendedor">Vendedor</option>
              <option value="cobrador">Cobrador</option>
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="agente">Con legajo comercial</option>
              <option value="solo_cuenta">Solo cuenta (no vende)</option>
              <option value="sin_acceso">Sin cuenta de acceso</option>
            </Select>
          </Field>
        </FiltrosPanel>
      </div>

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
