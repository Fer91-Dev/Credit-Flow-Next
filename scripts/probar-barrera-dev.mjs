/**
 * Prueba la barrera contra borrados masivos EN DEV, dentro de una transacción que se deshace
 * siempre: al terminar, dev queda exactamente como estaba (sin funciones, sin triggers, sin
 * una fila menos).
 *
 *   node --env-file=.env.local scripts/probar-barrera-dev.mjs
 *
 * Dev no tiene créditos después de un reset, así que se prueba sobre `clientes` con un límite
 * de prueba de 10: el mecanismo es el mismo para cualquier tabla y cualquier límite.
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";
import { FUNCIONES, triggersDe } from "./barrera-borrado.mjs";

const db = new PrismaClient();
let pruebas = 0, fallos = 0;
const ok = (c, t, d = "") => { pruebas++; if (!c) fallos++; console.log(`  ${c ? "OK   " : "FALLA"} ${t}${d ? "  ·  " + d : ""}`); };
const DESHACER = new Error("deshacer");

/** Corre `fn` en un SAVEPOINT: si falla, vuelve atrás solo ese paso y devuelve el mensaje. */
async function intento(tx, nombre, fn) {
  await tx.$executeRawUnsafe(`SAVEPOINT ${nombre}`);
  try { await fn(); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${nombre}`); return null; }
  catch (e) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${nombre}`); return String(e.message ?? e); }
}

const antes = await db.clientes.count();
console.log(`\n  BARRERA CONTRA BORRADOS MASIVOS · prueba en dev (${antes} clientes)\n`);

try {
  await db.$transaction(async (tx) => {
    for (const s of FUNCIONES) await tx.$executeRawUnsafe(s);
    for (const s of triggersDe("clientes", 10)) await tx.$executeRawUnsafe(s);

    const masivo = await intento(tx, "masivo", () => tx.$executeRawUnsafe(`DELETE FROM clientes`));
    ok(masivo?.includes("BARRERA"), `🔴 borrar los ${antes} clientes de una vez se RECHAZA`, (masivo ?? "¡se borró!").split("\n").find((l) => l.includes("BARRERA")) ?? masivo);
    ok((await tx.clientes.count()) === antes, "y no se borró ninguno", `${await tx.clientes.count()} clientes`);

    const trunc = await intento(tx, "trunc", () => tx.$executeRawUnsafe(`TRUNCATE clientes CASCADE`));
    ok(trunc?.includes("BARRERA"), "vaciar la tabla (TRUNCATE) se rechaza", trunc ? "rechazado" : "¡se vació!");

    const uno = await tx.clientes.findFirst({ select: { id: true } });
    const chico = await intento(tx, "chico", () => tx.$executeRawUnsafe(`DELETE FROM clientes WHERE id = $1::uuid`, uno.id));
    ok(chico === null, "borrar UNO (lo normal) sigue andando", chico ?? "permitido");

    throw DESHACER; // nada de esto queda: ni la fila borrada, ni las funciones, ni los triggers
  }, { timeout: 60_000 });
} catch (e) {
  if (e !== DESHACER) { console.error(e); fallos++; }
}

const despues = await db.clientes.count();
const [{ n }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'barrera_%'`);
ok(despues === antes && n === 0, "dev quedó exactamente como estaba", `${despues} clientes · ${n} triggers de barrera`);
await db.$disconnect();

console.log(`\n  ${fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
