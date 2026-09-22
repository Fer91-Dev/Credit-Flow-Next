"use client";

import { teclaDelContenedor } from "@/lib/utils";

import { RotateCw } from "lucide-react";
import { Emoji } from "@/components/ui/Emoji";
import type { CuentaCaja, SaldoCuentaDetalle } from "@/lib/swr";

/**
 * Tarjeta de saldo de una cuenta (Efectivo / Banco / Dólares).
 *
 * Es UNA sola definición usada por la caja del administrador (`CajaView`) y por la del
 * vendedor (`MiCajaView`). Antes cada vista tenía la suya y habían divergido: la del
 * vendedor quedó sin gradiente, sin el refresh por cuenta y sin el desglose. Con el
 * componente compartido, un cambio de diseño llega a las dos o a ninguna.
 */

export const CUENTAS: CuentaCaja[] = ["efectivo", "banco", "dolares"];

export const CUENTA_META: Record<CuentaCaja, { label: string; icon: string; prefix: string }> = {
  efectivo: { label: "Efectivo", icon: "money-bag",      prefix: "$" },
  banco:    { label: "Banco",    icon: "bank",           prefix: "$" },
  dolares:  { label: "Dólares",  icon: "dollar-banknote", prefix: "u$s" },
};

/** Gradiente por cuenta: es el código de color con el que se leen las tres de un vistazo. */
const CUENTA_GRADIENTE: Record<CuentaCaja, string> = {
  efectivo: "linear-gradient(135deg, #10b981 0%, #0d9488 100%)",
  banco:    "linear-gradient(135deg, #818cf8 0%, #4f46e5 100%)",
  dolares:  "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
};

/** Montos con centavos: son cifras que el usuario va a querer cuadrar contra sus partes. */
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(x);
}

export function CuentaCard({
  cuenta, detalle, activa, onToggle, onRefrescar, refrescando = false,
  valorizacionDolares, dolarBlue, desde, compacta = false,
}: {
  cuenta: CuentaCaja;
  detalle: SaldoCuentaDetalle;
  /** Inicio del período filtrado (YYYY-MM-DD): "Anterior" es el saldo del día previo. */
  desde?: string;
  /** La tarjeta filtra la tabla; `activa` = ese filtro está puesto. */
  activa: boolean;
  onToggle: () => void;
  onRefrescar: () => void;
  refrescando?: boolean;
  valorizacionDolares?: number | null;
  dolarBlue?: number | null;
  /**
   * Versión chica, para cuando la cuenta NO es el dato principal de la pantalla.
   *
   * En la caja del administrador estas tres tarjetas eran lo más grande, y lo que de verdad
   * se mira ahí es cuánta plata hay en total y cuánta está en la calle; el reparto entre
   * efectivo, banco y dólares es el detalle de eso. Fernando (21/09/2026): "a las cajas
   * efectivo, banco y dólares dales menor tamaño". Conservan su color, su refresh y el
   * filtro —siguen siendo el mismo control—, pero ocupan la mitad y el desglose del
   * período pasa a una sola línea.
   *
   * En la caja del VENDEDOR siguen grandes: ahí sí son el dato principal de la pantalla.
   */
  compacta?: boolean;
}) {
  const meta = CUENTA_META[cuenta];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (teclaDelContenedor(e) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(); } }}
      title={activa ? "Quitar filtro" : `Ver solo ${meta.label}`}
      style={{ backgroundImage: CUENTA_GRADIENTE[cuenta] }}
      className={`group relative overflow-hidden text-left text-white shadow-lg shadow-black/20 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        compacta ? "rounded-xl p-3.5" : "rounded-2xl p-5"
      } ${activa ? "ring-2 ring-white/80 ring-offset-2 ring-offset-background" : "hover:brightness-105"}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-white/80">{meta.label}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRefrescar(); }}
            title="Actualizar esta caja"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-white/15 text-white/90 hover:bg-white/30 active:scale-90 transition-all"
          >
            <RotateCw className={`h-3.5 w-3.5 ${refrescando ? "animate-spin" : ""}`} />
          </button>
          <Emoji name={meta.icon} className="h-4 w-4" />
        </div>
      </div>

      <p className={`font-bold font-mono tabular-nums tracking-tight ${compacta ? "mt-1.5 text-lg" : "mt-3 text-2xl"}`}>
        {meta.prefix} {n2(detalle.saldo)}
      </p>
      {cuenta === "dolares" && valorizacionDolares != null && (
        <p className="mt-1 text-[11px] font-mono text-white/75">
          ≈ ${n0(valorizacionDolares)}
          {dolarBlue != null && <span className="text-white/50"> · blue ${n0(dolarBlue)}</span>}
        </p>
      )}

      <div className={`h-px w-full bg-white/20 ${compacta ? "my-2.5" : "my-4"}`} />

      {compacta ? (
        /* Una línea: el saldo con el que se arrancó y el movimiento del período. Los tres
           datos siguen estando —no se esconde ninguno—, pero ocupan un renglón. */
        /* Dos renglones y no uno: en la franja de cinco tarjetas cada una queda angosta, y
           tres importes de nueve cifras en una sola línea se parten donde caiga. */
        <div className="space-y-1 font-mono text-[10px] tabular-nums">
          <div className="flex items-baseline justify-between gap-2 text-white/70">
            <span>{desde ? `Al ${diaPrevio(desde)}` : "Anterior"}</span>
            <span>{meta.prefix}{n2(detalle.anterior)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-white/90">
            <span>↑ {n2(detalle.ingresos)}</span>
            <span>↓ {n2(detalle.egresos)}</span>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-3 gap-2">
        <div>
          {/* "Anterior" sin fecha no dice contra qué se compara: es el saldo al cierre del
              día previo al período que está filtrado. */}
          <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">{desde ? `Al ${diaPrevio(desde)}` : "Anterior"}</p>
          <p className="mt-0.5 text-[11px] font-mono font-semibold text-white/90">{meta.prefix}{n2(detalle.anterior)}</p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Ingresos</p>
          <p className="mt-0.5 text-[11px] font-mono font-semibold text-white/90">↑ {n2(detalle.ingresos)}</p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Egresos</p>
          <p className="mt-0.5 text-[11px] font-mono font-semibold text-white/90">↓ {n2(detalle.egresos)}</p>
        </div>
      </div>
      )}
    </div>
  );
}

/** "2026-09-01" → "31/08" (el día anterior, en dd/mm). */
function diaPrevio(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
