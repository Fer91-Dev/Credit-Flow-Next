import Link from "next/link";
import { Terminal, Mail, Phone, MapPin, ShieldCheck, ExternalLink } from "lucide-react";

const PRODUCTO: { label: string; to: string }[] = [
  { label: "Clientes", to: "/clientes" },
  { label: "Créditos", to: "/creditos" },
  { label: "Cobranza", to: "/cobranza" },
  { label: "Pagos", to: "/pagos" },
  { label: "Caja", to: "/caja" },
  { label: "Reportes", to: "/reportes" },
];

const LEGAL: { label: string; to: string }[] = [
  { label: "Políticas de Privacidad", to: "/legal/privacidad" },
  { label: "Términos y Condiciones", to: "/legal/terminos" },
  { label: "Política de Cookies", to: "/legal/privacidad" },
];

// Enlaces oficiales del Estado argentino (se abren en pestaña nueva).
const CONSUMIDOR_EXT = {
  defensa: "https://www.argentina.gob.ar/defensadelconsumidor",
  denuncias: "https://autogestion.produccion.gob.ar/consumidores",
  dataFiscal: "https://www.afip.gob.ar",
};

/** Footer del sistema. Aparece en todas las secciones; cierra visualmente las páginas. */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card/40">
      <div className="mx-auto w-full max-w-screen-2xl px-4 md:px-6 lg:px-8">
        {/* Columnas */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 py-10 lg:grid-cols-12">
          {/* Marca + contacto */}
          <div className="col-span-2 lg:col-span-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-white">
                <Terminal className="h-5 w-5" />
              </div>
              <p className="font-mono text-sm font-bold text-foreground">CreditFlow</p>
            </div>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Gestión de créditos, cobranzas y caja. Motor financiero configurable por financiera.
            </p>
            <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
              <a href="mailto:contacto@creditflow.com.ar" className="flex items-center gap-2 hover:text-foreground transition-colors">
                <Mail className="h-3.5 w-3.5 text-muted-foreground/60" /> contacto@creditflow.com.ar
              </a>
              <a href="tel:+541100000000" className="flex items-center gap-2 hover:text-foreground transition-colors">
                <Phone className="h-3.5 w-3.5 text-muted-foreground/60" /> +54 11 0000-0000
              </a>
              <p className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground/60" /> Buenos Aires, Argentina
              </p>
            </div>
          </div>

          {/* Producto */}
          <div className="col-span-1 lg:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Producto</p>
            <nav className="mt-3 flex flex-col gap-2">
              {PRODUCTO.map((l) => (
                <Link key={l.to} href={l.to} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Legal */}
          <div className="col-span-1 lg:col-span-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Legal</p>
            <nav className="mt-3 flex flex-col gap-2">
              {LEGAL.map((l, i) => (
                <Link key={`${l.to}-${i}`} href={l.to} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Defensa del Consumidor */}
          <div className="col-span-2 lg:col-span-3">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
              <ShieldCheck className="h-3.5 w-3.5" /> Defensa del Consumidor
            </p>
            <nav className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
              <a href={CONSUMIDOR_EXT.defensa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                Defensa de las y los Consumidores <ExternalLink className="h-3 w-3" />
              </a>
              <a href={CONSUMIDOR_EXT.denuncias} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                Formulario de denuncias <ExternalLink className="h-3 w-3" />
              </a>
              <Link href="/legal/arrepentimiento" className="hover:text-foreground transition-colors">
                Botón de arrepentimiento
              </Link>
            </nav>
          </div>
        </div>

        {/* Barra inferior institucional */}
        <div className="flex flex-col gap-3 border-t border-border/60 py-5 text-[11px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p>© {year} CreditFlow · Todos los derechos reservados.</p>
            <p>Razón social: CreditFlow S.A. · CUIT XX-XXXXXXXX-X · Buenos Aires, Argentina.</p>
          </div>
          <div className="flex items-center gap-4">
            <a href={CONSUMIDOR_EXT.dataFiscal} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              Data Fiscal (AFIP) <ExternalLink className="h-3 w-3" />
            </a>
            <span className="font-mono">v1.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
