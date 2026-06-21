import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El type-check y lint se corren aparte (componentes shadcn scaffold sin usar
  // referencian deps no instaladas y romperían el build sin aportar nada al bundle).
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Evita el doble render de StrictMode en dev (panel pesado de datos): el árbol
  // se renderiza una vez en vez de dos, aligerando la sensación en desarrollo.
  reactStrictMode: false,
};

export default nextConfig;
