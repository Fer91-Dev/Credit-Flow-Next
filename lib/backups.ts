/**
 * Backups — puente con la GitHub Action `backup.yml` (dump nocturno cifrado → R2).
 *
 * El respaldo REAL corre en GitHub Actions (ver `.github/workflows/backup.yml`): esto es
 * solo el control remoto para (a) dispararlo a demanda desde el SaaS y (b) leer el estado
 * de las últimas corridas. No toca la base ni R2 directamente.
 *
 * Requiere `GITHUB_BACKUP_TOKEN` (PAT fine-grained con permiso Actions: Read & Write sobre
 * el repo). Si falta, las funciones lanzan `BACKUP_NOT_CONFIGURED` y la UI lo muestra como
 * "el disparo manual no está configurado" (el backup automático nocturno sigue corriendo).
 */
import { ApiError } from "@/lib/auth";

const GH_API = "https://api.github.com";
const REPO = process.env.GITHUB_BACKUP_REPO ?? "Fer91-Dev/Credit-Flow-Next";
const WORKFLOW_FILE = process.env.GITHUB_BACKUP_WORKFLOW ?? "backup.yml";
const BRANCH = process.env.GITHUB_BACKUP_BRANCH ?? "main";

function token(): string {
  const t = process.env.GITHUB_BACKUP_TOKEN;
  if (!t) {
    throw new ApiError(
      "El backup manual no está configurado (falta GITHUB_BACKUP_TOKEN). El backup automático nocturno igual corre.",
      "BACKUP_NOT_CONFIGURED",
      503,
    );
  }
  return t;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "creditflow-backup",
  };
}

export type CorridaBackup = {
  id: number;
  estado: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ...
  creado: string; // ISO
  url: string; // enlace a la corrida en GitHub
  disparadoPor: string | null; // login que la disparó (o "cron")
};

/**
 * Dispara el workflow de backup (workflow_dispatch). GitHub responde 204 sin cuerpo si
 * lo encoló bien. Lanza ApiError con mensaje accionable ante 401/403/otros.
 */
export async function dispararBackup(): Promise<void> {
  const res = await fetch(
    `${GH_API}/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: BRANCH }),
    },
  );
  if (res.status === 204) return;
  const detalle = (await res.text().catch(() => "")).slice(0, 200);
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(
      "GitHub rechazó el token del backup (permisos insuficientes o token vencido).",
      "BACKUP_AUTH",
      502,
    );
  }
  if (res.status === 404) {
    throw new ApiError(
      "No se encontró el workflow de backup en GitHub (revisá repo/rama).",
      "BACKUP_NOT_FOUND",
      502,
    );
  }
  throw new ApiError(
    `No se pudo iniciar el backup (GitHub ${res.status}). ${detalle}`,
    "BACKUP_DISPATCH_FAILED",
    502,
  );
}

/** Últimas corridas del workflow de backup (para mostrar estado en la UI). */
export async function listarCorridasBackup(limite = 5): Promise<CorridaBackup[]> {
  const res = await fetch(
    `${GH_API}/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${limite}`,
    { headers: headers(), cache: "no-store" },
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new ApiError("GitHub rechazó el token del backup.", "BACKUP_AUTH", 502);
    }
    throw new ApiError(
      `No se pudo consultar el estado del backup (GitHub ${res.status}).`,
      "BACKUP_RUNS_FAILED",
      502,
    );
  }
  const json = (await res.json()) as { workflow_runs?: Array<Record<string, any>> };
  return (json.workflow_runs ?? []).map((r) => ({
    id: r.id as number,
    estado: r.status as string,
    conclusion: (r.conclusion as string | null) ?? null,
    creado: r.created_at as string,
    url: r.html_url as string,
    disparadoPor: (r.triggering_actor?.login as string | undefined) ?? (r.actor?.login as string | undefined) ?? null,
  }));
}
