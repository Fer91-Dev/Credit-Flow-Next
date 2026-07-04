import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto del actor para la auditoría. Se establece un contenedor por request en
 * `withErrorHandler` (runWithAuditContext) ANTES de autenticar; `requireAuth` lo rellena
 * con setAuditActor y `registrarAuditoria` lo lee con getAuditActor. Runtime Node.
 *
 * POR QUÉ run() + contenedor mutable (y NO enterWith + valor): Next.js hace snapshotting
 * del contexto async y lo restaura alrededor de ciertos límites, lo que BORRA un
 * `enterWith` hecho a mitad del request → el actor salía siempre null. `run()` establece
 * un scope estable para toda la ejecución del handler (es lo que Next usa internamente);
 * como guardamos un contenedor mutable, rellenarlo desde requireAuth es visible después.
 */
export interface AuditActor {
  userId: string;
  nombre: string | null;
  email: string | null;
}

interface AuditStore {
  actor?: AuditActor;
}

// Singleton anclado en globalThis para sobrevivir además a la duplicación de módulos de
// Turbopack/HMR (mismo patrón que lib/prisma.ts): todas las copias comparten un único ALS.
const globalForAudit = globalThis as unknown as { __creditflowAuditStorage?: AsyncLocalStorage<AuditStore> };
const storage =
  globalForAudit.__creditflowAuditStorage ??
  (globalForAudit.__creditflowAuditStorage = new AsyncLocalStorage<AuditStore>());

/** Corre `cb` dentro de un contexto de auditoría fresco (un contenedor por request). */
export function runWithAuditContext<T>(cb: () => T): T {
  return storage.run({}, cb);
}

/** Fija el actor del request actual (rellena el contenedor de runWithAuditContext). */
export function setAuditActor(actor: AuditActor): void {
  const store = storage.getStore();
  if (store) store.actor = actor;
}

/** Actor del request actual, si está disponible. */
export function getAuditActor(): AuditActor | undefined {
  return storage.getStore()?.actor;
}
