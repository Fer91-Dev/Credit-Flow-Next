import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto del actor para la auditoría. Se setea una sola vez al autenticar
 * (requireAuth) y `registrarAuditoria` lo lee solo, así no hace falta pasar el
 * usuario por cada llamada. Runtime Node (las rutas usan Prisma → Node).
 */
export interface AuditActor {
  userId: string;
  nombre: string | null;
  email: string | null;
}

const storage = new AsyncLocalStorage<AuditActor>();

/** Fija el actor para el resto del request actual (propaga a los await siguientes). */
export function setAuditActor(actor: AuditActor): void {
  storage.enterWith(actor);
}

/** Actor del request actual, si está disponible. */
export function getAuditActor(): AuditActor | undefined {
  return storage.getStore();
}
