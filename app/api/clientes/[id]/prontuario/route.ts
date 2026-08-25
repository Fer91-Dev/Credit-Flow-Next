import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import { formatCreditoNumero } from "@/lib/utils";
import {
  ordenarEventos, resumirProntuario, type EventoProntuario, ESTADO_CLIENTE_LABEL,
  normalizarEstadoCliente,
} from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/clientes/[id]/prontuario
 *
 * La historia del cliente con la financiera, armada desde los hechos que ya están
 * registrados. No lee ninguna tabla de "historial": no existe, y no debe existir (ver
 * lib/domain/prontuario.ts).
 *
 * Todo se resuelve en el SERVIDOR y no juntando lo que la ficha ya tiene a mano, porque la
 * ficha no trae acuerdos, ni consultas al bureau, ni la auditoría. Armarlo a medias en el
 * navegador daría una historia incompleta que parece completa.
 */
const TOPE = 200;

export const GET = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({
    where: { ...withTenant(tenantId), id },
    select: { id: true, estado: true, estado_motivo: true, estado_fecha: true },
  });
  if (!cliente) return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);

  // Anti-IDOR: el vendedor solo ve la historia de clientes con crédito propio. Se resuelve
  // sobre los créditos, que es donde vive la atribución.
  const scope = scopeCreditosVendedor({ role, vendedorId });
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), cliente_id: id },
    select: {
      id: true, numero: true, created_at: true, monto_original: true, estado: true,
      es_refinanciacion: true, refinancia_a: true, vendedor_id: true,
      otorgado_por_nombre: true, tipo_credito: true,
    },
    orderBy: { created_at: "desc" },
  });
  if (scope.vendedor_id && !creditos.some((c) => c.vendedor_id === scope.vendedor_id)) {
    return errorResponse("Sin acceso a este cliente", "FORBIDDEN", 403);
  }

  const creditoIds = creditos.map((c) => c.id);
  const origenes = await numerosRefinanciados(tenantId, creditos);
  const nro = (c: (typeof creditos)[number]) =>
    formatCreditoNumero(c.numero, c.es_refinanciacion && c.refinancia_a ? origenes.get(c.refinancia_a) ?? null : null);
  const nroDe = new Map(creditos.map((c) => [c.id, nro(c)]));

  const [pagos, acciones, acuerdos, bureau, auditoria] = await Promise.all([
    creditoIds.length
      ? prisma.pagos.findMany({
          where: { ...withTenant(tenantId), credito_id: { in: creditoIds } },
          select: { id: true, fecha: true, monto: true, metodo: true, anulado: true, anulado_motivo: true, credito_id: true, notas: true },
          orderBy: { fecha: "desc" },
          take: TOPE,
        })
      : Promise.resolve([]),
    creditoIds.length
      ? prisma.acciones_cobranza.findMany({
          where: { ...withTenant(tenantId), credito_id: { in: creditoIds } },
          select: { id: true, created_at: true, tipo: true, resultado: true, nota: true, automatico: true, promesa_estado: true, promesa_monto: true, promesa_fecha: true, credito_id: true },
          orderBy: { created_at: "desc" },
          take: TOPE,
        })
      : Promise.resolve([]),
    creditoIds.length
      ? prisma.acuerdos_pago.findMany({
          where: { ...withTenant(tenantId), credito_id: { in: creditoIds } },
          select: { id: true, fecha: true, monto_acordado: true, estado: true, credito_id: true, creado_por_nombre: true, cuotas: { select: { numero: true } } },
          orderBy: { fecha: "desc" },
        })
      : Promise.resolve([]),
    prisma.consultas_bureau.findMany({
      where: { ...withTenant(tenantId), cliente_id: id },
      select: { id: true, created_at: true, proveedor: true, situacion_bcra: true, usuario_nombre: true },
      orderBy: { created_at: "desc" },
      take: 20,
    }),
    /**
     * De la AUDITORÍA salen dos cosas que no viven en ninguna tabla propia:
     *
     *  - Cambios de ESTADO de la persona (`clientes` guarda el estado actual, no su historia).
     *  - Los CONTACTOS que no son de cobranza. Un mensaje de promoción o de información NO
     *    crea una `accion_cobranza` a propósito —contarlo engordaría el embudo y hundiría la
     *    tasa de conversión sin que nadie hubiera trabajado peor—, así que el único registro
     *    que queda es este. Sin leerlo acá, mandarle una oferta a un cliente no dejaba rastro
     *    en su historia: exactamente lo que reportó el usuario.
     */
    prisma.auditoria.findMany({
      where: { ...withTenant(tenantId), entidad: "clientes", entidad_id: id, accion: { in: ["actualizar", "contactar"] } },
      select: { id: true, created_at: true, descripcion: true, usuario_nombre: true, accion: true, meta: true },
      orderBy: { created_at: "desc" },
      take: 100,
    }),
  ]);

  const eventos: EventoProntuario[] = [];

  for (const c of creditos) {
    eventos.push({
      fecha: c.created_at.toISOString(),
      tipo: c.es_refinanciacion ? "refinanciacion" : "credito",
      titulo: c.es_refinanciacion
        ? `Se refinanció su deuda en ${nro(c)}`
        : `${nro(c)} · ${c.tipo_credito}`,
      monto: c.monto_original,
      credito: nro(c),
      actor: c.otorgado_por_nombre,
    });
  }

  for (const p of pagos) {
    eventos.push({
      fecha: p.fecha.toISOString(),
      tipo: p.anulado ? "pago_anulado" : "pago",
      titulo: p.anulado ? "Cobro anulado" : `Pagó por ${p.metodo}`,
      detalle: p.anulado ? p.anulado_motivo : p.notas,
      monto: p.monto,
      credito: nroDe.get(p.credito_id) ?? null,
      soloFecha: true, // `pagos.fecha` es @db.Date: ya es el día, no un instante
    });
  }

  for (const a of acciones) {
    const esPromesa = a.resultado === "promesa_pago";
    const rota = a.promesa_estado === "incumplida";
    eventos.push({
      fecha: a.created_at.toISOString(),
      tipo: esPromesa ? (rota ? "promesa_rota" : "promesa") : "gestion",
      titulo: esPromesa
        ? rota
          ? "No cumplió lo que prometió"
          : `Prometió pagar${a.promesa_fecha ? ` el ${a.promesa_fecha.toISOString().slice(0, 10).split("-").reverse().join("/")}` : ""}`
        : `${a.tipo} · ${a.resultado.replace(/_/g, " ")}`,
      detalle: a.nota,
      monto: esPromesa ? a.promesa_monto : null,
      credito: nroDe.get(a.credito_id) ?? null,
      // Las del cron no las hizo nadie: decir un nombre ahí sería atribuirle a una persona
      // un trabajo que hizo la máquina.
      actor: a.automatico ? "Automático" : null,
    });
  }

  for (const a of acuerdos) {
    eventos.push({
      fecha: a.fecha.toISOString(),
      tipo: a.estado === "roto" ? "acuerdo_roto" : "acuerdo",
      titulo: a.estado === "roto"
        ? "Se rompió el acuerdo de pago"
        : `Acordó pagar lo vencido en ${a.cuotas.length} cuota${a.cuotas.length === 1 ? "" : "s"}`,
      monto: a.monto_acordado,
      credito: nroDe.get(a.credito_id) ?? null,
      actor: a.creado_por_nombre,
      soloFecha: true, // `acuerdos_pago.fecha` es @db.Date
    });
  }

  for (const b of bureau) {
    eventos.push({
      fecha: b.created_at.toISOString(),
      tipo: "bureau",
      titulo: `Consulta a ${b.proveedor.toUpperCase()}`,
      detalle: b.situacion_bcra != null ? `Situación ${b.situacion_bcra}` : null,
      actor: b.usuario_nombre,
    });
  }

  for (const ev of auditoria) {
    const meta = ev.meta as {
      estado_nuevo?: string; estado_anterior?: string; motivo?: string;
      canal?: string; asunto?: string | null; gestion_id?: string | null;
    } | null;

    if (ev.accion === "contactar") {
      // Los de MORA ya entraron por `acciones_cobranza` (tienen `gestion_id`): si se
      // agregaran también desde acá, cada aviso de mora se vería dos veces.
      if (meta?.gestion_id) continue;
      eventos.push({
        fecha: ev.created_at.toISOString(),
        tipo: "contacto",
        titulo: ev.descripcion,
        // El asunto del mail dice de qué se trató; el cuerpo entero es ruido en una lista.
        detalle: meta?.asunto ?? null,
        actor: ev.usuario_nombre,
      });
      continue;
    }

    if (!meta?.estado_nuevo) continue; // del resto, solo los cambios de estado
    eventos.push({
      fecha: ev.created_at.toISOString(),
      tipo: "estado",
      titulo: `${ESTADO_CLIENTE_LABEL[normalizarEstadoCliente(meta.estado_anterior)]} → ${ESTADO_CLIENTE_LABEL[normalizarEstadoCliente(meta.estado_nuevo)]}`,
      detalle: meta.motivo ?? null,
      actor: ev.usuario_nombre,
    });
  }

  const ordenados = ordenarEventos(eventos);
  return successResponse({
    // El resumen se calcula sobre TODO, no sobre la página que se muestra: si no, el conteo
    // de promesas rotas cambiaría según cuánto se scrolleó.
    resumen: resumirProntuario(ordenados),
    eventos: ordenados.slice(0, TOPE),
    truncado: ordenados.length > TOPE,
    total: ordenados.length,
  });
});
