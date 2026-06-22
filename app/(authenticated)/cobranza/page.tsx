import { CobranzaTable } from "@/components/cobranza/CobranzaTable";
import { requireAuth } from "@/lib/auth";

export default async function CobranzaPage() {
  const { role } = await requireAuth();
  return <CobranzaTable role={role} />;
}
