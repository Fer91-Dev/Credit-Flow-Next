import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatea el número identificador de un crédito como `CRD-000123` (o `—` si no tiene). */
export function formatCreditoNumero(n?: number | null): string {
  if (n == null) return "—";
  return `CRD-${String(n).padStart(6, "0")}`;
}
