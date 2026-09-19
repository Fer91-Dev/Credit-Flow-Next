import { ProductoFormView } from "@/components/productos/ProductoFormView";

export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductoFormView productoId={id} />;
}
