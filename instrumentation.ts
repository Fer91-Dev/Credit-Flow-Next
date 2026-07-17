// Next.js instrumentation hook. Carga la config de Sentry del runtime correspondiente
// y expone onRequestError para que los errores no capturados de RSC/Route Handlers
// lleguen a Sentry con el contexto del request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
