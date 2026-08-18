import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/cron/suscripciones  (protegido por CRON_SECRET, público en middleware)
 * Degrada las suscripciones Pro VENCIDAS: marca estado "vencida" y quita las features
 * premium del tenant (tenants.features = []). Es la "limpieza" persistente; la barrera en
 * caliente ya la aplica requireAuth (features efectivas = [] si el Pro venció).
 *
 * Idempotente: solo toca las Pro activas con periodo_hasta ya pasado.
 * Programación sugerida: 1 vez por día (Vercel Cron / Supabase / cron local).
 */
export async function POST(req: NextRequest) {
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
    select: { tenant_id: true },
  });

  let degradadas = 0;
  for (const s of vencidas) {
    await prisma.$transaction([
      prisma.suscripciones.update({ where: { tenant_id: s.tenant_id }, data: { estado: "vencida" } }),
      prisma.tenants.update({ where: { id: s.tenant_id }, data: { features: [] } }),
    ]);
    degradadas += 1;
  }

  return NextResponse.json({ ok: true, degradadas });
}
