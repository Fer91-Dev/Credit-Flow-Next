import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardMetrics } from "@/components/dashboard/DashboardMetrics";

export default function CarteraPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon="chart-increasing"
        title="Cartera"
        subtitle="Métricas generales de la cartera"
        accent="primary"
      />
      <DashboardMetrics />
    </div>
  );
}
