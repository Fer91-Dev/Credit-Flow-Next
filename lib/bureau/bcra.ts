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

/**
 * 🔴 EL BCRA SE CAE SEGUIDO, Y NO ES NUESTRO PROBLEMA — PERO SÍ NUESTRO SÍNTOMA.
 *
 * Su API pública devuelve 503 (y a veces 502/504) de forma intermitente, sobre todo fuera
 * del horario bancario. Al primer intento fallido la pantalla mostraba "BCRA respondió 503"
 * y ahí terminaba: el operador no sabe si el cliente no tiene deudas, si escribió mal el
 * CUIT o si el organismo está caído, y el reintento manual queda a su criterio.
 *
 * Se reintenta hasta 3 veces con espera creciente. Solo ante fallas TRANSITORIAS (5xx,
 * timeout, red): un 404 es una respuesta válida —el CUIT no tiene registros— y un 400 no
 * mejora por insistir.
 */
const REINTENTOS = 3;
const ESPERA_MS = [400, 1200];

function esTransitorio(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any | null> {
  let ultimo: Error | null = null;

  for (let intento = 0; intento < REINTENTOS; intento++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        // La consulta no debe bloquear el flujo indefinidamente.
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) return null; // sin registros para ese CUIT
      if (res.ok) return await res.json();

      if (!esTransitorio(res.status)) {
        throw new Error(mensajeHumano(res.status));
      }
      ultimo = new Error(mensajeHumano(res.status));
    } catch (e) {
      // Timeout o red caída: también son transitorios. Un error ya traducido se respeta.
      ultimo = e instanceof Error ? e : new Error("Error desconocido consultando el BCRA");
      if (ultimo.message.startsWith("El CUIT")) throw ultimo;
    }
    if (intento < REINTENTOS - 1) await dormir(ESPERA_MS[intento] ?? 1200);
  }

  throw ultimo ?? new Error("No se pudo consultar el BCRA.");
}

/**
 * El código HTTP no le dice nada a quien está atendiendo a un cliente. Lo que necesita
 * saber es de quién es el problema y qué puede hacer mientras tanto.
 */
function mensajeHumano(status: number): string {
  if (esTransitorio(status)) {
    return "El BCRA no está respondiendo (es su servicio, no el tuyo). Probá de nuevo en unos minutos, o cargá las señales a mano con «Cargar manual».";
  }
  if (status === 400) return "El CUIT/CUIL no tiene un formato que el BCRA acepte.";
  if (status === 401 || status === 403) return "El BCRA rechazó la consulta.";
  return `El BCRA respondió un error (${status}).`;
}

export async function consultarBcra(cuitRaw: string): Promise<ResultadoConsulta> {
  const cuit = normalizarCuit(cuitRaw);
  if (cuit.length !== 11) {
    return { ok: false, proveedor: "bcra", mensaje: "CUIT/CUIL inválido (se requieren 11 dígitos).", senales: emptySenales() };
  }

  /**
   * La consulta de deudas es la que importa; la de cheques es complementaria y su caída no
   * puede tumbar la consulta entera (ya venía tolerada con `.catch`). Si la principal falla
   * tras los reintentos, se devuelve ok:false con el motivo en castellano en vez de dejar
   * que la excepción suba como "BCRA respondió 503".
   */
  let deudas: any = null;
  let cheques: any = null;
  try {
    [deudas, cheques] = await Promise.all([
      getJson(`${BASE}/${cuit}`),
      getJson(`${BASE}/ChequesRechazados/${cuit}`).catch(() => null),
    ]);
  } catch (e) {
    return {
      ok: false,
      proveedor: "bcra",
      mensaje: e instanceof Error ? e.message : "No se pudo consultar el BCRA.",
      senales: emptySenales(),
    };
  }

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
