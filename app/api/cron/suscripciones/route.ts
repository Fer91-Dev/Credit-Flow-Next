import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/app/lib/api";
import { registrarAuditoria } from "@/lib/audit";

/**
 * POST /api/cron/suscripciones  (protegido por CRON_SECRET, público en middleware)
 * Degrada las suscripciones Pro VENCIDAS: marca estado "vencida" y quita las features
 * premium del tenant (tenants.features = []). Es la "limpieza" persistente; la barrera en
 * caliente ya la aplica requireAuth (features efectivas = [] si el Pro venció).
 *
 * Idempotente: solo toca las Pro activas con periodo_hasta ya pasado.
 * Programación sugerida: 1 vez por día (Vercel Cron / Supabase / cron local).
 *
 * Va envuelto en `withErrorHandler` como el resto de los crons: era el único sin el wrapper,
 * así que sus 500 no llegaban a Sentry y el job podía romperse noche tras noche en silencio.
 * El actor de auditoría queda en null y está bien — no lo dispara una persona.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  /**
   * 🔴 FAIL-CLOSED. Antes era `if (cronSecret) { ...comparar... }`: si la variable no estaba
   * definida **no se comparaba nada y el handler seguía**. Esta ruta está en PUBLIC_PATHS
   * del middleware, así que no hay ninguna otra barrera detrás — una `CRON_SECRET` borrada,
   * un entorno nuevo o una rotación a medias dejaban el endpoint abierto a internet sin que
   * nada fallara ni avisara. Y este handler escribe cross-tenant a propósito.
   *
   * La comodidad de desarrollo se conserva, pero acotada a que NO sea producción.
   */
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
    }
  } else {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const ahora = new Date();
  const vencidas = await prisma.suscripciones.findMany({
    where: { plan: "pro", estado: "activa", periodo_hasta: { not: null, lt: ahora } },
    select: { tenant_id: true, periodo_hasta: true },
  });

  let degradadas = 0;
  for (const s of vencidas) {
    /**
     * Se guardan las features ANTES de vaciarlas: son lo único que permite reponer el plan
     * tal como estaba si la financiera renueva, y después del update no quedan en ningún lado.
     */
    const antes = await prisma.tenants.findUnique({
      where: { id: s.tenant_id },
      select: { nombre: true, features: true },
    });

    await prisma.$transaction([
      prisma.suscripciones.update({ where: { tenant_id: s.tenant_id }, data: { estado: "vencida" } }),
      prisma.tenants.update({ where: { id: s.tenant_id }, data: { features: [] } }),
    ]);
    degradadas += 1;

    /**
     * 🔴 Apagarle las funciones pagas a una financiera es el cambio más visible que hace el
     * sistema sin que nadie lo pida, y no dejaba ni una línea escrita. Cuando el cliente
     * llama porque "se le apagó el módulo", esto es lo único que explica qué pasó y cuándo.
     */
    await registrarAuditoria({
      tenantId: s.tenant_id,
      entidad: "plataforma",
      entidadId: s.tenant_id,
      accion: "actualizar",
      descripcion:
        `Plan Pro vencido el ${s.periodo_hasta?.toISOString().slice(0, 10)}: la suscripción pasó a "vencida"` +
        ((antes?.features?.length ?? 0) > 0 ? ` y se dieron de baja las funciones ${antes!.features.join(", ")}` : ""),
      meta: { automatico: true, features_retiradas: antes?.features ?? [], periodo_hasta: s.periodo_hasta },
    });
  }

  return NextResponse.json({ ok: true, degradadas });
});
