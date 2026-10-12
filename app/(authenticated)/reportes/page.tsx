import { ReportesView } from "@/components/reportes/ReportesView";

export default async function ReportesPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  // `?periodo=hoy` llega desde la píldora "HOY" del Home.
  const { periodo } = await searchParams;
  return <ReportesView periodoInicial={periodo} />;
}
