import { FileText, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

export interface LegalSection {
  titulo: string;
  cuerpo: string;
}

/**
 * Layout de documento legal (Privacidad / Términos / Arrepentimiento).
 * El contenido es una PLANTILLA: debe revisarlo asesoría legal antes de publicar.
 */
export function LegalPage({
  titulo,
  actualizado,
  intro,
  secciones,
}: {
  titulo: string;
  actualizado: string;
  intro: string;
  secciones: LegalSection[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader icon={FileText} title={titulo} subtitle={`Última actualización: ${actualizado}`} accent="primary" />

      <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-warning">Plantilla.</span> Este texto es un modelo base y debe ser revisado y
          completado por asesoría legal antes de su publicación.
        </p>
      </div>

      <div className="rounded-xl bg-card border border-border p-6 max-w-3xl space-y-6">
        <p className="text-sm leading-relaxed text-muted-foreground">{intro}</p>
        {secciones.map((s, i) => (
          <section key={i} className="space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">{i + 1}. {s.titulo}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{s.cuerpo}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
