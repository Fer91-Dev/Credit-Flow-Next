"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { CheckCircle2, Circle, X, Rocket, ArrowRight } from "lucide-react";
import { useFinanciera } from "@/lib/swr";

const fetcher = (u: string) => fetch(u).then((r) => r.json()).then((j) => (j.ok ? j.data : null));
const KEY = "cf:primerospasos:oculto";

/**
 * Checklist de onboarding para el admin de una financiera nueva. Se auto-completa según los
 * datos reales (financiera configurada, primer cliente, primer crédito) y desaparece solo
 * cuando está todo hecho o el usuario lo oculta. Solo se monta para admin (desde el Home).
 */
export function PrimerosPasos() {
  const { financiera } = useFinanciera();
  const { data: dash } = useSWR<{ resumen?: { clientes_activos?: number; creditos_activos?: number } }>("/api/dashboard", fetcher);
  const [oculto, setOculto] = useState(false);
  useEffect(() => { if (localStorage.getItem(KEY) === "1") setOculto(true); }, []);

  const finOk = !!(financiera && (financiera.logo_url || financiera.razon_social || financiera.cuit));
  const cliOk = (dash?.resumen?.clientes_activos ?? 0) > 0;
  const creOk = (dash?.resumen?.creditos_activos ?? 0) > 0;

  const pasos = [
    { ok: finOk, label: "Cargá los datos de tu financiera", desc: "Nombre, CUIT y logo — se muestran en la app y en los comprobantes.", to: "/configuracion" },
    { ok: cliOk, label: "Cargá tu primer cliente", desc: "Ficha 360 con sus datos e ingresos.", to: "/clientes" },
    { ok: creOk, label: "Otorgá tu primer crédito", desc: "Simulá y otorgá con el motor de amortización.", to: "/creditos/nuevo" },
  ];
  const hechos = pasos.filter((p) => p.ok).length;

  if (oculto || hechos === pasos.length) return null;

  const ocultar = () => { localStorage.setItem(KEY, "1"); setOculto(true); };

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Primeros pasos</h3>
          <span className="text-[11px] text-muted-foreground">{hechos}/{pasos.length} listo</span>
        </div>
        <button onClick={ocultar} title="Ocultar" className="rounded-lg p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="space-y-1.5">
        {pasos.map((p, i) => (
          <li key={i}>
            <Link
              href={p.to}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${p.ok ? "opacity-60" : "hover:bg-primary/[0.06]"}`}
            >
              {p.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${p.ok ? "text-muted-foreground line-through" : "text-foreground"}`}>{p.label}</p>
                {!p.ok && <p className="text-xs text-muted-foreground">{p.desc}</p>}
              </div>
              {!p.ok && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
