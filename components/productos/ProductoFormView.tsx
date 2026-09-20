"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { ArrowLeft, Camera, ImagePlus, Loader2, X, Link as LinkIcon, Info, GripVertical, Star, TriangleAlert } from "lucide-react";
import { useProductos, useProducto, KEYS, type Producto } from "@/lib/swr";
import { parseMontoInput } from "@/lib/utils";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { SystemControls } from "@/components/ui/SystemControls";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MoneyInput, FieldLabel } from "@/components/ui/form-kit";
import { Nota } from "@/components/ui/Nota";
import { MAX_FOTOS_PRODUCTO } from "@/lib/productos";
import { optimizarImagen, formatPeso, LADO_MAXIMO } from "@/lib/imagen-cliente";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

/**
 * NUEVO / EDITAR PRODUCTO — PANTALLA PROPIA, NO UN MODAL.
 *
 * Fernando (19/09/2026): «quiero que Nuevo producto tenga su propia pantalla y deje de ser un
 * modal». Tiene razón y el motivo se veía en la captura: el formulario tiene fotos, ocho
 * campos y una galería que se reordena arrastrando, y todo eso entraba en una ventana de 560px
 * con scroll interno — las fotos quedaban del tamaño de una estampilla y los botones tapaban
 * el último campo. Es el mismo camino que ya hizo la campaña de recupero.
 *
 * El otro pedido: «que donde se carga la imagen dé las medidas para que la imagen se vea en
 * calidad». Así que la columna de fotos dice qué medida conviene, muestra la portada al tamaño
 * real en que se va a ver en la ficha, y MIDE cada foto: si entra una de 400px, lo avisa en
 * vez de dejar que el operador se entere cuando el producto ya está publicado.
 */

/**
 * La foto se muestra en tarjetas y fichas recortada a 4:3, y la más grande que llega a verse
 * es el visor a pantalla casi completa. Con 1200 × 900 alcanza para todas sin que el archivo
 * pese de más; por debajo de 800 de ancho, el recorte de la tarjeta ya se ve blando.
 */
const FOTO_IDEAL = { ancho: 1200, alto: 900 };
const FOTO_ANCHO_MINIMO = 800;
const PESO_MAXIMO_MB = 5;

/** Medidas reales de cada foto, para poder avisar cuando una es chica. */
type Medida = { ancho: number; alto: number };

export function ProductoFormView({ productoId }: { productoId?: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const editando = !!productoId;
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * EL BOTÓN DE CÁMARA DEL CELULAR. `capture="environment"` abre la cámara trasera DIRECTO,
   * sin pasar por el explorador de archivos: cargar un producto desde el local es sacarle la
   * foto al producto que está adelante, no buscarla en una galería.
   */
  const camaraRef = useRef<HTMLInputElement>(null);

  const { categorias } = useProductos();
  const { producto, isLoading } = useProducto(productoId ?? null);

  // Al editar, avisar si el producto ya tiene créditos vivos: cambiar el precio afecta
  // SOLO a créditos futuros (los otorgados usan su monto snapshot, no cambian).
  const creditosVivos = (producto?.creditos ?? []).filter((c) => c.estado === "activo" || c.estado === "vencido").length;

  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [sku, setSku] = useState("");
  const [precio, setPrecio] = useState("");
  const [stock, setStock] = useState("");
  const [stockMin, setStockMin] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [medidas, setMedidas] = useState<Record<string, Medida>>({});
  const [urlInput, setUrlInput] = useState("");
  const [activo, setActivo] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [sobreZona, setSobreZona] = useState(false);
  /** Lo que se le ahorró al catálogo al achicar las fotos, para poder decirlo con números. */
  const [ahorro, setAhorro] = useState<{ fotos: number; antes: number; despues: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * El formulario se llena UNA vez, cuando llega la ficha. Sin el candado, cada revalidación
   * de SWR le pisaría al operador lo que está escribiendo.
   */
  const cargado = useRef(false);
  useEffect(() => {
    if (!editando || !producto || cargado.current) return;
    cargado.current = true;
    setNombre(producto.nombre ?? "");
    setCategoria(producto.categoria ?? "");
    setSku(producto.sku ?? "");
    setPrecio(new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(producto.precio));
    setStockMin(producto.stock_minimo != null ? String(producto.stock_minimo) : "");
    setDescripcion(producto.descripcion ?? "");
    // Galería: usa imagenes; fallback a la portada suelta (productos viejos).
    setImagenes(producto.imagenes?.length ? producto.imagenes : (producto.imagen_url ? [producto.imagen_url] : []));
    setActivo(producto.activo ?? true);
  }, [editando, producto]);

  /** Mide cada foto nueva. Con `naturalWidth` se sabe el tamaño REAL, no el que se dibuja. */
  useEffect(() => {
    for (const url of imagenes) {
      if (medidas[url]) continue;
      const img = new window.Image();
      img.onload = () => setMedidas((prev) => (prev[url] ? prev : { ...prev, [url]: { ancho: img.naturalWidth, alto: img.naturalHeight } }));
      img.src = url;
    }
  }, [imagenes, medidas]);

  const precioNum = parseMontoInput(precio);
  const stockNum = parseInt(stock || "0", 10);
  const lleno = imagenes.length >= MAX_FOTOS_PRODUCTO;
  const portada = imagenes[0] ?? null;
  const chicas = imagenes.filter((u) => medidas[u] && medidas[u].ancho < FOTO_ANCHO_MINIMO);

  const agregarImagen = (url: string) => {
    const u = url.trim();
    if (!u) return;
    setImagenes((prev) => (prev.includes(u) || prev.length >= MAX_FOTOS_PRODUCTO ? prev : [...prev, u]));
  };
  const quitarImagen = (idx: number) => setImagenes((prev) => prev.filter((_, i) => i !== idx));
  const hacerPortada = (idx: number) => setImagenes((prev) => (idx === 0 ? prev : [prev[idx], ...prev.filter((_, i) => i !== idx)]));
  // Reordena moviendo el elemento `from` a la posición `to` (drag & drop). La posición 0 es la portada.
  const moverImagen = (from: number, to: number) => setImagenes((prev) => {
    if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
    const next = [...prev];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  const handleFiles = async (files: FileList | File[]) => {
    setError(null);
    setUploading(true);
    try {
      let cargadas = imagenes.length;
      for (const file of Array.from(files)) {
        if (cargadas >= MAX_FOTOS_PRODUCTO) break;
        /**
         * La foto se achica ACÁ, antes de salir. Una del celular son 4 MB que después se
         * muestran en un recuadro de 300px: subirla entera hace lento el catálogo para todos
         * los que lo abran, sin que se vea un poco mejor.
         */
        const opt = await optimizarImagen(file);
        const fd = new FormData();
        fd.append("file", opt.archivo);
        const res = await fetch("/api/productos/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (json.ok) {
          agregarImagen(json.data.url);
          cargadas++;
          if (opt.cambio) {
            setAhorro((prev) => ({
              fotos: (prev?.fotos ?? 0) + 1,
              antes: (prev?.antes ?? 0) + opt.antes.bytes,
              despues: (prev?.despues ?? 0) + opt.despues.bytes,
            }));
          }
        } else { setError(json.error || "No se pudo subir la imagen"); break; }
      }
    } catch {
      setError("No se pudo subir la imagen");
    } finally {
      setUploading(false);
    }
  };

  const volver = () => router.push("/productos");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) { setError("El nombre es requerido"); return; }
    /**
     * El precio es el CAPITAL del crédito, así que 0 no sirve. El mensaje dice POR QUÉ:
     * antes decía "ingresá un precio válido" y el operador no tenía forma de saber que el
     * problema no era el formato sino que un producto en $0 no se puede financiar.
     */
    if (!Number.isFinite(precioNum) || precioNum <= 0) {
      setError("El precio tiene que ser mayor a 0: es el capital que se financia.");
      return;
    }
    const ok = await confirm({
      title: editando ? "¿Guardar cambios?" : "¿Crear producto?",
      description: editando ? `Se actualizará "${nombre.trim()}".` : `Se agregará "${nombre.trim()}" al inventario.`,
      confirmLabel: editando ? "Guardar cambios" : "Crear producto",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        nombre, categoria, sku, descripcion,
        precio: precioNum,
        stock_minimo: stockMin.trim() === "" ? null : parseInt(stockMin, 10),
        imagenes,
        activo,
      };
      // El stock solo se fija al CREAR (stock inicial). En edición cambia vía kardex.
      if (!editando) body.stock = isNaN(stockNum) ? 0 : stockNum;
      const res = await fetch(editando ? `/api/productos/${productoId}` : "/api/productos", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(editando ? `Producto "${nombre.trim()}" actualizado` : `Producto "${nombre.trim()}" creado`);
        globalMutate(KEYS.productos);
        if (editando) globalMutate(`/api/productos/${productoId}`);
        volver();
      } else setError(json.error);
    } catch {
      setError("No se pudo guardar");
    } finally {
      setLoading(false);
    }
  };

  const puedeGuardar = !!nombre.trim() && precioNum > 0 && !uploading;

  return (
    <div className="-mx-4 -mb-6 flex min-h-[calc(100dvh-3rem)] flex-col bg-background md:-mx-6 md:-mb-8 lg:-mx-8">
      {/* Encabezado de la pantalla — misma altura (76px) que el PageHeader y que la pantalla
          de campaña, para que el salto entre secciones no se note. */}
      <div className="flex h-[76px] shrink-0 items-center justify-between gap-3 border-b border-edge px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={volver}
            title="Volver a productos"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
            <Emoji name="package" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight text-foreground">
              {editando ? "Editar producto" : "Nuevo producto"}
            </h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {editando ? "Actualizá los datos del producto." : "Cargá un producto del inventario para venderlo a crédito."}
            </p>
          </div>
        </div>
        <SystemControls />
      </div>

      {editando && isLoading && !producto ? (
        <div className="mx-auto w-full max-w-6xl space-y-4 px-5 py-6">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-6">
            {error && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
            )}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-6">
              {/* ═══════════ FOTOS ═══════════ */}
              <section className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>Fotos ({imagenes.length}/{MAX_FOTOS_PRODUCTO})</FieldLabel>
                  {/* "Arrastrá" solo donde hay con qué arrastrar: el drag and drop de HTML no
                      existe en una pantalla táctil, y prometerlo ahí es mentir. */}
                  {imagenes.length > 1 && (
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">Arrastrá para ordenar</span>
                  )}
                </div>

                {/*
                  LA PORTADA, AL TAMAÑO EN QUE SE VA A VER. El 4:3 no es decorativo: es el
                  recorte exacto de la tarjeta del catálogo y de la ficha, así que acá se ve
                  qué parte de la foto va a quedar adentro antes de guardar.
                */}
                <div
                  onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setSobreZona(true); } }}
                  onDragLeave={() => setSobreZona(false)}
                  onDrop={(e) => {
                    if (!e.dataTransfer.files?.length) return;
                    e.preventDefault(); setSobreZona(false); handleFiles(e.dataTransfer.files);
                  }}
                  className={`relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border bg-gradient-to-br from-muted/30 to-muted/5 transition-colors ${
                    sobreZona ? "border-primary bg-primary/5" : "border-dashed border-border"
                  }`}
                >
                  {portada ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={portada} alt="" className="h-full w-full object-cover" />
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary/85 px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        <Star className="h-2.5 w-2.5 fill-current" /> Portada
                      </span>
                      {medidas[portada] && (
                        <span className="absolute bottom-2 right-2 rounded-full bg-background/80 px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {medidas[portada].ancho} × {medidas[portada].alto}
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
                      {uploading ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : <ImagePlus className="h-7 w-7 text-muted-foreground" />}
                      <div className="flex w-full max-w-xs flex-col gap-2">
                        {/* En el celular la cámara va PRIMERA y como botón sólido: es lo que se
                            hace nueve de cada diez veces parado frente al producto. */}
                        <button
                          type="button"
                          onClick={() => camaraRef.current?.click()}
                          disabled={uploading}
                          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:hidden"
                        >
                          <Camera className="h-4 w-4" /> Sacar la foto
                        </button>
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploading}
                          className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/30 disabled:opacity-50 sm:h-auto sm:border-0 sm:bg-transparent sm:text-muted-foreground sm:hover:bg-transparent sm:hover:text-foreground"
                        >
                          <span className="sm:hidden">Elegir de la galería</span>
                          <span className="hidden sm:inline">Subir la foto del producto</span>
                        </button>
                      </div>
                      <span className="hidden text-xs text-muted-foreground sm:block">o arrastrala hasta acá</span>
                    </div>
                  )}
                </div>

                {/* Las demás fotos + el botón de sumar, del mismo alto que la fila */}
                <div className="flex flex-wrap gap-2">
                  {imagenes.map((url, idx) => (
                    <div
                      key={url}
                      draggable
                      onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                      onDrop={(e) => { e.preventDefault(); const from = dragIdx ?? Number(e.dataTransfer.getData("text/plain")); moverImagen(from, idx); setDragIdx(null); }}
                      onDragEnd={() => setDragIdx(null)}
                      title={medidas[url] ? `${medidas[url].ancho} × ${medidas[url].alto} · arrastrá para reordenar` : "Arrastrá para reordenar"}
                      className={`group/foto relative h-20 w-20 cursor-grab overflow-hidden rounded-lg border bg-muted/30 transition-all active:cursor-grabbing ${
                        dragIdx === idx ? "opacity-40 ring-2 ring-primary" : dragIdx !== null ? "ring-1 ring-primary/30" : ""
                      } ${idx === 0 ? "border-primary/50 ring-1 ring-primary/40" : "border-border"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="pointer-events-none h-full w-full select-none object-cover" />
                      <span className="absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded bg-background/70 text-muted-foreground opacity-0 transition-opacity group-hover/foto:opacity-100">
                        <GripVertical className="h-3 w-3" />
                      </span>
                      <button
                        type="button"
                        onClick={() => quitarImagen(idx)}
                        title="Quitar"
                        className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground transition-colors hover:text-destructive sm:h-5 sm:w-5"
                      >
                        <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                      </button>
                      {/* La foto chica se marca acá mismo, no en un cartel aparte */}
                      {medidas[url] && medidas[url].ancho < FOTO_ANCHO_MINIMO && (
                        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-warning/90 py-0.5 text-[9px] font-semibold text-warning-foreground">
                          <TriangleAlert className="h-2.5 w-2.5" /> chica
                        </span>
                      )}
                      {idx !== 0 && (
                        <button
                          type="button"
                          onClick={() => hacerPortada(idx)}
                          title="Elegir como portada"
                          /* En táctil no hay hover: si la portada solo aparece al pasar el
                             mouse, desde el celular NO SE PUEDE ELEGIR. Visible siempre abajo
                             de `sm`, al hover de `sm` para arriba. */
                          className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/85 py-1 text-[10px] font-medium text-foreground transition-all hover:bg-primary/85 hover:text-primary-foreground sm:py-0.5 sm:text-[9px] sm:opacity-0 sm:group-hover/foto:opacity-100"
                        >
                          <Star className="h-2.5 w-2.5" /> Portada
                        </button>
                      )}
                    </div>
                  ))}
                  {/* Sin ninguna foto, el único camino es el cuadro grande de arriba: dos
                      botones para lo mismo, uno al lado del otro, es una elección falsa. */}
                  {!lleno && imagenes.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => camaraRef.current?.click()}
                        disabled={uploading}
                        className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50 sm:hidden"
                      >
                        {uploading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Camera className="h-5 w-5" />}
                        <span className="text-[10px]">Cámara</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                        className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                      >
                        {uploading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <ImagePlus className="h-5 w-5" />}
                        <span className="text-[10px]">Subir</span>
                      </button>
                    </>
                  )}
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
                />
                <input
                  ref={camaraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
                />

                {!lleno && (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarImagen(urlInput); setUrlInput(""); } }}
                        placeholder="…o pegá la URL de una imagen"
                        className="h-10 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => { agregarImagen(urlInput); setUrlInput(""); }}
                      className="rounded-lg border border-border px-3 text-sm text-foreground transition-colors hover:bg-muted/20"
                    >
                      Agregar
                    </button>
                  </div>
                )}

                {/* LA MEDIDA, DICHA ANTES DE SUBIR. Era el pedido: que se sepa qué cargar. */}
                <Nota compacta acento={chicas.length > 0 ? "warning" : "muted"}>
                  {chicas.length > 0 ? (
                    <>
                      {chicas.length === 1 ? "Una de las fotos mide" : `${chicas.length} fotos miden`} menos de{" "}
                      <span className="font-semibold text-foreground">{FOTO_ANCHO_MINIMO} px</span> de ancho: se van a ver
                      borrosas en la tarjeta del catálogo y en la ficha. Lo ideal son{" "}
                      <span className="font-semibold text-foreground">{FOTO_IDEAL.ancho} × {FOTO_IDEAL.alto} px</span>.
                    </>
                  ) : (
                    <>
                      Ideal <span className="font-semibold text-foreground">{FOTO_IDEAL.ancho} × {FOTO_IDEAL.alto} px</span> (proporción 4:3,
                      la misma con la que se recorta en el catálogo) · mínimo{" "}
                      <span className="font-semibold text-foreground">{FOTO_ANCHO_MINIMO} px</span> de ancho ·
                      JPG, PNG o WebP de hasta <span className="font-semibold text-foreground">{PESO_MAXIMO_MB} MB</span>.
                      La primera foto es la portada. Las más grandes se achican solas a{" "}
                      <span className="font-semibold text-foreground">{LADO_MAXIMO} px</span> antes de subirse.
                    </>
                  )}
                </Nota>

                {/* Lo que se achicó, con los números: es la diferencia entre que el catálogo
                    abra rápido o tarde, y no se ve por ningún otro lado. */}
                {ahorro && (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-success">{ahorro.fotos === 1 ? "Foto optimizada" : `${ahorro.fotos} fotos optimizadas`}</span>:{" "}
                    <span className="font-mono tabular-nums">{formatPeso(ahorro.antes)}</span> →{" "}
                    <span className="font-mono font-semibold tabular-nums text-foreground">{formatPeso(ahorro.despues)}</span>
                  </p>
                )}
              </section>

              {/* ═══════════ DATOS ═══════════ */}
              <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
                <Field label="Nombre" required>
                  <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del producto" required />
                </Field>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Categoría">
                    <Input
                      value={categoria}
                      onChange={(e) => setCategoria(e.target.value)}
                      placeholder="Electrodomésticos…"
                      list="prod-categorias"
                    />
                    <datalist id="prod-categorias">
                      {categorias.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </Field>
                  <Field label="SKU / código">
                    <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="opcional" />
                  </Field>
                </div>

                <Field label="Precio ($)" required hint="Se toma como capital del crédito">
                  <MoneyInput value={precio} onChange={setPrecio} required />
                </Field>
                {editando && creditosVivos > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2.5 text-xs text-warning">
                    <Info className="mt-px h-4 w-4 shrink-0" />
                    <span>
                      Este producto tiene <strong>{creditosVivos}</strong> crédito{creditosVivos !== 1 ? "s" : ""} activo{creditosVivos !== 1 ? "s" : ""}.
                      Cambiar el precio aplica solo a créditos <strong>futuros</strong>; los ya otorgados conservan su monto.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {editando ? (
                    <Field label="Stock actual" hint="Se ajusta desde la ficha (entrada/ajuste)">
                      <div className="flex h-12 items-center rounded-lg border border-border bg-muted/20 px-3 font-mono tabular-nums text-foreground">
                        {producto?.stock ?? 0} u.
                      </div>
                    </Field>
                  ) : (
                    <Field label="Stock inicial (unidades)" required>
                      <Input type="number" inputMode="numeric" min="0" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" className="font-mono tabular-nums" />
                    </Field>
                  )}
                  <Field label="Stock mínimo" hint="Alerta de bajo stock">
                    <Input type="number" inputMode="numeric" min="0" value={stockMin} onChange={(e) => setStockMin(e.target.value)} placeholder="opcional" className="font-mono tabular-nums" />
                  </Field>
                </div>

                <Field label="Descripción">
                  <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} placeholder="Detalle, modelo, características…" />
                </Field>

                <Field label="Estado">
                  <Select value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </Select>
                </Field>
              </section>
            </div>
          </div>

          {/* Los botones, pegados abajo: el formulario es largo y la acción principal no puede
              depender de scrollear hasta el fondo. */}
          <div className="sticky bottom-0 z-10 border-t border-border/60 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <div className="mx-auto flex w-full max-w-6xl flex-col-reverse gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={volver}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || !puedeGuardar}
                className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 sm:min-w-44"
              >
                {loading ? "Guardando…" : editando ? "Guardar cambios" : "Crear producto"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

export type { Producto };
