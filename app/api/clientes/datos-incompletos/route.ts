import { requireRole } from "@/lib/auth";
import { withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getFinanciera } from "@/lib/financiera";
import { generarPlanillaPDF, cuantoFalta, type ClienteIncompleto } from "@/lib/pdf/clientes-incompletos";
import type { NextRequest } from "next/server";

/**
 * GET /api/clientes/datos-incompletos
 * Planilla imprimible (PDF) de los clientes a los que les faltan datos para poder firmar
 * un contrato de crédito.
 *
 * Es una hoja de trabajo: se imprime, se completa a mano visitando o llamando al cliente,
 * y después se cargan los datos. Solo admin — es información de toda la cartera.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const clientes = await prisma.clientes.findMany({
    where: { ...withTenant(tenantId), estado: { not: "inactivo" } },
    select: {
      id: true, nombre: true, apellido: true, documento: true,
      direccion: true, localidad: true, provincia: true, telefono: true,
    },
  });

  // Solo los que efectivamente les falta algo: imprimir a los completos sería gastar
  // papel en filas que no hay que trabajar.
  const incompletos = (clientes as ClienteIncompleto[]).filter((c) => cuantoFalta(c) > 0);

  const financiera = await getFinanciera(tenantId);
  const pdf = await generarPlanillaPDF({
    clientes: incompletos,
    financiera: { nombre: financiera.nombre },
    totalAnalizados: clientes.length,
  });

  const hoy = new Date().toISOString().slice(0, 10);
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="clientes-datos-incompletos-${hoy}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
