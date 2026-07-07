import type { NextConfig } from "next";

// ── Security headers (OWASP A05) ─────────────────────────────────────────────
// CSP afinada para Next + Supabase. script/style con 'unsafe-inline'/'unsafe-eval'
// porque Next/Turbopack los necesitan (en prod endurecer a nonces). El resto de las
// directivas SÍ restringen: img/connect solo a self + Supabase, frame-ancestors none,
// base-uri/form-action self. HSTS/X-Frame/nosniff/Referrer completan la postura.
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const WSS = SUPA.replace(/^https:/, "wss:");
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://api.dicebear.com ${SUPA}`.trim(), // dicebear = avatares generados
  "font-src 'self' data:",
  `connect-src 'self' ${SUPA} ${WSS}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
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

export default nextConfig;
