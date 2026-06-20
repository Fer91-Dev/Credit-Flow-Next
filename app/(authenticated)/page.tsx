import { Home } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { HomeView } from "@/components/dashboard/HomeView";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Home}
        title="Home"
        subtitle="Panel de control · CreditFlow"
        accent="primary"
      />
      <HomeView />
    </div>
  );
}
