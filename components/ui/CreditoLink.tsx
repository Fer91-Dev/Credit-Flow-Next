"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { formatCreditoNumero } from "@/lib/utils";

/**
 * El número de un crédito, clickeable, hacia su pantalla (`/creditos/[id]`).
 *
 * ── POR QUÉ ES UN COMPONENTE Y NO UN `<a>` EN CADA LADO ──
 *
 * El número de crédito se escribe en una decena de pantallas —la ficha del cliente, el
 * detalle de cobranza, la agenda del día, refinanciar, la comparación— y en todas era texto
 * muerto: para ver contra qué se estaba decidiendo había que salir, ir a Créditos y buscarlo
 * a mano. Con un solo componente, el enlace se ve y se comporta igual en todas, y el día que
 * cambie la ruta cambia en un lugar.
 *
 * ── ABRE EN PESTAÑA NUEVA, SIEMPRE ──
 *
 * Casi todos los lugares donde aparece son un trabajo en curso: un formulario de
 * refinanciación a medio completar, un cobro que se está registrando, un diálogo abierto
 * sobre una lista filtrada. Navegar en la misma pestaña tiraría eso, y peor: unas veces sí y
 * otras no, según de dónde se hizo clic. Una sola regla —abre al lado— es predecible, no
 * pierde nada y el ícono lo anuncia antes de apretar.
 *
 * `id` opcional: en algunas vistas el número viaja sin el id del crédito (viene de un
 * snapshot). Ahí se muestra el número tal cual, sin link, en vez de un enlace roto.
 */
export function CreditoLink({
  id, numero, numeroOrigen, className = "", conIcono = true,
}: {
  id?: string | null;
  numero?: number | null;
  /** Número del crédito refinanciado, si lo hay: hace que se muestre REF-XXXXXX. */
  numeroOrigen?: number | null;
  className?: string;
  /** Apagar el ícono donde el espacio es mínimo (un chip dentro de una fila de lista). */
  conIcono?: boolean;
}) {
  const texto = formatCreditoNumero(numero ?? null, numeroOrigen ?? null);
  if (!id) return <span className={`font-mono ${className}`}>{texto}</span>;
  return (
    <Link
      href={`/creditos/${id}`}
      target="_blank"
      rel="noopener"
      title="Ver este crédito en otra pestaña"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 font-mono text-primary underline-offset-2 transition-colors hover:underline ${className}`}
    >
      {texto}
      {conIcono && <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />}
    </Link>
  );
}
