"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader } from "@/components/ui/form-kit";
import { Field, Input, Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useZonas, usePlanillaCalle, useFinanciera } from "@/lib/swr";
import { imprimirPlanillaCalle } from "@/lib/planilla-print";
import { formatMonto } from "@/lib/utils";
import { Printer, MapPin, Loader2 } from "lucide-react";

/** Clave interna del grupo "sin zona cargada" (la comparte con el endpoint). */
const SIN_ZONA = "__sin__";

/**
 * PLANILLA DE COBRANZA EN CALLE — armar el recorrido e imprimirlo.
 *
 * El cobrador de la calle NO usa el sistema: alguien de la oficina arma la lista, la imprime
 * y se la da. Este diálogo es esa oficina.
 *
 * Lo que se elige acá es el RECORRIDO (qué zonas, y si se pasa también por los que están por
 * vencer), no los importes: esos salen del motor y no se editan. Antes de imprimir se ve
 * cuántos clientes y cuánta plata tiene el recorrido, porque una planilla de 90 puertas no
 * se hace en un día y eso hay que verlo antes de gastar el papel.
 */
export function PlanillaCalleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { zonas: zonasCargadas, isLoading: cargandoZonas } = useZonas();
  const { financiera } = useFinanciera();

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [diasAdelante, setDiasAdelante] = useState(0);
  const [cobrador, setCobrador] = useState("");

  // Solo consulta con el diálogo abierto: es una query pesada (trae cuotas de toda la mora).
  const { planilla, isLoading, error } = usePlanillaCalle(
    open ? { zonas: [...seleccion], diasAdelante } : null,
  );

  const opciones = [...zonasCargadas, SIN_ZONA];
  const toggle = (z: string) => {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(z)) s.delete(z); else s.add(z);
      return s;
    });
  };

  const hayRecorrido = (planilla?.totales.clientes ?? 0) > 0;

  const imprimir = () => {
    if (!planilla || !hayRecorrido) return;
    imprimirPlanillaCalle({
      fecha: planilla.fecha,
      zonas: planilla.zonas,
      totales: planilla.totales,
      diasAdelante: planilla.dias_adelante,
      cobrador: cobrador.trim() || null,
      financiera: financiera ? { nombre: financiera.nombre, logo_url: financiera.logo_url } : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <ModalHeader
          icon={MapPin}
          title="Planilla de cobranza en calle"
          subtitle="La lista impresa que se lleva el cobrador, agrupada por zona"
          accent="primary"
        />

        <div className="space-y-5">
          {/* ── Zonas del recorrido ── */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Zonas del recorrido
              <span className="ml-1.5 text-muted-foreground/60">
                {seleccion.size === 0 ? "· todas" : `· ${seleccion.size} elegida${seleccion.size === 1 ? "" : "s"}`}
              </span>
            </p>
            {cargandoZonas ? (
              <Skeleton className="h-9 rounded-lg" />
            ) : opciones.length === 1 ? (
              // Solo está "sin zona": nadie tiene el campo cargado. Se dice qué falta y dónde,
              // no se bloquea: la planilla sale igual en un solo grupo.
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                Ningún cliente tiene zona cargada — la planilla sale en un único grupo. La zona se
                carga en la ficha del cliente.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {opciones.map((z) => {
                  const activa = seleccion.has(z);
                  return (
                    <button
                      key={z}
                      type="button"
                      onClick={() => toggle(z)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        activa
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {z === SIN_ZONA ? "Sin zona asignada" : z}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/*
              El recorrido de rutina del crédito de barrio no es solo de morosos: el cobrador
              pasa por la cuota de la semana. En 0 la planilla es de recupero puro.
            */}
            <Field
              label="A quién visitar"
              hint={diasAdelante === 0
                ? "Solo los que ya se atrasaron."
                : `Suma los que vencen dentro de ${diasAdelante} días, a su importe de cuota sin punitorios.`}
            >
              <Select value={String(diasAdelante)} onChange={(e) => setDiasAdelante(Number(e.target.value))}>
                <option value="0">Solo los vencidos</option>
                <option value="7">Vencidos + los que vencen en 7 días</option>
                <option value="15">Vencidos + los que vencen en 15 días</option>
                <option value="30">Vencidos + los que vencen en 30 días</option>
              </Select>
            </Field>

            <Field label="Cobrador" hint="Se imprime en el encabezado. Opcional.">
              <Input
                value={cobrador}
                onChange={(e) => setCobrador(e.target.value)}
                placeholder="Nombre de quien sale a cobrar"
                maxLength={60}
              />
            </Field>
          </div>

          {/* ── Qué tiene el recorrido, antes de imprimirlo ── */}
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            {isLoading ? (
              <Skeleton className="h-12 rounded-lg" />
            ) : error ? (
              <p className="text-xs text-destructive">No se pudo armar la planilla: {error.message}</p>
            ) : !hayRecorrido ? (
              <p className="text-xs text-muted-foreground">
                No hay nadie para visitar con estos filtros. Quedan afuera los que están cumpliendo un
                acuerdo de pago y los que pidieron no ser contactados.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Dato label="Zonas" valor={String(planilla!.totales.zonas)} />
                  <Dato label="Clientes" valor={String(planilla!.totales.clientes)} />
                  {/* Créditos ≠ clientes: un titular con tres créditos son tres renglones. */}
                  <Dato label="Créditos" valor={String(planilla!.totales.creditos)} />
                  <Dato label="A cobrar" valor={formatMonto(planilla!.totales.total)} alerta />
                </div>
                <div className="mt-3 space-y-1 border-t border-border pt-2.5">
                  {planilla!.zonas.map((z) => (
                    <div key={z.zona ?? SIN_ZONA} className="flex items-baseline justify-between text-xs">
                      <span className="text-foreground">{z.zona ?? "Sin zona asignada"}</span>
                      <span className="text-muted-foreground/70">
                        {z.clientes} cliente{z.clientes === 1 ? "" : "s"}
                        {z.creditos !== z.clientes && ` · ${z.creditos} créditos`}
                        <span className="ml-2 font-mono text-foreground">{formatMonto(z.total)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={imprimir}
              disabled={isLoading || !hayRecorrido}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Imprimir planilla
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Dato({ label, valor, alerta }: { label: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{label}</p>
      <p className={`font-mono text-sm font-bold ${alerta ? "text-warning" : "text-foreground"}`}>{valor}</p>
    </div>
  );
}
