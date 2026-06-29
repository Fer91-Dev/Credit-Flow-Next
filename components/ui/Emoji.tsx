/**
 * Ícono Fluent Emoji (Microsoft) servido como SVG local desde `public/emoji/<name>.svg`.
 * Reemplaza a los íconos Lucide de "contenido" (secciones, campos, métricas, estados,
 * botones con texto). Los micro-controles (chevrons, X, lupa, spinners) siguen en Lucide.
 *
 * Los SVG se bajan una vez vía la API de Iconify (set `fluent-emoji`). Para sumar uno nuevo:
 *   curl -s "https://api.iconify.design/fluent-emoji/<name>.svg" -o public/emoji/<name>.svg
 */
export function Emoji({ name, className }: { name: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/emoji/${name}.svg`}
      alt=""
      aria-hidden
      draggable={false}
      // width/height explícitos: los SVG vienen con `width="1em"`, así que sin un
      // tamaño base el <img> caería al default 300×150 y reventaría el layout si el
      // CSS (clases h-/w-) aún no compiló. Las clases siguen mandando en el render.
      width={20}
      height={20}
      className={`inline-block shrink-0 select-none ${className ?? "h-5 w-5"}`}
    />
  );
}
