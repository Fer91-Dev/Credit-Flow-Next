import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// ── Security headers (OWASP A05) ─────────────────────────────────────────────
// La CSP NO está acá: se arma por request en `middleware.ts`, porque lleva un NONCE
// distinto en cada uno y un header estático no puede tener eso. Acá quedan los headers
// que sí son fijos. Si se agregara una CSP estática además, el navegador aplicaría las
// DOS y la más laxa no relajaría a la otra: los scripts tendrían que pasar ambas.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: false,
  devIndicators: {
    position: "bottom-right",
  },
  // Permite acceder al dev server a través de un túnel para compartir con el cliente.
  // Next.js 15 bloquea peticiones cross-origin a recursos internos (/_next, HMR)
  // si el origen no está autorizado. El túnel sirve la app desde un subdominio
  // distinto de localhost → hay que permitirlo explícitamente. Cubrimos los tres
  // proveedores posibles (VS Code Port Forwarding, ngrok, Cloudflare) para no
  // tener que reconfigurar según cuál se use. Solo aplica en desarrollo.
  allowedDevOrigins: ["*.devtunnels.ms", "*.ngrok-free.app", "*.trycloudflare.com"],
};

// Sentry (monitoreo de errores). El upload de source maps solo corre si están las envs
// SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN (build de producción); si faltan, se saltea
// sin romper. `tunnelRoute` enruta los eventos del navegador por /monitoring (same-origin)
// → esquiva el CSP (connect-src) y los adblockers. Inerte si no hay DSN.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  tunnelRoute: "/monitoring",
  disableLogger: true,
  widenClientFileUpload: true,
});
