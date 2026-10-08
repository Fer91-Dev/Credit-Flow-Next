/**
 * Lo que comparten `respaldo-docs.mjs` (SUBIR) y `traer-docs.mjs` (BAJAR): rutas, el registro de
 * la última sincronización de ESTA máquina y la guía de PC nueva que va como LEEME del repo.
 *
 * Fernando trabaja desde dos máquinas (PC y notebook, 03/10/2026). La memoria de Claude vive en
 * cada máquina por separado, así que se sincroniza a través del repo privado `creditflow-docs`:
 * al EMPEZAR se trae, al TERMINAR se sube.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROYECTO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RAIZ = resolve(PROYECTO, "..");
export const DESTINO = process.env.RESPALDO_DOCS_DIR ?? join(RAIZ, "respaldo-docs");
export const REPO_DOCS = "https://github.com/Fer91-Dev/creditflow-docs.git";

/**
 * Carpeta de memoria de Claude Code para ESTE proyecto. Claude Code la nombra con la ruta donde
 * se abre el proyecto, cambiando `:` y las barras por guiones: `F:\ProyectoSilvio` →
 * `f--ProyectoSilvio`. En la notebook puede ser otra unidad (`C:\ProyectoSilvio` →
 * `c--ProyectoSilvio`), así que se calcula, y si ya existe una con otra mayúscula se usa esa.
 */
export function carpetaMemoria() {
  if (process.env.MEMORIA_DIR) return process.env.MEMORIA_DIR;
  const proyectos = join(homedir(), ".claude", "projects");
  const nombre = RAIZ.replace(/[:\\/]/g, "-").replace(/^([A-Z])/, (l) => l.toLowerCase());
  if (existsSync(proyectos)) {
    const existente = readdirSync(proyectos).find((d) => d.toLowerCase() === nombre.toLowerCase());
    if (existente) return join(proyectos, existente, "memory");
  }
  return join(proyectos, nombre, "memory");
}

/** Registro, en ESTA máquina, del último commit del respaldo que se trajo o se subió. */
const REGISTRO = join(homedir(), ".claude", "creditflow-docs-sync.json");
export function ultimoSync() {
  try { return JSON.parse(readFileSync(REGISTRO, "utf8")).sha ?? null; } catch { return null; }
}
export function registrarSync(sha) {
  mkdirSync(dirname(REGISTRO), { recursive: true });
  writeFileSync(REGISTRO, JSON.stringify({ sha, cuando: new Date().toISOString() }, null, 2));
}

export const GUIA_PC_NUEVA = `# CreditFlow · Documentación privada y guía de PC nueva

Copia PRIVADA de lo que no está en el repo del sistema: documentación (\`.md\`), la **memoria de
Claude**, las skills, los manuales en PDF, los logos y los \`.bat\` de arranque. Cada sincronización
es un commit: el historial permite volver a cualquier versión.

> El código está en \`Fer91-Dev/Credit-Flow-Next\`. La base de producción se respalda sola cada
> noche en Cloudflare R2 (ver \`entrega/Como-restaurar-un-respaldo-Credit-Zero.pdf\`).

---

## 🔁 Trabajar desde dos máquinas (PC y notebook)

Claude no recuerda las conversaciones: lo que le permite retomar es su **memoria**, que vive en
cada máquina por separado. Por eso hay una regla de oro:

| Cuándo | Qué | Comando (desde \`creditflow-next\`) |
|---|---|---|
| **Al EMPEZAR** a trabajar | Traer el código y la memoria de la otra máquina | \`git pull\` y después \`npm run docs:traer\` |
| **Al TERMINAR** | Subir el código y la memoria | (los commits los hace Claude) y \`npm run respaldo:docs\` |

Se lo podés pedir a Claude directamente: *"traé lo último"* al arrancar y *"subí la documentación"*
al cerrar.

- **No trabajar en las dos a la vez.** Si te olvidás de traer, \`respaldo:docs\` se niega a subir
  y te avisa: así una máquina nunca pisa lo que hizo la otra.
- \`docs:traer\` guarda una copia de lo que había en la máquina antes de reemplazarlo (carpeta
  \`ProyectoSilvio/.sync-previo/\`), por si algo no se había subido.

---

## 💻 Dejar una máquina nueva lista (notebook o PC de reemplazo)

**Tiempo estimado: 45 minutos.** Necesitás KeePass a mano (ahí están las claves).

### 1. Instalar los programas
En PowerShell (menú Inicio → "PowerShell"):

\`\`\`powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install GitHub.cli
winget install Docker.DockerDesktop
\`\`\`

Y **Claude Code**: instalar la extensión *Claude Code* en VS Code (o la app de escritorio) e iniciar
sesión con la misma cuenta de siempre. Cerrá y abrí PowerShell después de instalar.

### 2. Iniciar sesión en GitHub
\`\`\`powershell
gh auth login
\`\`\`
Elegí *GitHub.com* → *HTTPS* → *Login with a web browser*. Cuenta: **Fer91-Dev**.

### 3. Bajar el código y la documentación
Conviene usar la **misma ruta** en todas las máquinas. Si la notebook no tiene disco \`F:\`, usá
\`C:\\ProyectoSilvio\` (funciona igual; los \`.bat\` de arranque traen \`F:\` escrito y habría que
editarlos).

\`\`\`powershell
mkdir F:\\ProyectoSilvio
cd F:\\ProyectoSilvio
git clone https://github.com/Fer91-Dev/Credit-Flow-Next.git creditflow-next
cd creditflow-next
git checkout preview
npm install
npm run docs:traer
\`\`\`

\`docs:traer\` clona este repo en \`ProyectoSilvio/respaldo-docs\` y pone cada cosa en su lugar:
la memoria de Claude, las skills, los \`.md\`, los manuales, los logos y los \`.bat\`.

### 4. Los archivos de configuración (claves)
Van en \`creditflow-next\` y **nunca** se suben a ningún repo. Están guardados como adjuntos en
KeePass. Son estos:

| Archivo | Para qué | ¿Imprescindible? |
|---|---|---|
| \`.env.local\` | Desarrollo: base de pruebas, Supabase de dev, mail (Gmail) y Sentry | **Sí** |
| \`.env.production.local\` | Conexión a producción: consultas de solo lectura y el pase a producción | **Sí** |
| \`.env.vercel-mailer.local\` | Credenciales del mail (Gmail) | No (está en \`.env.local\`) |
| \`.env.preview.local\` | Copia de las variables de la vista previa de Vercel | No (referencia) |
| \`.env.vercel.local\` | Copia de las variables bajadas de Vercel | No (referencia) |

Si alguno se perdiera: los valores de producción están en **Vercel → Settings → Environment
Variables**, y las direcciones y claves de las bases en **Supabase → Connect** y
**Project Settings → API**.

### 5. Probar
\`\`\`powershell
cd F:\\ProyectoSilvio\\creditflow-next
npm run dev
\`\`\`
Abrí \`http://localhost:3000\` y entrá con tu usuario de desarrollo.

### 6. Abrir Claude Code
Abrí la carpeta \`F:\\ProyectoSilvio\` en VS Code (la raíz, no \`creditflow-next\`) y abrí Claude
Code. Con la memoria ya traída, sabe todo lo del proyecto. Para confirmarlo, preguntale *"¿en qué
estado está el proyecto?"*.

---

## 🗂️ Qué hay en este repo

| Carpeta | Va en |
|---|---|
| \`sistema/*.md\` | la raíz de \`creditflow-next/\` |
| \`sistema/.claude/\` | \`creditflow-next/.claude/\` |
| \`skills/\` | \`ProyectoSilvio/.claude/skills/\` |
| \`memoria/\` | \`C:\\Users\\<usuario>\\.claude\\projects\\<carpeta-del-proyecto>\\memory\\\` |
| \`entrega/\`, \`logos/\` | \`ProyectoSilvio/entrega/\` y \`ProyectoSilvio/logos/\` |
| \`fer-server/\` | \`ProyectoSilvio/fer-server/\` (scripts del servidor Oracle) |
| \`raiz/\` | los \`.bat\` de arranque, en \`ProyectoSilvio/\` |

\`<carpeta-del-proyecto>\` sale de la ruta donde se abre el proyecto: \`F:\\ProyectoSilvio\` →
\`f--ProyectoSilvio\`; \`C:\\ProyectoSilvio\` → \`c--ProyectoSilvio\`. \`docs:traer\` lo calcula solo.

## 🔐 Lo que NO está acá, a propósito
- Los \`.env*\` (claves): van en KeePass.
- **El archivo de KeePass**: tenelo sincronizado fuera de cualquier máquina (Google Drive o un
  pendrive). Ahí está la clave privada de los respaldos de la base: sin ella, los respaldos no se
  pueden abrir.
`;
