import { AppShell } from "@/components/AppShell";
import { SWRProvider } from "@/components/providers/SWRProvider";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SWRProvider>
      <AppShell>{children}</AppShell>
    </SWRProvider>
  );
}
