// Sentry — inicialización del runtime Edge (middleware). Inerte si no hay DSN.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Trazas de performance apagadas: instrumentar cada request suma CPU en TODAS las
  // invocaciones, y la CPU es el recurso al límite (ver instrumentation-client.ts). La
  // captura de errores no depende de esto y sigue igual.
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
