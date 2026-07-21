import { CreditosTable } from "@/components/creditos/CreditosTable";
import { requireAuth } from "@/lib/auth";

export default async function CreditosPage() {
  const { role } = await requireAuth();
  return <CreditosTable role={role} />;
}
