import { requireAuth, requireRole, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { nombreCompleto } from "@/lib/utils";
import { enriquecerClientes, kpisClientes, type FiltroClientes } from "@/lib/clientes-agregado";
import { normalizarCuit, validarDuplicadoCliente } from "@/lib/clientes-validacion";
import type { NextRequest } from "next/server";

/**
 * GET /api/clientes
 * Retorna lista de clientes del usuario autenticado.
 * Query params opcionales:
 * - ?q=perez — BUSCA por nombre, apellido o documento (ver abajo)
 * - ?estado=activo — filtrar por estado
 * - ?filtro=enfriados|riesgo|nuevos — los recortes que encienden los KPI de la pantalla
 * - ?limit=10 — paginación (defecto 100)
 * - ?offset=0 — paginación
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireAuth(req);

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  // El scoring derivado (3 queries extra) solo se calcula si se pide explícitamente.
  // Así los pickers de cliente (créditos, pagos) y el resto traen la lista liviana.
  const scored = url.searchParams.get("scored") === "true";
  const q = (url.searchParams.get("q") ?? "").trim();
  const filtroRaw = url.searchParams.get("filtro");
  const filtro: FiltroClientes =
    filtroRaw === "enfriados" || filtroRaw === "riesgo" || filtroRaw === "nuevos" ? filtroRaw : null;

  const where: Record<string, any> = { ...withTenant(tenantId) };
  if (estado) {
    where.estado = estado;
  }

  /**
   * 🔴 LA BÚSQUEDA SE HACE ACÁ, NO EN EL NAVEGADOR.
   *
   * La pantalla de Clientes filtraba en memoria la lista que recibía — y esa lista es una
   * PÁGINA (`limit`, ordenada por `created_at desc`; hoy la pantalla pide 1000). O sea que
   * buscar por DNI recorría solo lo que hubiera entrado: pasado ese tope, un cliente viejo
   * dejaba de aparecer y la pantalla decía "Sin coincidencias", exactamente igual que si no
   * existiera — sin error y sin aviso. Con la búsqueda acá, el tope deja de aplicar a
   * ENCONTRAR gente: se escanea toda la tabla y `total` dice cuántos matchean de verdad.
   *
   * El documento se compara también en su forma "solo dígitos": el operador tipea 20123456
   * y en la base puede estar "20.123.456".
   */
  if (q) {
    const digitos = q.replace(/\D/g, "");
    where.OR = [
      { nombre:    { contains: q, mode: "insensitive" } },
      { apellido:  { contains: q, mode: "insensitive" } },
      { documento: { contains: q, mode: "insensitive" } },
      ...(digitos.length >= 2 ? [{ documento: { contains: digitos } }] : []),
    ];
  }

  /**
   * Los recortes de los KPI son DERIVADOS (el último movimiento y el score no son columnas),
   * así que no hay forma de filtrarlos en SQL: se resuelven en el agregado y lo que vuelve son
   * los ids. Se paga el costo solo cuando el operador clickea un KPI, no en cada búsqueda.
   */
  if (filtro) {
    const { ids } = await kpisClientes(tenantId);
    where.id = { in: ids[filtro] };
  }

  const [clientesRows, total] = await Promise.all([
    prisma.clientes.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.clientes.count({ where }),
  ]);

  const clientes = scored ? await enriquecerClientes(tenantId, clientesRows) : clientesRows;

  return successResponse({
    clientes,
    total,
    limit,
    offset,
  });
});


/**
 * POST /api/clientes
 * Crea un nuevo cliente.
 * Body requerido:
 * {
 *   "nombre": "string",
 *   "documento": "string (optional)",
 *   "email": "string (optional)",
 *   "telefono": "string (optional)",
 *   "direccion": "string (optional)"
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  // Alta de clientes: admin y vendedor (el cobrador es solo-lectura sobre clientes).
  const { tenantId } = await requireRole(["admin", "vendedor"], req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar campos requeridos
  if (!body.nombre || typeof body.nombre !== "string") {
    return errorResponse(
      "Campo 'nombre' requerido (string)",
      "INVALID_INPUT",
      400
    );
  }

  // Validar email si se proporciona
  if (body.email && !isValidEmail(body.email)) {
    return errorResponse("Email inválido", "INVALID_INPUT", 400);
  }

  /*
    🔴 EL SUELDO ES OBLIGATORIO, Y LA BARRERA VA ACÁ.

    `ClienteForm` ya lo exigía, pero solo en el navegador: este endpoint aceptaba el alta sin
    ingreso y lo guardaba en null. Y un cliente sin sueldo deja MUDO al motor de riesgo — la
    capacidad de pago da cero, y el ratio cuota/ingreso y el múltiplo de ingreso no llegan a
    correr (ver `accionSinIngreso` en lib/domain/riesgo.ts). O sea que el agujero no era de
    prolijidad: era la forma de entrar un cliente que el motor no puede evaluar.

    Los 86 migrados del Excel de Silvio están exentos por diseño y no pasan por acá: se
    cargaron directo contra la base. Este endpoint solo crea clientes nuevos.
  */
  const ingresoAlta = numOrNull(body.ingreso_mensual);
  if (ingresoAlta == null || ingresoAlta <= 0) {
    return errorResponse(
      "El ingreso mensual es obligatorio y tiene que ser mayor a cero: sin él no se puede evaluar la capacidad de pago.",
      "INGRESO_REQUERIDO",
      400,
    );
  }

  // Unicidad por CUIT/CUIL (en AR puede haber DNI repetidos). Si el DNI ya existe,
  // se exige el CUIT para diferenciar a la persona.
  const doc = body.documento?.trim() || null;
  const cuit = normalizarCuit(body.cuit_cuil);
  const dupError = await validarDuplicadoCliente(tenantId, doc, cuit, null);
  if (dupError) return dupError;

  // Crear cliente
  const cliente = await prisma.clientes.create({
    data: {
      nombre: body.nombre.trim(),
      apellido: body.apellido?.trim() || null,
      documento: body.documento?.trim() || null,
      email: body.email?.toLowerCase().trim() || null,
      telefono: body.telefono?.trim() || null,
      direccion: body.direccion?.trim() || null,
      zona: body.zona?.trim() || null,
      estado: body.estado || "activo",
      tipo_credito: body.tipo_credito || "personal",
      // Datos personales ampliados
      fecha_nacimiento: body.fecha_nacimiento ? new Date(body.fecha_nacimiento) : null,
      cuit_cuil: cuit,
      estado_civil: body.estado_civil?.trim() || null,
      nacionalidad: body.nacionalidad?.trim() || null,
      // Domicilio estructurado (georef + CP manual)
      provincia: body.provincia?.trim() || null,
      localidad: body.localidad?.trim() || null,
      codigo_postal: body.codigo_postal?.trim() || null,
      tipo_domicilio: body.tipo_domicilio?.trim() || null,
      piso: body.piso?.trim() || null,
      depto: body.depto?.trim() || null,
      // Situación laboral
      situacion_laboral: body.situacion_laboral?.trim() || null,
      ocupacion: body.ocupacion?.trim() || null,
      empleador: body.empleador?.trim() || null,
      antiguedad_laboral_meses: numOrNull(body.antiguedad_laboral_meses, true),
      // Ingresos
      ingreso_mensual: ingresoAlta,
      otros_ingresos: numOrNull(body.otros_ingresos),
      // Consentimiento para consulta a bureaus (Ley 25.326)
      consentimiento_bureau: body.consentimiento_bureau === true,
      // Contacto laboral
      telefono_laboral: body.telefono_laboral?.trim() || null,
      direccion_laboral: body.direccion_laboral?.trim() || null,
      ...withTenant(tenantId),
    },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: cliente.id,
    accion: "crear",
    descripcion: `Cliente creado: ${nombreCompleto(cliente)}`,
  });

  return successResponse(cliente, 201);
});

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/** Normaliza un valor numérico opcional del body (string o number) a número o null. */
function numOrNull(value: unknown, integer = false): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(n)) return null;
  return integer ? Math.trunc(n) : n;
}
