"use client";

import { useMemo, useState } from "react";
import { Loader2, Phone } from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { useAccionesDeCredito, type Credito, type AccionCobranza } from "@/lib/swr";
import { linkWhatsapp, contactoBloqueado, type OfertaSugerida } from "@/lib/domain";
import { formatMonto, formatFecha, formatFechaHora, formatDias, nombreCompleto } from "@/lib/utils";

const TIPO_LABEL: Record<AccionCobranza["tipo"], string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", email: "Email", visita: "Visita", otro: "Otro",
};

const RESULTADO_LABEL: Record<AccionCobranza["resultado"], string> = {
  contactado: "Contactado",
  no_contesta: "No contesta",
  promesa_pago: "Prometió pagar",
  renegociacion: "Renegocia",
  ilocalizable: "Ilocalizable",
  otro: "Otro",
};

/**
 * GESTIONAR UN CASO INCOBRABLE: llamarlo, anotar qué contestó, y ver qué se hizo antes.
 *
 * ── POR QUÉ NO ALCANZABA CON EL FORMULARIO DE GESTIONES QUE YA HABÍA ──
 *
 * El de morosos propone qué prometer a partir del PLAN: "cuota 3, vence el 12, $181.819,43".
 * Sobre un castigado ese plan ya no existe —se cayó, por eso está acá— y ofrecerlo llevaría
 * al operador a pactar una cuota de un cronograma que nadie va a cobrar. Lo que se promete
 * acá es otra cosa: el importe de cancelación, uno solo, contra el cierre del caso.
 *
 * ── Y POR QUÉ EL HISTORIAL VA ARRIBA ──
 *
 * Recuperar cartera vieja es insistir. La pregunta que se hace el que va a llamar no es
 * "¿cuánto debe?" sino "¿qué le dijimos la última vez y qué contestó?" — sin eso, dos
 * personas le repiten la misma oferta el mismo día y el deudor aprende que nadie lleva la
 * cuenta. Por eso lo primero que se ve es lo que ya se hizo.
 */
export function GestionCasoDialog({
  credito,
  oferta,
  diasCastigado,
  onClose,
}: {
  credito: Credito | null;
  /** Lo que el motor sugiere pedirle. Es el importe que se propone prometer. */
  oferta: OfertaSugerida | null;
  diasCastigado: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const { acciones, isLoading, mutate } = useAccionesDeCredito(credito?.id ?? null);

  const [form, setForm] = useState({
    tipo: "llamada" as AccionCobranza["tipo"],
    resultado: "contactado" as AccionCobranza["resultado"],
    nota: "",
    promesa_monto: "",
    promesa_fecha: "",
    proximo_contacto: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bloqueo = credito ? contactoBloqueado(credito.cliente) : { bloqueado: false, motivo: null };
  const deuda = credito ? credito.vencido || credito.saldo_pendiente : 0;

  /**
   * El texto que se le manda. Nombra el importe con el que CANCELA, no la deuda: sobre un
   * castigado esa cifra es varias veces lo prestado y es lo que hace que corte el teléfono.
   */
  const mensaje = useMemo(() => {
    if (!credito) return "";
    const monto = oferta ? formatMonto(oferta.monto) : formatMonto(deuda);
    return (
      `Hola ${nombreCompleto(credito.cliente)}, te escribimos por tu deuda. ` +
      `Tenemos una propuesta para cerrarla: abonando ${monto} queda cancelada y no debés nada más. ` +
      `Escribinos y lo coordinamos.`
    );
  }, [credito, oferta, deuda]);

  const registrar = async (datos: Partial<typeof form> & { tipo: AccionCobranza["tipo"] }) => {
    if (!credito) return null;
    const body = {
      credito_id: credito.id,
      tipo: datos.tipo,
      resultado: datos.resultado ?? "contactado",
      nota: datos.nota?.trim() || null,
      promesa_monto: datos.promesa_monto ? Number(datos.promesa_monto.replace(/\./g, "").replace(",", ".")) : undefined,
      promesa_fecha: datos.promesa_fecha || undefined,
      proximo_contacto: datos.proximo_contacto || undefined,
    };
    const res = await fetch("/api/cobranza/acciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "No se pudo registrar la gestión");
    return json;
  };

  /** Abre el WhatsApp con la propuesta y deja la gestión anotada, en un solo gesto. */
  const porWhatsapp = async () => {
    if (!credito || bloqueo.bloqueado) return;
    setGuardando(true);
    setError(null);
    try {
      // Primero se abre: si el registro fallara, al menos el contacto salió. Al revés se
      // perdería la ventana emergente por el `await` del medio (los navegadores la bloquean).
      window.open(linkWhatsapp(credito.cliente.telefono, mensaje), "_blank", "noopener");
      await registrar({ tipo: "whatsapp", resultado: "contactado", nota: `Propuesta de cancelación enviada${oferta ? ` por ${formatMonto(oferta.monto)}` : ""}` });
      toast.success("WhatsApp abierto y gestión registrada");
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la gestión");
    } finally {
      setGuardando(false);
    }
  };

  const guardar = async () => {
    if (!credito) return;
    setGuardando(true);
    setError(null);
    try {
      await registrar(form);
      toast.success("Gestión registrada");
      setForm((p) => ({ ...p, nota: "", promesa_monto: "", promesa_fecha: "" }));
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la gestión");
    } finally {
      setGuardando(false);
    }
  };

  const esPromesa = form.resultado === "promesa_pago";

  return (
    <Dialog open={!!credito} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Gestionar el caso
          </DialogTitle>
        </DialogHeader>

        {!credito ? null : (
          <div className="space-y-4">
            {/* Contra qué se negocia, en una línea */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-border bg-muted/20 px-3.5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{nombreCompleto(credito.cliente)}</p>
                <p className="text-[11px] text-muted-foreground">
                  castigado hace {formatDias(diasCastigado)} · se le reclama{" "}
                  <span className="font-mono tabular-nums">{formatMonto(deuda)}</span>
                </p>
              </div>
              {oferta && (
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ofrecerle</p>
                  <p className="font-mono text-base font-bold tabular-nums text-success">{formatMonto(oferta.monto)}</p>
                </div>
              )}
            </div>

            {/* ── Lo que ya se hizo. Va primero: es lo que decide qué decir ahora. ── */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Gestiones anteriores
              </p>
              {isLoading ? (
                <Skeleton className="h-16 rounded-lg" />
              ) : acciones.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  Nunca se lo gestionó desde que se dio por incobrable. Esta sería la primera.
                </p>
              ) : (
                <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {acciones.map((g) => (
                    <div key={g.id} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="font-medium text-foreground">{TIPO_LABEL[g.tipo]}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{RESULTADO_LABEL[g.resultado]}</span>
                        {g.promesa_monto != null && (
                          <StatusBadge
                            label={`Prometió ${formatMonto(g.promesa_monto)}${g.promesa_fecha ? ` · ${formatFecha(g.promesa_fecha)}` : ""}`}
                            variant={
                              g.promesa_estado === "cumplida" ? "success"
                              : g.promesa_estado === "incumplida" ? "destructive" : "warning"
                            }
                          />
                        )}
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                          {formatFechaHora(g.created_at)}
                        </span>
                      </div>
                      {g.nota && <p className="mt-1 text-xs leading-snug text-muted-foreground">{g.nota}</p>}
                      {g.gestionado_por_nombre && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground/70">{g.gestionado_por_nombre}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Contactarlo ── */}
            <button
              type="button"
              onClick={porWhatsapp}
              disabled={guardando || bloqueo.bloqueado || !credito.cliente.telefono}
              title={
                bloqueo.bloqueado ? (bloqueo.motivo ?? "No se puede contactar")
                : !credito.cliente.telefono ? "Sin teléfono cargado"
                : "Abre el WhatsApp con la propuesta y registra la gestión"
              }
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-success/30 bg-success/10 py-2.5 text-sm font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-40"
            >
              <WhatsAppIcon className="h-4 w-4" />
              Mandarle la propuesta por WhatsApp
            </button>

            {/* ── Anotar lo que pasó ── */}
            <div className="space-y-3 rounded-xl border border-border p-3.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Anotar una gestión
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cómo se lo contactó">
                  <Select
                    value={form.tipo}
                    onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value as AccionCobranza["tipo"] }))}
                  >
                    <option value="llamada">Llamada</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="visita">Visita</option>
                    <option value="email">Email</option>
                    <option value="otro">Otro</option>
                  </Select>
                </Field>
                <Field label="Qué pasó">
                  <Select
                    value={form.resultado}
                    onChange={(e) => setForm((p) => ({ ...p, resultado: e.target.value as AccionCobranza["resultado"] }))}
                  >
                    <option value="contactado">Contactado</option>
                    <option value="no_contesta">No contesta</option>
                    <option value="promesa_pago">Prometió pagar</option>
                    <option value="renegociacion">Quiere renegociar el monto</option>
                    <option value="ilocalizable">Ilocalizable</option>
                    <option value="otro">Otro</option>
                  </Select>
                </Field>
              </div>

              {/*
                La promesa de un castigado es UNA sola y es la de cancelación: no hay cuotas
                que prometer porque su plan se cayó. Por eso el importe arranca en la oferta
                del motor, que es lo que se le acaba de decir por teléfono.
              */}
              {esPromesa && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Cuánto prometió" hint={oferta ? `Se le ofreció ${formatMonto(oferta.monto)}` : undefined}>
                    <Input
                      inputMode="decimal"
                      placeholder={oferta ? String(oferta.monto) : ""}
                      value={form.promesa_monto}
                      onChange={(e) => setForm((p) => ({ ...p, promesa_monto: e.target.value }))}
                      onFocus={() => {
                        if (!form.promesa_monto && oferta) setForm((p) => ({ ...p, promesa_monto: String(oferta.monto) }));
                      }}
                    />
                  </Field>
                  <Field label="Para cuándo">
                    <Input
                      type="date"
                      value={form.promesa_fecha}
                      onChange={(e) => setForm((p) => ({ ...p, promesa_fecha: e.target.value }))}
                    />
                  </Field>
                </div>
              )}

              <Field label="Nota" hint="Qué dijo, con quién se habló, qué se acordó.">
                <Textarea
                  rows={2}
                  value={form.nota}
                  onChange={(e) => setForm((p) => ({ ...p, nota: e.target.value }))}
                  placeholder="Ej: atendió la hija, dice que el titular consiguió trabajo y pueden juntar la mitad para fin de mes."
                />
              </Field>

              <Field label="Volver a llamarlo el" hint="Aparece en la agenda del día.">
                <Input
                  type="date"
                  value={form.proximo_contacto}
                  onChange={(e) => setForm((p) => ({ ...p, proximo_contacto: e.target.value }))}
                />
              </Field>

              {error && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={guardar}
                  disabled={guardando}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                  Guardar gestión
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
