/**
 * EL ÍCONO DE LA PESTAÑA, SACADO DEL LOGO (Fernando, 29/09/2026).
 *
 * El navegador mostraba el globo gris genérico: no había ícono. Y un logo entero (símbolo +
 * nombre) en 16 px es una mancha. Por eso, al subir el logo, el navegador arma un ÍCONO
 * cuadrado con el SÍMBOLO solo (`generarIconoLogo`) y se guarda al lado del logo con el sufijo
 * `-icono.png`, igual que la versión para papel (ver `logo-papel.ts`): sin columna nueva.
 */

const RE_RASTER = /\.(png|jpe?g|webp)$/i;

/** URL del ícono, o null si el logo no es una imagen rasterizada. */
export function urlLogoIcono(url: string | null | undefined): string | null {
  if (!url || !RE_RASTER.test(url)) return null;
  return url.replace(RE_RASTER, "-icono.png");
}

/** Ruta de Storage del ícono a partir de la del logo. */
export function rutaLogoIcono(path: string): string {
  return path.replace(RE_RASTER, "") + "-icono.png";
}

/**
 * (Navegador) Ícono cuadrado de 192 px con el símbolo del logo.
 *
 * Cómo encuentra el símbolo: mira qué filas (y columnas) tienen dibujo. Si el logo está
 * partido por una franja vacía —el símbolo arriba y el nombre abajo, o el símbolo a la
 * izquierda y el nombre a la derecha— se queda con el PRIMER bloque. Si no hay franja, usa el
 * logo entero. Un logo de fondo oscuro conserva su fondo, en un cuadrado redondeado: así se
 * lee igual en una pestaña clara que en una oscura (las letras blancas desaparecerían sobre
 * la clara). Uno transparente o claro queda sin fondo.
 */
export async function generarIconoLogo(file: File): Promise<Blob | null> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return null;
  const bmp = await createImageBitmap(file);
  const W = bmp.width, H = bmp.height;
  const src = document.createElement("canvas");
  src.width = W; src.height = H;
  const sctx = src.getContext("2d");
  if (!sctx) return null;
  sctx.drawImage(bmp, 0, 0);
  const d = sctx.getImageData(0, 0, W, H).data;

  // ¿Fondo oscuro? Mismo criterio que la versión para papel: el borde casi negro y opaco.
  let suma = 0, n = 0;
  const px = (x: number, y: number) => (y * W + x) * 4;
  const paso = Math.max(1, Math.floor(Math.min(W, H) / 60));
  const luz = (i: number) => { const a = d[i + 3] / 255; return a * Math.max(d[i], d[i + 1], d[i + 2]) + (1 - a) * 255; };
  for (let x = 0; x < W; x += paso) { suma += luz(px(x, 0)) + luz(px(x, H - 1)); n += 2; }
  for (let y = 0; y < H; y += paso) { suma += luz(px(0, y)) + luz(px(W - 1, y)); n += 2; }
  const oscuro = suma / n <= 60;
  const fondo = oscuro ? [d[0], d[1], d[2]] : null;

  // Qué es dibujo: sobre fondo oscuro, lo que tiene luz; si no, lo opaco y no blanco.
  const esDibujo = (i: number) => oscuro
    ? Math.max(d[i], d[i + 1], d[i + 2]) > 70
    : d[i + 3] > 40 && Math.min(d[i], d[i + 1], d[i + 2]) < 225;
  const filas = new Array<boolean>(H).fill(false);
  const cols = new Array<boolean>(W).fill(false);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (esDibujo(px(x, y))) { filas[y] = true; cols[x] = true; }
  }

  /** Bloques de dibujo separados por franjas vacías de al menos `minGap` píxeles. */
  const bloques = (occ: boolean[], minGap: number) => {
    const out: [number, number][] = [];
    let ini = -1, fin = -1, vacio = 0;
    occ.forEach((o, i) => {
      if (o) { if (ini < 0) ini = i; else if (vacio >= minGap) { out.push([ini, fin]); ini = i; } fin = i; vacio = 0; }
      else if (ini >= 0) vacio++;
    });
    if (ini >= 0) out.push([ini, fin]);
    return out;
  };
  let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
  const bf = bloques(filas, Math.max(3, Math.round(H * 0.02)));
  const bc = bloques(cols, Math.max(3, Math.round(W * 0.02)));
  if (bf.length >= 2) { [y0, y1] = bf[0]; }          // símbolo arriba, nombre abajo
  else if (bc.length >= 2) { [x0, x1] = bc[0]; }     // símbolo a la izquierda
  // Recorte ajustado al dibujo dentro de esa zona.
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (esDibujo(px(x, y))) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  if (bx1 < 0) return null;

  // Se borra todo lo que queda FUERA del símbolo: al hacer el recorte cuadrado se toma más
  // alto (o más ancho) que el dibujo, y se colaba un pedazo del nombre ("EDIT ZE").
  sctx.save();
  sctx.beginPath();
  sctx.rect(0, 0, W, H);
  sctx.rect(bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1);
  sctx.clip("evenodd");
  if (oscuro) { sctx.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`; sctx.fillRect(0, 0, W, H); }
  else sctx.clearRect(0, 0, W, H);
  sctx.restore();

  const lado = Math.max(bx1 - bx0 + 1, by1 - by0 + 1) * (oscuro ? 1.3 : 1.1);
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const S = 192;
  const out = document.createElement("canvas");
  out.width = S; out.height = S;
  const o = out.getContext("2d")!;
  if (fondo) {
    // Cuadrado redondeado con el fondo del propio logo.
    const r = S * 0.22;
    o.beginPath();
    o.moveTo(r, 0); o.arcTo(S, 0, S, S, r); o.arcTo(S, S, 0, S, r); o.arcTo(0, S, 0, 0, r); o.arcTo(0, 0, S, 0, r);
    o.closePath();
    o.fillStyle = `rgb(${fondo[0]},${fondo[1]},${fondo[2]})`;
    o.fill();
    o.clip();
  }
  o.imageSmoothingQuality = "high";
  o.drawImage(src, cx - lado / 2, cy - lado / 2, lado, lado, 0, 0, S, S);
  return new Promise((res) => out.toBlob((b) => res(b), "image/png"));
}
