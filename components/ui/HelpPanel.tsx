"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X, Lightbulb } from "lucide-react";
import type { HelpDoc, HelpBlock } from "@/lib/help/content";

interface HelpPanelProps {
  doc: HelpDoc | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Panel lateral de ayuda contextual. Se abre desde el botón "?" del header y muestra la
 * documentación de USO de la sección actual (resuelta por ruta en `lib/help/content.ts`):
 * para qué sirve, cómo se usa paso a paso y qué hace cada configuración.
 */
export function HelpPanel({ doc, open, onClose }: HelpPanelProps) {
  // Portal a document.body: escapa de ancestros con `backdrop-filter`/`transform` (el
  // PageHeader tiene backdrop-blur), que si no capturan el `position: fixed` y recortan el panel.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Enter animation: montamos en translate-x-full y deslizamos en el siguiente frame.
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!open) { setShow(false); return; }
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Escape cierra.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !doc || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label={`Ayuda: ${doc.titulo}`}
        className={`absolute right-0 top-0 flex h-full w-[420px] max-w-[95vw] flex-col border-l border-border bg-card shadow-2xl shadow-black/30 transition-transform duration-200 ease-out ${show ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Cabecera */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <HelpCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ayuda</p>
            <h2 className="truncate text-base font-semibold text-foreground">{doc.titulo}</h2>
          </div>
          <button
            onClick={onClose}
            title="Cerrar (Esc)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Resumen destacado */}
          <p className="rounded-xl border border-primary/15 bg-primary/[0.06] p-3.5 text-sm leading-relaxed text-foreground">
            {doc.resumen}
          </p>

          {/* Bloques */}
          <div className="mt-5 space-y-6">
            {doc.bloques.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </div>

          <p className="mt-8 border-t border-border pt-4 text-center text-[11px] text-muted-foreground/70">
            ¿Te quedó una duda? Escribinos y lo sumamos a esta ayuda.
          </p>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</h3>
  );
}

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "pasos":
      return (
        <div>
          <SectionTitle>{block.titulo}</SectionTitle>
          <ol className="space-y-2.5">
            {block.pasos.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-foreground/90">{p}</span>
              </li>
            ))}
          </ol>
        </div>
      );

    case "definiciones":
      return (
        <div>
          <SectionTitle>{block.titulo}</SectionTitle>
          <dl className="space-y-3">
            {block.items.map((it, i) => (
              <div key={i}>
                <dt className="text-sm font-semibold text-foreground">{it.term}</dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{it.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      );

    case "tips":
      return (
        <div className="rounded-xl border border-warning/20 bg-warning/[0.06] p-3.5">
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-warning">
            <Lightbulb className="h-3.5 w-3.5" /> {block.titulo}
          </h3>
          <ul className="space-y-1.5">
            {block.items.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warning" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case "texto":
      return (
        <div>
          <SectionTitle>{block.titulo}</SectionTitle>
          <div className="space-y-2">
            {block.parrafos.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-foreground/90">{p}</p>
            ))}
          </div>
        </div>
      );
  }
}
