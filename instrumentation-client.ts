// Sentry — inicialización del navegador (client). Next 15.3+ carga este archivo solo.
// Inerte si no hay DSN. Los eventos salen por el tunnel same-origin /monitoring (ver
// next.config.ts) → no chocan con el CSP ni con adblockers.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Session Replay apagado (privacidad + cuota); se puede activar más adelante.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
});

// Instrumentación de navegación del App Router (requerido por Next 15.3+).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
