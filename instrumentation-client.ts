// Sentry — inicialización del navegador (client). Next 15.3+ carga este archivo solo.
// Inerte si no hay DSN. Los eventos salen por el tunnel same-origin /monitoring (ver
// next.config.ts) → no chocan con el CSP ni con adblockers.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  /**
   * 🔴 Trazas de performance APAGADAS mientras dure el ajuste de cuota de Vercel.
   *
   * Los eventos del navegador salen por el túnel same-origin `/monitoring`, que es una
   * ruta de Next: **cada traza que sube es una invocación de función**. Con el muestreo en
   * 0,1 eso era una invocación extra cada diez navegaciones, encima del tráfico real.
   *
   * En 0 se dejan de mandar TRANSACCIONES, no errores: la captura de excepciones —que es
   * para lo que está Sentry acá— sigue funcionando igual. Se vuelve a subir cuando el
   * proyecto esté en el VPS y la CPU deje de ser el recurso escaso.
   */
  tracesSampleRate: 0,
  // Session Replay apagado (privacidad + cuota); se puede activar más adelante.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
});

// Instrumentación de navegación del App Router (requerido por Next 15.3+).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
