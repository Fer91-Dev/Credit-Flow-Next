/**
 * Proveedor BCRA — Central de Deudores (API pública y gratuita del Banco Central).
 * Consulta por CUIT/CUIL la peor situación de deuda del titular en el sistema financiero
 * y sus cheques rechazados. No requiere credenciales ni contrato.
 *
 * Endpoints (v1.0):
 *   GET /CentralDeDeudores/v1.0/Deudas/{cuit}
 *   GET /CentralDeDeudores/v1.0/Deudas/ChequesRechazados/{cuit}
 *
 * La respuesta agrupa por período → entidades, cada una con `situacion` (1..6) y `monto`
 * (en miles de $). Tomamos la PEOR situación del período más reciente y la suma de montos.
 * Ante cualquier error de red/formato devolvemos ok:false (el motor sigue sin bureau).
 */
import type { SenalesBureau } from "@/lib/domain";
import type { ResultadoConsulta } from "./index";

const BASE = "https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas";

/** Deja solo los 11 dígitos del CUIT/CUIL. */
function normalizarCuit(cuit: string): string {
  return (cuit || "").replace(/\D/g, "");
}

async function getJson(url: string): Promise<any | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // La consulta no debe bloquear el flujo indefinidamente.
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null; // sin registros para ese CUIT
  if (!res.ok) throw new Error(`BCRA respondió ${res.status}`);
  return res.json();
}

export async function consultarBcra(cuitRaw: string): Promise<ResultadoConsulta> {
  const cuit = normalizarCuit(cuitRaw);
  if (cuit.length !== 11) {
    return { ok: false, proveedor: "bcra", mensaje: "CUIT/CUIL inválido (se requieren 11 dígitos).", senales: emptySenales() };
  }

  const [deudas, cheques] = await Promise.all([
    getJson(`${BASE}/${cuit}`),
    getJson(`${BASE}/ChequesRechazados/${cuit}`).catch(() => null),
  ]);

  // Peor situación + deuda total del período más reciente.
  let situacionBcra: number | null = null;
  let deudaSistemaFinanciero: number | null = null;
  const periodos = deudas?.results?.periodos;
  if (Array.isArray(periodos) && periodos.length > 0) {
    const entidades = periodos[0]?.entidades ?? [];
    for (const e of entidades) {
      const sit = Number(e?.situacion);
      if (!Number.isNaN(sit)) situacionBcra = Math.max(situacionBcra ?? 0, sit);
      const monto = Number(e?.monto);
      if (!Number.isNaN(monto)) deudaSistemaFinanciero = (deudaSistemaFinanciero ?? 0) + monto * 1000; // BCRA informa en miles
    }
  }

  // Cantidad de cheques rechazados sin regularizar.
  let chequesRechazados: number | null = null;
  const cheqPeriodos = cheques?.results?.causales ?? cheques?.results?.periodos;
  if (Array.isArray(cheqPeriodos)) {
    let total = 0;
    for (const c of cheqPeriodos) {
      const detalle = c?.entidades ?? c?.detalle ?? [];
      total += Array.isArray(detalle) ? detalle.length : 0;
    }
    chequesRechazados = total;
  }

  const senales: SenalesBureau = {
    situacionBcra: (situacionBcra as SenalesBureau["situacionBcra"]) ?? null,
    scoreExterno: null, // BCRA no da score
    chequesRechazados,
    deudaSistemaFinanciero,
  };

  const sinDatos = situacionBcra == null && chequesRechazados == null;
  return {
    ok: true,
    proveedor: "bcra",
    mensaje: sinDatos ? "Sin registros en la Central de Deudores." : undefined,
    senales,
    crudo: { deudas, cheques },
  };
}

function emptySenales(): SenalesBureau {
  return { situacionBcra: null, scoreExterno: null, chequesRechazados: null, deudaSistemaFinanciero: null };
}
