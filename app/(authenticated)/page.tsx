import { PageHeader } from "@/components/ui/PageHeader";
import { HomeView } from "@/components/dashboard/HomeView";
import { PrimerosPasos } from "@/components/dashboard/PrimerosPasos";
import { requireAuth } from "@/lib/auth";

export default async function DashboardPage() {
  const { role } = await requireAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        icon="house"
        title="Home"
        subtitle="Panel de control · CreditFlow"
        accent="primary"
      />
      {role === "admin" && <PrimerosPasos />}
      <HomeView role={role} />
    </div>
  );
}
