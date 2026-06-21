import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-2">
        <p className="font-mono text-5xl font-bold tracking-tight text-primary">404</p>
        <h1 className="text-lg font-semibold text-foreground">Página no encontrada</h1>
        <p className="text-sm text-muted-foreground">La sección que buscás no existe o fue movida.</p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
