import { redirect } from "next/navigation";
import { PlataformaView } from "@/components/plataforma/PlataformaView";
import { requireAuth } from "@/lib/auth";

export default async function PlataformaPage() {
  const ctx = await requireAuth();
  if (!ctx.esOwner) redirect("/"); // solo el dueño de la plataforma
  return <PlataformaView />;
}
