/**
 * ACHICAR LA FOTO EN EL NAVEGADOR, ANTES DE SUBIRLA.
 *
 * Fernando (19/09/2026): el catálogo se carga con fotos sacadas del celular. Una foto de un
 * teléfono de hoy son 4032 × 3024 y 4 MB; el sistema la guardaba tal cual y después la
 * mostraba dentro de un recuadro de 300px. El resultado es una grilla de productos que tarda
 * varios segundos en pintar y consume datos del teléfono de quien la mira, para ver una foto
 * que nunca se muestra a más de 1600px.
 *
 * Así que se achica ACÁ, en la máquina de quien la sube: el servidor no cambia y el archivo
 * llega liviano. La calidad no se toca donde importa —el lado más largo queda en 1600px, que
 * es más del doble de lo que ocupa la foto en pantalla, y alcanza para el visor a pantalla
 * completa y para pantallas retina.
 *
 * 🔴 EL GIF NO SE TOCA: pasarlo por un canvas lo deja en un solo cuadro, o sea que se pierde
 * la animación. Y si algo falla —un formato raro, un canvas bloqueado— se sube el original:
 * esto es una mejora, nunca un motivo para que una foto no se pueda cargar.
 */

/** El lado más largo que se guarda. Por encima de esto, nada se ve mejor: solo pesa más. */
export const LADO_MAXIMO = 1600;
/** Calidad del WebP. 0.85 es el punto donde el ojo no distingue y el archivo baja 10 veces. */
const CALIDAD = 0.85;
/** Por debajo de esto no vale la pena recomprimir: se sube tal cual. */
const PESO_QUE_NO_MOLESTA = 400 * 1024;

export interface FotoOptimizada {
  archivo: File;
  /** Medidas y peso antes y después, para poder DECIR qué pasó con la foto. */
  antes: { ancho: number; alto: number; bytes: number };
  despues: { ancho: number; alto: number; bytes: number };
  /** `false` cuando se sube el original (GIF, ya liviana, o falló el achique). */
  cambio: boolean;
}

/** "3,8 MB" · "280 KB" — el peso dicho como lo diría una persona. */
export function formatPeso(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export async function optimizarImagen(file: File): Promise<FotoOptimizada> {
  const sinCambios = (ancho = 0, alto = 0): FotoOptimizada => ({
    archivo: file,
    antes: { ancho, alto, bytes: file.size },
    despues: { ancho, alto, bytes: file.size },
    cambio: false,
  });

  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return sinCambios();

  try {
    // `from-image` respeta el EXIF: sin eso, la foto vertical del celular se sube acostada.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bitmap;
    const escala = Math.min(1, LADO_MAXIMO / Math.max(width, height));

    // Ya entra en las medidas y no pesa: no se toca (recomprimir solo le sacaría calidad).
    if (escala === 1 && file.size <= PESO_QUE_NO_MOLESTA) {
      bitmap.close();
      return sinCambios(width, height);
    }

    const ancho = Math.max(1, Math.round(width * escala));
    const alto = Math.max(1, Math.round(height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return sinCambios(width, height); }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", CALIDAD));
    // Si el resultado no es más liviano, el original gana: no se pierde calidad a cambio de nada.
    if (!blob || blob.size >= file.size) return sinCambios(width, height);

    const nombre = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return {
      archivo: new File([blob], nombre, { type: "image/webp" }),
      antes: { ancho: width, alto: height, bytes: file.size },
      despues: { ancho, alto, bytes: blob.size },
      cambio: true,
    };
  } catch {
    return sinCambios();
  }
}
