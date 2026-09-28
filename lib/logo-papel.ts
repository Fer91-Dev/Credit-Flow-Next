/**
 * EL LOGO SOBRE PAPEL (Fernando, 28/09/2026).
 *
 * Muchas financieras suben su logo pensado para fondo oscuro (el de Credit Zero: letras
 * blancas sobre un recuadro negro). En pantalla se funde con el tema, pero en un PDF o un
 * impreso sale como una caja negra encima del papel blanco.
 *
 * Por eso, al subir el logo, el navegador arma una SEGUNDA versión para papel
 * (`generarLogoPapel`) y se guarda al lado del original con el sufijo `-papel.png`. No hace
 * falta columna nueva: el nombre se deduce del original (`urlLogoPapel`). Los impresos piden
 * primero la de papel y, si no existe (logos subidos antes, o logos que ya eran claros),
 * vuelven al original.
 */

const RE_RASTER = /\.(png|jpe?g|webp)$/i;

/** URL de la versión para papel, o null si el logo no es una imagen rasterizada. */
export function urlLogoPapel(url: string | null | undefined): string | null {
  if (!url || !RE_RASTER.test(url)) return null;
  return url.replace(RE_RASTER, "-papel.png");
}

/** Ruta de Storage de la versión para papel a partir de la del original. */
export function rutaLogoPapel(path: string): string {
  return path.replace(RE_RASTER, "") + "-papel.png";
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * `<img>` del logo para un impreso HTML: pide la versión para papel y, si no está, cae al
 * original sin romper el documento.
 */
export function imgLogoImpreso(url: string, attrs = ""): string {
  const papel = urlLogoPapel(url);
  const orig = escAttr(url);
  if (!papel) return `<img ${attrs} src="${orig}" alt=""/>`;
  return `<img ${attrs} src="${escAttr(papel)}" onerror="this.onerror=null;this.src='${orig}'" alt=""/>`;
}

/**
 * Bytes del logo para un PDF armado en el servidor: primero la versión para papel, después
 * el original. Solo descarga de NUESTRO Storage público (anti-SSRF), y solo PNG/JPG, que es
 * lo que pdf-lib sabe incrustar.
 */
export async function bytesLogoImpreso(url: string | null | undefined): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !base || !url.startsWith(`${base}/storage/v1/object/public/`)) return null;
  const candidatas = [urlLogoPapel(url), url].filter((u): u is string => !!u && /\.(png|jpe?g)$/i.test(u));
  for (const u of candidatas) {
    try {
      const r = await fetch(u);
      if (r.ok) return { bytes: new Uint8Array(await r.arrayBuffer()), png: /\.png$/i.test(u) };
    } catch { /* se prueba la siguiente */ }
  }
  return null;
}

/**
 * (Navegador) Arma la versión para papel de un logo, o null si no hace falta.
 *
 * Solo actúa si el logo tiene FONDO OSCURO (el borde de la imagen es casi negro). Entonces,
 * píxel por píxel:
 *  · lo que es gris (el fondo negro, las letras blancas) se invierte: el fondo pasa a blanco
 *    y las letras a negro;
 *  · lo que tiene color (los azules de la marca) se deja COMO ESTÁ. Un `invert` +
 *    `hue-rotate` de CSS los aclaraba y en papel se veían lavados.
 * El fondo, ya blanco, queda transparente. Al final se recorta el margen vacío, así el logo llena el lugar que le toca en el impreso
 * con la resolución original.
 */
export async function generarLogoPapel(file: File): Promise<Blob | null> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return null;
  const bmp = await createImageBitmap(file);
  const W = bmp.width, H = bmp.height;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // ¿Fondo oscuro? Se mira el borde: si es opaco y casi negro, es el recuadro del logo.
  let suma = 0, n = 0;
  const muestra = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    const a = d[i + 3] / 255;
    // Transparente cuenta como "claro": un PNG sin fondo ya va bien sobre papel.
    suma += a * Math.max(d[i], d[i + 1], d[i + 2]) + (1 - a) * 255; n++;
  };
  const paso = Math.max(1, Math.floor(Math.min(W, H) / 60));
  for (let x = 0; x < W; x += paso) { muestra(x, 0); muestra(x, H - 1); }
  for (let y = 0; y < H; y += paso) { muestra(0, y); muestra(W - 1, y); }
  if (suma / n > 60) return null;

  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = d[i + 3] / 255;
      // Sobre negro: un píxel transparente se ve como fondo.
      const r = d[i] * a, g = d[i + 1] * a, b = d[i + 2] * a;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const color = Math.min(1, ((max - min) / 255) * 2.5); // 0 = gris, 1 = color pleno
      const inv = 255 - max;
      const R = Math.round(color * r + (1 - color) * inv);
      const G = Math.round(color * g + (1 - color) * inv);
      const B = Math.round(color * b + (1 - color) * inv);
      // El fondo que quedó casi blanco pasa a TRANSPARENTE (con un degradé corto para que el
      // borde de las letras no quede serruchado): un "blanco" de 240 sobre papel de 255 se
      // veía como un recuadro gris apenas marcado.
      const claro = Math.min(R, G, B);
      d[i] = R; d[i + 1] = G; d[i + 2] = B;
      d[i + 3] = claro >= 240 ? 0 : claro > 215 ? Math.round(((240 - claro) / 25) * 255) : 255;
      if (claro < 235) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  ctx.putImageData(img, 0, 0);

  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((res) => out.toBlob((b) => res(b), "image/png"));
}
