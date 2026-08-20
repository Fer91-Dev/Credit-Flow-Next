import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { assertPuedeAcordar } from "@/lib/recupero-server";
import { getCobranzaConfig } from "@/lib/config";
import { crearAcuerdo, anularAcuerdo, evaluarAcuerdoPersistido, serializarAcuerdo, sincronizarAcuerdos } from "@/lib/acuerdos";
import { ESTADOS_ACUERDO } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";
import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/acuerdos?estado=vigente|cumplido|roto|anulado
 * Acuerdos de pago del tenant. El vendedor ve solo los de SUS créditos (anti-IDOR).
 *
 * Antes de listar se sincroniza el estado contra lo cobrado: si no, un acuerdo que el
 * cliente terminó de pagar ayer seguiría figurando como vigente hasta que corra el cron.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

  await sincronizarAcuerdos({ tenantId });

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");

  const where: Prisma.acuerdos_pagoWhereInput = { ...withTenant(tenantId) };
  if (estado && (ESTADOS_ACUERDO as readonly string[]).includes(estado)) where.estado = estado;

  const scope = scopeCreditosVendedor({ role, vendedorId });
  if (scope.vendedor_id) where.credito = { vendedor_id: scope.vendedor_id };

  const acuerdos = await prisma.acuerdos_pago.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: 200,
    include: {
      cuotas: { orderBy: { numero: "asc" } },
      credito: { select: { numero: true, cliente: { select: { nombre: true, apellido: true, documento: true } } } },
    },
  });

  const hoy = hoyComercial();
  const salida = await Promise.all(
    acuerdos.map(async (a) => {
      const ev = a.estado === "vigente" ? await evaluarAcuerdoPersistido(tenantId, a, hoy) : undefined;
      return serializarAcuerdo(a, ev);
    }),
  );

  const vigentes = await prisma.acuerdos_pago.count({ where: { ...withTenant(tenantId), estado: "vigente" } });

  return successResponse({ acuerdos: salida, vigentes });
});

/**
 * POST /api/cobranza/acuerdos
 * Arma un acuerdo de pago sobre la deuda VENCIDA de un crédito.
 * Body: { credito_id, cuotas, quita?, primer_vencimiento?, notas? }
 *
 * El vendedor puede armarlo sobre sus propios créditos; la quita que puede otorgar la
 * define la configuración de la financiera (por defecto: ninguna).
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

  let body: { credito_id?: string; cuotas?: number; quita?: number; primer_vencimiento?: string; notas?: string; autorizacion_admin?: boolean };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.credito_id) return errorResponse("Falta el crédito", "INVALID_INPUT", 400);

  // Anti-IDOR: el vendedor solo acuerda sobre sus créditos. Se verifica ANTES de leer la
  // deuda, para no filtrar por diferencia de errores el saldo de un crédito ajeno.
  const scope = scopeCreditosVendedor({ role, vendedorId });
  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id: body.credito_id, ...scope },
    select: { id: true },
  });
  if (!credito) return errorResponse("El crédito no existe", "NOT_FOUND", 404);

  let primerVencimiento: Date | undefined;
  if (body.primer_vencimiento) {
    primerVencimiento = new Date(`${body.primer_vencimiento}T00:00:00.000Z`);
    if (Number.isNaN(primerVencimiento.getTime())) {
      return errorResponse("Fecha del primer vencimiento inválida", "FECHA_INVALIDA", 400);
    }
    if (primerVencimiento < hoyComercial()) {
      return errorResponse("El primer vencimiento no puede ser anterior a hoy", "FECHA_INVALIDA", 400);
    }
  }

  // Escalera de recupero: si la financiera exige haber contactado antes, o un mínimo de
  // atraso, se corta acá. Con la política en sus defaults esto nunca bloquea.
  const { recupero } = await getCobranzaConfig(tenantId);
  await assertPuedeAcordar(tenantId, body.credito_id, recupero, { role, autorizacionAdmin: body.autorizacion_admin === true });

  const acuerdo = await crearAcuerdo({
    tenantId,
    creditoId: body.credito_id,
    cuotas: Number(body.cuotas),
    quita: body.quita,
    primerVencimiento,
    notas: body.notas,
    esAdmin: role === "admin",
    vendedorId: vendedorId ?? null,
  });

  return successResponse(serializarAcuerdo({ ...acuerdo, credito: null }), 201);
});

/**
 * PATCH /api/cobranza/acuerdos?id=...
 * Anula un acuerdo vigente (error de carga o renegociación). Body: { motivo }
 *
 * No existe "marcar como cumplido" a mano: el cumplimiento se DERIVA de los pagos. Un
 * botón para darlo por cumplido sería un botón para decir que cobraste sin haber cobrado.
 */
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return errorResponse("Falta el id del acuerdo", "INVALID_INPUT", 400);

  let body: { motivo?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const scope = scopeCreditosVendedor({ role, vendedorId });
  if (scope.vendedor_id) {
    const propio = await prisma.acuerdos_pago.findFirst({
      where: { ...withTenant(tenantId), id, credito: { vendedor_id: scope.vendedor_id } },
      select: { id: true },
    });
    if (!propio) return errorResponse("El acuerdo no existe", "NOT_FOUND", 404);
  }

  await anularAcuerdo(tenantId, id, body.motivo ?? "");
  return successResponse({ id, estado: "anulado" });
});
