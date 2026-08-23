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
        /**
         * 🔴 Stub: Nosis y Veraz son servicios PAGOS y no se pueden integrar sin un contrato
         * y credenciales del cliente. No es algo que se destrabe escribiendo código.
         *
         * El mensaje que salía estaba escrito para un programador —"completá el provider en
         * lib/bureau/nosis.ts"— y se le mostraba al operador, que no tiene forma de actuar
         * sobre eso. Ahora dice qué falta y qué hacer mientras tanto.
         */
        return {
          ok: false,
          proveedor,
          mensaje: `${proveedor === "nosis" ? "Nosis" : "Veraz"} es un servicio pago: hace falta contratarlo y cargar las credenciales. Mientras tanto podés usar BCRA, que es gratuito, o «Cargar manual».`,
          senales: VACIO,
        };
      default:
        return { ok: false, proveedor, mensaje: "Proveedor desconocido", senales: VACIO };
    }
  } catch (e) {
    return { ok: false, proveedor, mensaje: e instanceof Error ? e.message : "Error consultando el bureau", senales: VACIO };
  }
}
