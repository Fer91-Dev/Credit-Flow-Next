/**
 * Bureau de crédito — abstracción de proveedor (server-only). Cada proveedor normaliza su
 * respuesta a `SenalesBureau` (lo que consume el motor `evaluarOriginacion`). El motor de
 * riesgo no sabe de HTTP ni de credenciales; eso vive acá.
 *
 * Proveedores:
 *  - bcra   → real, GRATIS (Central de Deudores, API pública). No requiere credenciales.
 *  - nosis  → stub listo para credenciales (contrato del cliente).
 *  - veraz  → stub listo para credenciales.
 *  - manual → el analista carga los valores a mano (no hay llamada externa).
 */
import type { SenalesBureau } from "@/lib/domain";
import type { BureauConfig, BureauProveedor } from "@/lib/domain";
import { consultarBcra } from "./bcra";

export interface ResultadoConsulta {
  ok: boolean;
  proveedor: BureauProveedor;
  mensaje?: string;
  senales: SenalesBureau;
  crudo?: unknown;
}

const VACIO: SenalesBureau = {
  situacionBcra: null,
  scoreExterno: null,
  chequesRechazados: null,
  deudaSistemaFinanciero: null,
};

/**
 * Ejecuta una consulta al proveedor indicado. `manual` recibe las señales ya cargadas
 * por el analista (no hace llamada externa). Nunca lanza: ante error devuelve ok:false.
 */
export async function consultarBureau(
  proveedor: BureauProveedor,
  cuit: string,
  opts: { config?: BureauConfig; senalesManual?: SenalesBureau } = {},
): Promise<ResultadoConsulta> {
  try {
    switch (proveedor) {
      case "bcra":
        return await consultarBcra(cuit);
      case "manual":
        return { ok: true, proveedor, senales: { ...VACIO, ...(opts.senalesManual ?? {}) } };
      case "nosis":
      case "veraz":
        // Stub: la integración real se activa cuando el cliente aporte contrato + credenciales.
        return {
          ok: false,
          proveedor,
          mensaje: `Proveedor ${proveedor} aún no integrado. Configurá credenciales y completá el provider en lib/bureau/${proveedor}.ts.`,
          senales: VACIO,
        };
      default:
        return { ok: false, proveedor, mensaje: "Proveedor desconocido", senales: VACIO };
    }
  } catch (e) {
    return { ok: false, proveedor, mensaje: e instanceof Error ? e.message : "Error consultando el bureau", senales: VACIO };
  }
}
