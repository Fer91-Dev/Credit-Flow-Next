import { formatMonto } from "@/lib/utils";
import { round2 } from "@/lib/domain";

/**
 * POR QUÉ EL PLAN DE CUOTAS SUMA UNA COSA Y EL ACUERDO CONSOLIDÓ OTRA — con la cuenta hecha.
 *
 * 🔴 EL PROBLEMA QUE RESUELVE. En CRD-000008 el panel del acuerdo dice que se consolidaron
 * $479.045,11 y la fila de totales del plan dice $454.670,16. Los dos números están bien
 * —son la misma deuda contada con piezas distintas— pero la pantalla lo explicaba con un
 * párrafo, y un párrafo no se puede verificar. Fernando, después de leerlo dos veces: "no
 * entiendo sinceramente, por eso te pido que sea lo más claro posible y que se refleje en la
 * pantalla" (14/09/2026).
 *
 * Así que se muestra la RESTA, con los tres importes que la componen, para que se siga con el
 * dedo y dé:
 *
 *     suma del plan          $454.670,16
 *   − interés del acuerdo    −$41.700,23   ← se sumó a las cuotas al firmar; no estaba en la deuda
 *   + punitorios al firmar   +$66.075,18   ← estaban en la deuda; el plan no los lleva nunca
 *   ─────────────────────────────────────
 *   = deuda consolidada      $479.045,11
 *
 * 🔴 Y SOLO SE MUESTRA SI CIERRA EXACTO. La cuenta de arriba vale mientras el plan no se haya
 * movido entre el otorgamiento y la firma: si el cliente pagó cuotas ANTES de acordar, lo que
 * se consolidó es lo que FALTABA, no el plan nominal, y el renglón de punitorios absorbería
 * esa diferencia y mentiría sobre cuánta mora había. En ese caso esto devuelve null y la
 * pantalla se queda con la explicación en palabras, que es vaga pero no es falsa.
 *
 * `moraPlan` es la mora DEVENGADA del plan (cobrada + pendiente), que es con la que hay que
 * comparar: la pendiente sola dejaría afuera la que ya entró y nunca cerraría.
 */
export interface PuenteDeuda {
  sumaPlan: number;
  interesAcuerdo: number;
  mora: number;
  deudaOriginal: number;
}

export function calcularPuenteDeuda(datos: {
  deudaOriginal: number;
  interesCapitalizado: number;
  sumaPlan: number;
  moraPlan: number;
}): PuenteDeuda | null {
  const { deudaOriginal, interesCapitalizado, sumaPlan, moraPlan } = datos;
  if (sumaPlan <= 0 || deudaOriginal <= 0) return null;
  // Lo que tendría que ser la mora para que la cuenta cierre.
  const implicita = round2(deudaOriginal - round2(sumaPlan - interesCapitalizado));
  // Si no coincide con la mora que el plan devengó, la cuenta no es la de este crédito.
  if (Math.abs(implicita - round2(moraPlan)) > 0.01) return null;
  return { sumaPlan, interesAcuerdo: interesCapitalizado, mora: round2(moraPlan), deudaOriginal };
}

function Fila({ signo, label, valor, tono }: {
  signo?: "mas" | "menos";
  label: string;
  valor: number;
  tono?: "warning" | "destructive";
}) {
  const color = tono === "warning" ? "text-warning" : tono === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs leading-snug text-muted-foreground">
        {signo && <span className={`mr-1 font-mono font-bold ${color}`}>{signo === "mas" ? "+" : "−"}</span>}
        {label}
      </span>
      <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${color}`}>
        {signo === "menos" ? "−" : signo === "mas" ? "+" : ""}{formatMonto(valor)}
      </span>
    </div>
  );
}

export function PuenteDeudaPanel({ puente, cuotasPlan }: { puente: PuenteDeuda; cuotasPlan: number }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Por qué el plan de cuotas suma otro número
      </p>
      <div className="mt-1.5 divide-y divide-border/40">
        <Fila
          label={`Suma de las ${cuotasPlan} cuotas del plan`}
          valor={puente.sumaPlan}
        />
        <Fila
          signo="menos"
          label="Interés del acuerdo, que se sumó a esas cuotas al firmar"
          valor={puente.interesAcuerdo}
          tono="warning"
        />
        <Fila
          signo="mas"
          label="Punitorios acumulados al firmar — el plan de cuotas nunca los incluye"
          valor={puente.mora}
          tono="destructive"
        />
        <div className="flex items-baseline justify-between gap-4 pt-2.5">
          <span className="text-sm font-semibold leading-snug text-foreground">Deuda que el acuerdo consolidó</span>
          <span className="shrink-0 font-mono text-base font-bold tabular-nums text-foreground">
            {formatMonto(puente.deudaOriginal)}
          </span>
        </div>
      </div>
    </div>
  );
}
