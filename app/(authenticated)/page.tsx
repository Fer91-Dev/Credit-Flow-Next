import { DashboardMetrics } from "@/components/dashboard/DashboardMetrics";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Command Center</h1>
        <p className="text-sm text-muted-foreground mt-1">Panel de control · CreditFlow</p>
      </div>
      <DashboardMetrics />
    </div>
  );
}
