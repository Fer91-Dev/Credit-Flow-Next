import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
