import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// Fuente UI: Geist (variable) — más geométrica/moderna que el default. La variable
// sigue llamándose --font-inter para no tocar globals.css (ahí se mapea a --font-sans).
const geistSans = Geist({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CreditFlow",
  description: "Sistema de gestión de cartera crediticia",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce de la CSP de ESTE request (lo pone el middleware). Sin él, el script que
  // next-themes inyecta para evitar el parpadeo de tema queda sin firmar y el navegador
  // lo bloquea: la página arrancaría con el tema equivocado hasta hidratar.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${jetbrainsMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} nonce={nonce}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
