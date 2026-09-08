/**
 * Backfill de la quita de campaña en los pagos ya registrados.
 *
 * `pagos.descuento_mora_pct` y `pagos.ahorro_mora` son columnas nuevas: los cobros hechos
 * antes las tienen en 0 aunque el descuento SÍ se haya aplicado. El dato existe —viajaba en
 * el `meta` del evento `registrar_pago` de la auditoría— así que se recupera de ahí en vez
 * de perderlo: sin esto, reimprimir el recibo de un cobro con quita mostraría la mora ya
 * descontada sin decir por qué, que es exactamente el problema que las columnas resuelven.
 *
 * Idempotente: solo escribe los pagos que están en 0 y cuya auditoría dice que hubo quita.
 *
 *   node --env-file=.env.local scripts/backfill-descuento-pagos.mjs
 *   node --env-file=.env.production.local scripts/backfill-descuento-pagos.mjs
 */
import { conectar } from "./_conexion.mjs";

const { prisma, donde } = conectar("backfill de quitas en pagos", { escribe: true });

const eventos = await prisma.auditoria.findMany({
  where: { entidad: "pagos", accion: "registrar_pago" },
  select: { entidad_id: true, meta: true },
});

let tocados = 0, sinQuita = 0, yaEstaban = 0;
for (const e of eventos) {
  const meta = e.meta ?? {};
  const ahorro = Number(meta.ahorro_mora ?? 0);
  const pct = Number(meta.descuento_mora_pct ?? 0);
  if (!(ahorro > 0)) { sinQuita++; continue; }

  const pago = await prisma.pagos.findUnique({
    where: { id: e.entidad_id },
    select: { id: true, ahorro_mora: true, credito: { select: { numero: true } } },
  });
  if (!pago) continue;
  if (pago.ahorro_mora > 0) { yaEstaban++; continue; }

  await prisma.pagos.update({
    where: { id: pago.id },
    data: { descuento_mora_pct: pct, ahorro_mora: ahorro },
  });
  tocados++;
  console.log("  ✓ CRD-%s · %s%% · $%s condonados", String(pago.credito?.numero ?? "?").padStart(6, "0"), pct, ahorro.toFixed(2));
}

console.log("\n%s: %s pago(s) actualizado(s), %s ya estaban, %s sin quita.", donde, tocados, yaEstaban, sinQuita);
await prisma.$disconnect();
