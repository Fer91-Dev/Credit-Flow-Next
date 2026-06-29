"use client";

/**
 * Avatar — adaptado de los componentes free de TailGrids (tailgrids.com/components/avatars)
 * con tokens del Design Contract (sin colores hardcodeados, modo claro/oscuro).
 *
 * Imagen: si no se pasa `src`, genera un avatar ilustrado único por persona con
 * DiceBear (vía su API SVG). Se **seedea con un hash del nombre** (no se envía el
 * nombre en claro a un tercero). Si la imagen falla, cae a las **iniciales**.
 * Soporta tamaños xs→xxl, forma círculo/cuadrado y **dot de estado** (online/offline/busy).
 */
import { useState, type ReactNode } from "react";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
export type AvatarStatus = "online" | "offline" | "busy";

/** Estilo DiceBear de los avatares generados. Cambiar acá impacta a todo el sistema. */
const DICEBEAR_STYLE = "personas";

const SIZE: Record<AvatarSize, { box: string; text: string; dot: string; dotPos: string }> = {
  xs:  { box: "h-8 w-8",             text: "text-[11px]", dot: "h-2 w-2",     dotPos: "bottom-0 right-0" },
  sm:  { box: "h-10 w-10",           text: "text-xs",     dot: "h-2.5 w-2.5", dotPos: "bottom-0 right-0" },
  md:  { box: "h-12 w-12",           text: "text-sm",     dot: "h-3 w-3",     dotPos: "bottom-0 right-0" },
  lg:  { box: "h-[60px] w-[60px]",   text: "text-lg",     dot: "h-3.5 w-3.5", dotPos: "bottom-0.5 right-0.5" },
  xl:  { box: "h-20 w-20",           text: "text-2xl",    dot: "h-4 w-4",     dotPos: "bottom-1 right-1" },
  xxl: { box: "h-[100px] w-[100px]", text: "text-3xl",    dot: "h-5 w-5",     dotPos: "bottom-1.5 right-1.5" },
};

const STATUS: Record<AvatarStatus, string> = {
  online:  "bg-success",
  offline: "bg-muted-foreground",
  busy:    "bg-destructive",
};

/** Iniciales (hasta 2 palabras) para el fallback. */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** Hash determinístico → seed estable sin enviar el nombre en claro. */
function hashSeed(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function dicebearUrl(name: string): string {
  return generatedAvatarUrl(hashSeed(name));
}

/** URL de un avatar generado a partir de un seed explícito (para el selector de perfil). */
export function generatedAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/${DICEBEAR_STYLE}/svg?seed=${encodeURIComponent(seed)}`;
}

/** Seeds curados para ofrecer opciones de avatar en el selector. */
export const AVATAR_SEEDS = [
  "Mango", "Luna", "Apolo", "Nube", "Coco", "Pixel", "Sol", "Río",
  "Brisa", "Tango", "Kiwi", "Astro", "Zafiro", "Lima", "Nieve", "Bruno",
] as const;

export function Avatar({
  name, src, generated = true, size = "md", status, ping, square, className,
}: {
  name?: string | null;
  /** Foto explícita (gana sobre el generado). */
  src?: string | null;
  /** Si no hay `src`, genera un avatar ilustrado con DiceBear. */
  generated?: boolean;
  size?: AvatarSize;
  status?: AvatarStatus;
  ping?: boolean;
  /** Cuadrado redondeado en vez de círculo. */
  square?: boolean;
  className?: string;
}) {
  const s = SIZE[size];
  const shape = square ? "rounded-xl" : "rounded-full";
  const safeName = name ?? "";
  const [imgError, setImgError] = useState(false);

  const url = src ?? (generated && safeName ? dicebearUrl(safeName) : null);
  const showImg = !!url && !imgError;

  return (
    <span className={`relative inline-flex shrink-0 ${s.box} ${className ?? ""}`}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url!}
          alt={safeName}
          onError={() => setImgError(true)}
          className={`h-full w-full object-cover ${shape} bg-muted ring-1 ring-border`}
        />
      ) : (
        <span className={`flex h-full w-full items-center justify-center ${shape} bg-gradient-to-br from-primary to-success font-bold leading-none text-white ring-1 ring-white/10 ${s.text}`}>
          {iniciales(safeName)}
        </span>
      )}
      {status && (
        <span className={`absolute ${s.dotPos} ${s.dot} rounded-full ${STATUS[status]} ring-2 ring-card`}>
          {ping && <span className={`absolute inset-0 animate-ping rounded-full opacity-75 ${STATUS[status]}`} />}
        </span>
      )}
    </span>
  );
}

/** Grupo de avatares apilados (margen negativo + anillo del color de la tarjeta). */
export function AvatarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center -space-x-2 [&>*]:ring-2 [&>*]:ring-card [&>*]:rounded-full">{children}</div>;
}

/** Contador de overflow del grupo (ej. "5+"), con el mismo tamaño que los avatares. */
export function AvatarGroupCount({ count, size = "md" }: { count: number; size?: AvatarSize }) {
  const s = SIZE[size];
  return (
    <span className={`inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card ${s.box} ${s.text}`}>
      {count}+
    </span>
  );
}
