import Link from "next/link";
import { ExternalLink } from "lucide-react";

const CONSUMIDOR_EXT = {
  defensa: "https://www.argentina.gob.ar/defensadelconsumidor",
  dataFiscal: "https://www.afip.gob.ar",
};

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="shrink-0 border-t border-border/50 bg-card/20">
      <div className="mx-auto w-full max-w-screen-2xl px-4 md:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-[11px] text-muted-foreground/50">
          <span>© {year} CreditFlow · Todos los derechos reservados.</span>
          <div className="flex items-center gap-4">
            <Link href="/legal/privacidad" className="hover:text-muted-foreground transition-colors">Privacidad</Link>
            <Link href="/legal/terminos" className="hover:text-muted-foreground transition-colors">Términos</Link>
            <a href={CONSUMIDOR_EXT.defensa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors">
              Defensa del Consumidor <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <a href={CONSUMIDOR_EXT.dataFiscal} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors">
              Data Fiscal <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <span className="font-mono">v1.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
