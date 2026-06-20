import type { ClienteScore } from "@/lib/swr";

const STYLES: Record<ClienteScore["categoria"], { dot: string; text: string; bg: string }> = {
  A:             { dot: "bg-success",     text: "text-success",          bg: "bg-success/10 border-success/30" },
  B:             { dot: "bg-primary",     text: "text-primary",          bg: "bg-primary/10 border-primary/30" },
  C:             { dot: "bg-warning",     text: "text-warning",          bg: "bg-warning/10 border-warning/30" },
  D:             { dot: "bg-destructive", text: "text-destructive",      bg: "bg-destructive/10 border-destructive/30" },
  sin_historial: { dot: "bg-muted-foreground/40", text: "text-muted-foreground", bg: "bg-muted/40 border-border" },
};

/**
 * Badge de calificación crediticia derivada (A/B/C/D o sin historial).
 * `size="sm"` para filas densas, `size="md"` (defecto) para fichas.
 */
export function ScoreBadge({
  score,
  size = "md",
}: {
  score?: ClienteScore | null;
  size?: "sm" | "md";
}) {
  if (!score) return null;
  const s = STYLES[score.categoria];
  const letra = score.categoria === "sin_historial" ? "—" : score.categoria;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${s.bg} ${s.text} ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      title={`Calificación: ${score.label}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
      <span className="font-mono font-bold">{letra}</span>
      <span className="hidden sm:inline">{score.label}</span>
    </span>
  );
}
