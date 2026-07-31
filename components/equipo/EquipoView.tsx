"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ShieldOff, Briefcase, ExternalLink, ArrowLeft } from "lucide-react";
import { useEquipo, type MiembroEquipo } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { FiltrosPanel, FiltroChip } from "@/components/ui/FiltrosPanel";
import { Field, Select } from "@/components/ui/field";
import { Avatar } from "@/components/ui/Avatar";
import { VendedorDetail } from "@/components/personal/VendedorDetail";
import { formatMonto } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/auth/roles";

/**
 * **Equipo** — vista unificada de las personas de la financiera.
 *
 * Reemplaza la separación entre "Usuarios" (quién puede entrar) y "Agentes" (a quién se
 * le atribuyen créditos y comisiones), que obligaba a saltar entre dos pantallas para
 * entender a una misma persona.
 *
 * ⚠️ ETAPA 1: convive con las secciones viejas, que siguen funcionando. Acá se ve y se
 * abre la ficha; las acciones de cuenta (crear, contraseña, activar) siguen en Usuarios
 * hasta que esta vista esté aprobada. No se cambió ni el modelo ni un endpoint.
 */
export function EquipoView() {
  const { equipo, isLoading, error, mutate } = useEquipo();

  const [search, setSearch] = useState("");
  const [rol, setRol] = useState("");
  const [tipo, setTipo] = useState(""); // "" | agente | solo_cuenta | sin_acceso
  const [abierto, setAbierto] = useState<string | null>(null); // vendedor_id

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
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{m.nombre}</p>
            <p className="truncate text-xs text-muted-foreground">
              {m.email ?? "sin email"}
              {m.username && <span className="ml-1.5 font-mono">· {m.username}</span>}
            </p>
          </div>
        </div>
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
      header: "Legajo",
      className: "hidden md:table-cell",
      cell: (m) =>
        m.vendedor_id ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Briefcase className="h-3 w-3 shrink-0" />
            {m.zona || "sin zona"}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
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
      className: "hidden lg:table-cell",
      cell: (m) => (m.comision_pct != null ? `${m.comision_pct}%` : "—"),
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
        separado en Usuarios y Agentes. Las dos secciones viejas siguen funcionando sin cambios
        mientras la evaluás.
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon="busts-in-silhouette" label="Personas" value={String(kpis.total)} />
        <KpiCard icon="briefcase" label="Con legajo" value={String(kpis.agentes)} sub="otorgan créditos" />
        <KpiCard icon="locked-with-key" label="Sin cuenta" value={String(kpis.sinAcceso)} sub="no pueden entrar" />
        <KpiCard icon="warning" label="Acceso inactivo" value={String(kpis.inactivos)} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="sm:max-w-md sm:flex-1">
          <BuscadorF3
            value={search}
            onChange={setSearch}
            onF3={() => setSearch("")}
            f3Hint="para limpiar la búsqueda y ver a todo el equipo"
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

      <p className="text-xs text-muted-foreground">
        Las acciones de cuenta (crear, cambiar contraseña, activar o desactivar) siguen por ahora en{" "}
        <Link href="/usuarios" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          Usuarios <ExternalLink className="h-3 w-3" />
        </Link>
        . Se integran acá cuando apruebes esta vista.
      </p>

    </div>
  );
}
