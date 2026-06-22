import { Home } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { HomeView } from "@/components/dashboard/HomeView";
import { requireAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/auth/roles";

export default async function DashboardPage() {
  const { nombre, email, role } = await requireAuth();
  const displayName = nombre?.trim() || email || "Usuario";

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Home}
        title="Home"
        subtitle="Panel de control · CreditFlow"
        accent="primary"
        actions={
          <div className="flex items-center gap-2.5">
            <div className="text-right leading-tight">
              <p className="text-sm font-semibold text-foreground">{displayName}</p>
              <p className="text-[11px] text-muted-foreground">
                {role === "admin"
                  ? "Vista global de la organización"
                  : "Tu actividad y cartera"}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
              {ROLE_LABEL[role]}
            </span>
          </div>
        }
      />
      <HomeView role={role} />
    </div>
  );
}
