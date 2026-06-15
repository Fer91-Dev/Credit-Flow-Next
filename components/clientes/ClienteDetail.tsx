"use client";

import {
  Wallet, AlertCircle, Layers, ArrowUpRight, User, Briefcase, Pencil,
  CalendarClock, HandCoins, FileText,
} from "lucide-react";
import { useClienteDetalle, useAccionesCobranza, type CreditoConFinanzas } from "@/lib/swr";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Stat } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/skeleton";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function fmtDate(s?: string | null) {
  return s ? new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
}
function edad(fechaNac?: string | null): string {
  if (!fechaNac) return "";
  const d = new Date(fechaNac);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const años = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return años > 0 ? `${años} años` : "";
}

const ESTADO_CIVIL: Record<string, string> = {
  soltero: "Soltero/a", casado: "Casado/a", divorciado: "Divorciado/a",
  viudo: "Viudo/a", union_convivencial: "Unión convivencial",
};
const SITUACION_LABORAL: Record<string, string> = {
  relacion_dependencia: "Relación de dependencia", autonomo: "Autónomo",
  monotributista: "Monotributista", jubilado: "Jubilado/Pensionado",
  desempleado: "Desempleado", otro: "Otro",
};

function creditoBadge(estado: string): { label: string; variant: "primary" | "success" | "muted" | "destructive" } {
  if (estado === "activo") return { label: "Activo", variant: "primary" };
  if (estado === "pagado") return { label: "Pagado", variant: "success" };
  if (estado === "cancelado") return { label: "Cancelado", variant: "destructive" };
  return { label: estado, variant: "muted" };
}

/**
 * Ficha 360° del cliente (solo lectura). Reúne datos personales, laborales y
 * crediticios + el estado de cuenta calculado en el servidor, más los
 * compromisos de pago vigentes (promesas tomadas en gestiones de cobranza).
 */
export function ClienteDetail({ clienteId, onEditar }: { clienteId: string; onEditar?: () => void }) {
  const { cliente, isLoading } = useClienteDetalle(clienteId);
  const { acciones } = useAccionesCobranza();

  if (isLoading || !cliente) {
    return (
      <div className="p-5 space-y-4">
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const ec = cliente.estado_cuenta;
  const creditos = cliente.creditos ?? [];
  const activos = creditos.filter((c) => c.estado === "activo");
  const historicos = creditos.filter((c) => c.estado !== "activo");

  // Compromisos vigentes: promesas de pago sobre créditos de este cliente, a futuro.
  const creditoIds = new Set(creditos.map((c) => c.id));
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const compromisos = acciones
    .filter((a) => creditoIds.has(a.credito_id) && a.resultado === "promesa_pago" && a.promesa_fecha)
    .filter((a) => new Date(a.promesa_fecha as string) >= hoy)
    .sort((a, b) => new Date(a.promesa_fecha as string).getTime() - new Date(b.promesa_fecha as string).getTime());

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Encabezado ── */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-base font-semibold text-foreground truncate">{cliente.nombre}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {cliente.documento ? `DNI ${cliente.documento}` : "Sin documento"}
              {" · "}Alta {fmtDate(cliente.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge label={cliente.estado} variant={cliente.estado === "activo" ? "success" : "muted"} />
            {onEditar && (
              <button
                onClick={onEditar}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            )}
          </div>
        </div>

        {/* Estado de cuenta */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat icon={Wallet} label="Deuda total" accent={ec.deuda_total > 0 ? "warning" : "success"} value={`$${n0(ec.deuda_total)}`} sub="saldo de créditos activos" />
          <Stat
            icon={AlertCircle}
            label={ec.en_mora ? "En mora" : "Situación"}
            accent={ec.dias_mora_max > 30 ? "destructive" : ec.en_mora ? "warning" : "success"}
            value={ec.en_mora ? `${ec.dias_mora_max}d` : "Al día"}
            sub={ec.en_mora ? `mora $${n0(ec.interes_mora_total)} · ${ec.creditos_en_mora} créd.` : "sin atrasos"}
          />
          <Stat icon={Layers} label="Créditos activos" accent="primary" value={String(ec.creditos_activos)} sub={`${ec.creditos_total} en total`} />
          <Stat icon={ArrowUpRight} label="Total cobrado" accent="success" value={`$${n0(ec.total_cobrado)}`} sub="histórico" />
        </div>
      </div>

      {/* ── Cuerpo scrolleable ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">

        {/* Datos personales + laborales */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="space-y-2">
            <SectionTitle icon={User} text="Datos personales" />
            <DataGrid rows={[
              ["DNI / Documento", cliente.documento],
              ["CUIT / CUIL", cliente.cuit_cuil],
              ["Nacimiento", cliente.fecha_nacimiento ? `${fmtDate(cliente.fecha_nacimiento)}${edad(cliente.fecha_nacimiento) ? ` (${edad(cliente.fecha_nacimiento)})` : ""}` : null],
              ["Estado civil", cliente.estado_civil ? ESTADO_CIVIL[cliente.estado_civil] ?? cliente.estado_civil : null],
              ["Nacionalidad", cliente.nacionalidad],
              ["Dirección", cliente.direccion],
              ["Email", cliente.email],
              ["Teléfono", cliente.telefono],
            ]} />
          </section>

          <section className="space-y-2">
            <SectionTitle icon={Briefcase} text="Datos laborales" />
            <DataGrid rows={[
              ["Situación", cliente.situacion_laboral ? SITUACION_LABORAL[cliente.situacion_laboral] ?? cliente.situacion_laboral : null],
              ["Ocupación", cliente.ocupacion],
              ["Empleador", cliente.empleador],
              ["Antigüedad", cliente.antiguedad_laboral_meses != null ? `${cliente.antiguedad_laboral_meses} meses` : null],
              ["Ingreso mensual", cliente.ingreso_mensual != null ? `$${n0(cliente.ingreso_mensual)}` : null],
              ["Otros ingresos", cliente.otros_ingresos != null ? `$${n0(cliente.otros_ingresos)}` : null],
              ["Teléfono laboral", cliente.telefono_laboral],
              ["Dirección laboral", cliente.direccion_laboral],
            ]} />
          </section>
        </div>

        {/* Compromisos vigentes */}
        {compromisos.length > 0 && (
          <section className="space-y-2">
            <SectionTitle icon={HandCoins} text="Compromisos de pago vigentes" />
            <div className="rounded-xl border border-success/20 bg-success/[0.04] divide-y divide-border/50">
              {compromisos.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-2 text-foreground">
                    <CalendarClock className="h-3.5 w-3.5 text-success" />
                    Promesa para el {fmtDate(c.promesa_fecha)}
                  </span>
                  <span className="font-mono font-semibold text-success">
                    {c.promesa_monto != null ? `$${n0(c.promesa_monto)}` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Créditos activos */}
        <section className="space-y-2">
          <SectionTitle icon={Layers} text={`Créditos activos${activos.length ? ` (${activos.length})` : ""}`} />
          {activos.length === 0 ? (
            <EmptyRow text="El cliente no tiene créditos activos." />
          ) : (
            <CreditosTabla creditos={activos} mostrarProximo />
          )}
        </section>

        {/* Historial de créditos */}
        {historicos.length > 0 && (
          <section className="space-y-2">
            <SectionTitle icon={FileText} text={`Historial de créditos (${historicos.length})`} />
            <CreditosTabla creditos={historicos} />
          </section>
        )}
      </div>
    </div>
  );
}

function CreditosTabla({ creditos, mostrarProximo }: { creditos: CreditoConFinanzas[]; mostrarProximo?: boolean }) {
  return (
    <div className="rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr className="bg-muted/30">
            <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Crédito</th>
            <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border">Monto</th>
            <th className="px-3 py-2.5 text-right font-semibold text-warning          border-b border-border">Saldo</th>
            <th className="px-3 py-2.5 text-right font-semibold text-primary          border-b border-border">Cuota</th>
            <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground border-b border-border">Cuotas</th>
            {mostrarProximo && <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Próx. venc.</th>}
            <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border pr-4">Estado</th>
          </tr>
        </thead>
        <tbody>
          {creditos.map((c, idx) => {
            const b = creditoBadge(c.estado);
            return (
              <tr key={c.id} className={idx % 2 === 1 ? "bg-muted/5" : ""}>
                <td className="px-3 py-2 text-foreground border-b border-border/40">
                  <span className="capitalize">{c.tipo_credito}</span>
                  <span className="text-muted-foreground/60"> · {c.tasa}% · {c.plazo_meses} cuotas</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground tabular-nums border-b border-border/40">${n0(c.monto_original)}</td>
                <td className="px-3 py-2 text-right font-mono text-warning tabular-nums border-b border-border/40">${n0(c.saldo_pendiente)}</td>
                <td className="px-3 py-2 text-right font-mono text-primary tabular-nums border-b border-border/40">${n0(c.cuota)}</td>
                <td className="px-3 py-2 text-center tabular-nums border-b border-border/40">
                  {c.cuotas_resumen && c.cuotas_resumen.total > 0 ? (
                    <span className="font-mono text-muted-foreground">
                      {c.cuotas_resumen.pagadas}/{c.cuotas_resumen.total}
                      {c.cuotas_resumen.vencidas > 0 && (
                        <span className="text-destructive"> · {c.cuotas_resumen.vencidas} venc.</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/30">—</span>
                  )}
                </td>
                {mostrarProximo && (
                  <td className="px-3 py-2 tabular-nums border-b border-border/40">
                    {c.dias_mora > 0
                      ? <span className="text-destructive">{c.dias_mora}d mora</span>
                      : <span className="text-muted-foreground">{fmtDate(c.cuotas_resumen?.proxima_vencimiento ?? c.proximo_pago)}</span>}
                  </td>
                )}
                <td className="px-3 py-2 pr-4 border-b border-border/40">
                  <StatusBadge label={b.label} variant={b.variant} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionTitle({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold text-foreground">{text}</h3>
    </div>
  );
}

function DataGrid({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="rounded-xl border border-border divide-y divide-border/50">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-3 px-4 py-2">
          <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
          <dd className={`text-xs text-right ${value ? "text-foreground" : "text-muted-foreground/30"}`}>
            {value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="text-xs text-muted-foreground/60 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
      {text}
    </p>
  );
}
