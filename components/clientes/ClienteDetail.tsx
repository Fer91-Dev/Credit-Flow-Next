"use client";

import { useState } from "react";
import {
  Wallet, AlertCircle, Layers, ArrowUpRight, User, Briefcase, Pencil, Trash2,
  CalendarClock, HandCoins, FileText, ChevronRight, Loader2, Mail, Phone, MapPin,
} from "lucide-react";
import { useClienteDetalle, useAccionesCobranza, useCuotas, type CreditoConFinanzas, type EstadoCuota } from "@/lib/swr";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { Stat } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCreditoNumero, formatFecha } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

const CUOTA_BADGE: Record<EstadoCuota, { label: string; variant: BadgeVariant }> = {
  pagada:    { label: "Pagada",    variant: "success" },
  parcial:   { label: "Parcial",   variant: "warning" },
  vencida:   { label: "Vencida",   variant: "destructive" },
  pendiente: { label: "Pendiente", variant: "muted" },
};

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
const fmtDate = (s?: string | null) => formatFecha(s);
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
export function ClienteDetail({
  clienteId,
  variant = "full",
  onEditar,
  onEliminar,
}: {
  clienteId: string;
  /** "pagos" = solo créditos + plan de cuotas + historial. "cliente" = solo datos personales/laborales. */
  variant?: "full" | "pagos" | "cliente";
  onEditar?: () => void;
  onEliminar?: () => void;
}) {
  const { cliente, isLoading } = useClienteDetalle(clienteId);
  const { acciones } = useAccionesCobranza();

  // Qué secciones se muestran según el contexto.
  const showPersonal = variant !== "pagos";   // datos personales/laborales
  const showCreditos = variant !== "cliente"; // estado de cuenta + créditos + compromisos

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
      {/* ── Encabezado de perfil ── */}
      <div className="shrink-0 border-b border-border px-5 py-5 sm:px-6">
        <div className="flex items-start gap-4">
          {/* Avatar / monograma */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/5 text-lg font-bold text-primary ring-1 ring-primary/20">
            {iniciales(cliente.nombre)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold leading-tight text-foreground">{cliente.nombre}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusBadge label={cliente.estado} variant={cliente.estado === "activo" ? "success" : "muted"} />
                  {cliente.documento && (
                    <span className="font-mono text-xs text-muted-foreground">DNI {cliente.documento}</span>
                  )}
                </div>
              </div>

              {(onEditar || onEliminar) && (
                <div className="flex shrink-0 items-center gap-2">
                  {onEditar && (
                    <button
                      onClick={onEditar}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </button>
                  )}
                  {onEliminar && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                          <Trash2 className="h-3.5 w-3.5" /> Eliminar
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se marcará a <strong>{cliente.nombre}</strong> como inactivo. Sus créditos asociados se conservan.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={onEliminar} className="bg-destructive text-white hover:bg-destructive/90">
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              )}
            </div>

            {/* Metadata secundaria */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground/80">
              <span>Cliente desde {fmtDate(cliente.created_at)}</span>
              {edad(cliente.fecha_nacimiento) && <span className="flex items-center gap-1"><span className="text-muted-foreground/30">·</span>{edad(cliente.fecha_nacimiento)}</span>}
              {cliente.nacionalidad && <span className="flex items-center gap-1"><span className="text-muted-foreground/30">·</span>{cliente.nacionalidad}</span>}
            </div>
          </div>
        </div>

        {/* Estado de cuenta (solo cuando se muestran créditos) */}
        {showCreditos && (
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
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
        )}
      </div>

      {/* ── Cuerpo scrolleable ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">

        {/* Datos personales (presentación editorial por bloques) */}
        {showPersonal && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InfoBlock icon={User} title="Identidad" emptyText="Sin datos de identidad cargados." items={[
            { label: "DNI / Documento", value: cliente.documento, mono: true },
            { label: "CUIT / CUIL", value: cliente.cuit_cuil, mono: true },
            { label: "Nacimiento", value: cliente.fecha_nacimiento ? `${fmtDate(cliente.fecha_nacimiento)}${edad(cliente.fecha_nacimiento) ? ` · ${edad(cliente.fecha_nacimiento)}` : ""}` : null },
            { label: "Estado civil", value: cliente.estado_civil ? ESTADO_CIVIL[cliente.estado_civil] ?? cliente.estado_civil : null },
            { label: "Nacionalidad", value: cliente.nacionalidad },
          ]} />

          <div className="space-y-4">
            <InfoBlock icon={Mail} title="Contacto" emptyText="Sin datos de contacto cargados." onEditar={onEditar} items={[
              { label: "Email", value: cliente.email, icon: Mail, href: cliente.email ? `mailto:${cliente.email}` : undefined },
              { label: "Teléfono", value: cliente.telefono, icon: Phone, href: cliente.telefono ? `tel:${cliente.telefono}` : undefined },
            ]} />
            <InfoBlock icon={MapPin} title="Domicilio" emptyText="Sin domicilio cargado." items={[
              { label: "Dirección", value: cliente.direccion },
            ]} />
          </div>

          <div className="lg:col-span-2">
            <InfoBlock icon={Briefcase} title="Laboral e ingresos" emptyText="Sin datos laborales cargados." items={[
              { label: "Situación", value: cliente.situacion_laboral ? SITUACION_LABORAL[cliente.situacion_laboral] ?? cliente.situacion_laboral : null },
              { label: "Ocupación", value: cliente.ocupacion },
              { label: "Empleador", value: cliente.empleador },
              { label: "Antigüedad", value: cliente.antiguedad_laboral_meses != null ? `${cliente.antiguedad_laboral_meses} meses` : null },
              { label: "Ingreso mensual", value: cliente.ingreso_mensual != null ? `$${n0(cliente.ingreso_mensual)}` : null, mono: true },
              { label: "Otros ingresos", value: cliente.otros_ingresos != null ? `$${n0(cliente.otros_ingresos)}` : null, mono: true },
              { label: "Teléfono laboral", value: cliente.telefono_laboral, icon: Phone, href: cliente.telefono_laboral ? `tel:${cliente.telefono_laboral}` : undefined },
              { label: "Dirección laboral", value: cliente.direccion_laboral },
            ]} />
          </div>
        </div>
        )}

        {/* Compromisos vigentes */}
        {showCreditos && compromisos.length > 0 && (
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
        {showCreditos && (
          <section className="space-y-2">
            <SectionTitle icon={Layers} text={`Créditos activos${activos.length ? ` (${activos.length})` : ""}`} />
            {activos.length === 0 ? (
              <EmptyRow text="El cliente no tiene créditos activos." />
            ) : (
              <CreditosTabla creditos={activos} mostrarProximo />
            )}
          </section>
        )}

        {/* Historial de créditos */}
        {showCreditos && historicos.length > 0 && (
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
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const cols = mostrarProximo ? 7 : 6;

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
            const tieneCuotas = !!c.cuotas_resumen && c.cuotas_resumen.total > 0;
            const abierto = abiertos.has(c.id);
            return (
              <FragmentRow key={c.id}>
                <tr
                  className={`${idx % 2 === 1 ? "bg-muted/5" : ""} ${tieneCuotas ? "cursor-pointer hover:bg-muted/20" : ""}`}
                  onClick={tieneCuotas ? () => toggle(c.id) : undefined}
                >
                  <td className="px-3 py-2 text-foreground border-b border-border/40">
                    <span className="inline-flex items-center gap-1.5">
                      {tieneCuotas
                        ? <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${abierto ? "rotate-90" : ""}`} />
                        : <span className="inline-block w-3.5" />}
                      <span className="font-mono text-[11px] text-muted-foreground/70">{formatCreditoNumero(c.numero)}</span>
                      <span className="capitalize">{c.tipo_credito}</span>
                      <span className="text-muted-foreground/60"> · {c.tasa}% · {c.plazo_meses} cuotas</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground tabular-nums border-b border-border/40">${n0(c.monto_original)}</td>
                  <td className="px-3 py-2 text-right font-mono text-warning tabular-nums border-b border-border/40">${n0(c.saldo_pendiente)}</td>
                  <td className="px-3 py-2 text-right font-mono text-primary tabular-nums border-b border-border/40">${n0(c.cuota)}</td>
                  <td className="px-3 py-2 text-center tabular-nums border-b border-border/40">
                    {tieneCuotas ? (
                      <span className="font-mono text-muted-foreground">
                        {c.cuotas_resumen!.pagadas}/{c.cuotas_resumen!.total}
                        {c.cuotas_resumen!.vencidas > 0 && (
                          <span className="text-destructive"> · {c.cuotas_resumen!.vencidas} venc.</span>
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
                {abierto && (
                  <tr>
                    <td colSpan={cols} className="border-b border-border/40 bg-muted/[0.03] p-0">
                      <CuotasInline creditoId={c.id} />
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Wrapper para devolver dos <tr> con una sola key sin romper la semántica de tabla. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Plan de cuotas detallado de un crédito, embebido en la fila expandida. */
function CuotasInline({ creditoId }: { creditoId: string }) {
  const { cuotas, resumen, isLoading } = useCuotas(creditoId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando plan de cuotas…
      </div>
    );
  }
  if (cuotas.length === 0) {
    return <p className="py-5 text-center text-xs text-muted-foreground/60">Sin cronograma de cuotas.</p>;
  }

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Plan de cuotas</p>
        {resumen && (
          <span className="text-[11px] text-muted-foreground/70 tabular-nums">
            {resumen.pagadas}/{resumen.total} pagadas
            {resumen.vencidas > 0 && <span className="text-destructive"> · {resumen.vencidas} vencida{resumen.vencidas !== 1 ? "s" : ""}</span>}
            {" · "}saldo <span className="font-mono">${n0(resumen.saldo_capital)}</span>
          </span>
        )}
      </div>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="max-h-[40vh] overflow-y-auto">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-card">
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border w-8">#</th>
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border">Venc.</th>
                <th className="px-2 py-1.5 text-right font-semibold text-foreground          border-b border-border">Cuota</th>
                <th className="px-2 py-1.5 text-right font-semibold text-warning          border-b border-border hidden sm:table-cell">Interés</th>
                <th className="px-2 py-1.5 text-right font-semibold text-primary          border-b border-border">Capital</th>
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border pr-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {cuotas.map((q, i) => {
                const bb = CUOTA_BADGE[q.estado];
                return (
                  <tr key={q.nro} className={i % 2 === 1 ? "bg-muted/5" : ""}>
                    <td className="px-2 py-1.5 font-mono text-muted-foreground/50 tabular-nums border-b border-border/30">{q.nro}</td>
                    <td className="px-2 py-1.5 text-muted-foreground tabular-nums border-b border-border/30">{fmtDate(q.fecha_vencimiento)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-foreground tabular-nums border-b border-border/30">${n2(q.cuota_total)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-warning tabular-nums border-b border-border/30 hidden sm:table-cell">${n2(q.interes)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-primary tabular-nums border-b border-border/30">${n2(q.capital)}</td>
                    <td className="px-2 py-1.5 pr-3 border-b border-border/30"><StatusBadge label={bb.label} variant={bb.variant} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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

/** Iniciales para el monograma del avatar (hasta 2 palabras). */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

interface CampoItem {
  label: string;
  value?: string | null;
  mono?: boolean;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

/** Bloque editorial de datos: título con ícono + grilla de campos. Oculta vacíos. */
function InfoBlock({
  icon: Icon, title, items, emptyText, onEditar,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: CampoItem[];
  emptyText: string;
  onEditar?: () => void;
}) {
  const visibles = items.filter((it) => it.value != null && it.value !== "");
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-muted/[0.12]">
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {visibles.length === 0 ? (
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <p className="text-xs text-muted-foreground/50">{emptyText}</p>
          {onEditar && (
            <button onClick={onEditar} className="text-xs text-primary/80 hover:text-primary transition-colors whitespace-nowrap">
              Completar
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2">
          {visibles.map((it) => <Campo key={it.label} {...it} />)}
        </div>
      )}
    </section>
  );
}

/** Campo individual: label chico arriba, valor destacado abajo (clicable si hay href). */
function Campo({ label, value, mono, href, icon: Icon }: CampoItem) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
        {href ? (
          <a href={href} className={`truncate text-sm text-foreground hover:text-primary transition-colors ${mono ? "font-mono" : ""}`}>{value}</a>
        ) : (
          <span className={`truncate text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value}</span>
        )}
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="text-xs text-muted-foreground/60 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
      {text}
    </p>
  );
}
