// Sentry — inicialización del runtime Node (Route Handlers, Server Components, cron).
// Se carga desde instrumentation.ts (register). Inerte si no hay DSN (no rompe nada).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Los ERRORES se capturan siempre; esto es solo el muestreo de performance (0.1 = 10%).
  // Trazas de performance apagadas: instrumentar cada request suma CPU en TODAS las
  // invocaciones, y la CPU es el recurso al límite (ver instrumentation-client.ts). La
  // captura de errores no depende de esto y sigue igual.
  tracesSampleRate: 0,
  // No enviar datos personales del navegador por defecto (multi-tenant / datos financieros).
  sendDefaultPii: false,
});
