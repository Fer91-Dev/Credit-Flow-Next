import { Home } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { HomeView } from "@/components/dashboard/HomeView";
import { requireAuth } from "@/lib/auth";

export default async function DashboardPage() {
  const { role } = await requireAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Home}
        title="Home"
        subtitle="Panel de control · CreditFlow"
        accent="primary"
      />
      <HomeView role={role} />
    </div>
  );
}
