import type { Role } from "@prisma/client";

export type { Role };

/**
 * Política de acceso por RUTA (no por acción). Fuente única de verdad para el
 * guard de rutas (Layout Guard server-side) y para el filtrado cosmético del
 * menú (AppShell). Archivo puro, sin dependencias de servidor → usable también
 * en componentes cliente (el type Role se borra en compilación).
 *
 * Las restricciones por ACCIÓN (p. ej. "el cobrador NO crea créditos") se
 * aplican ADEMÁS en cada Route Handler con requireRole() — defensa en
 * profundidad. El guard de ruta solo decide si la pantalla es accesible.
 *
 * Política de los 3 roles:
 *  - admin:    todo (Reportes, Caja, Configuración, Auditoría, Personal, Proveedores).
 *  - vendedor: Clientes (ABM) + Créditos (alta/simulación). Nada de config/reportes.
 *  - cobrador: Pagos + Cobranza; ve Clientes/Créditos (la negativa a crear créditos
 *              se aplica a nivel API, no de ruta).
 *
 * Deny-by-default: una ruta sin regla que matchee → denegada.
 */
const ACCESO_RUTAS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/usuarios", roles: ["admin"] },
  { prefix: "/configuracion", roles: ["admin"] },
  { prefix: "/reportes", roles: ["admin"] },
  { prefix: "/auditoria", roles: ["admin"] },
  { prefix: "/caja", roles: ["admin"] },
  { prefix: "/personal", roles: ["admin"] },
  { prefix: "/proveedores", roles: ["admin"] },
  { prefix: "/cobranza", roles: ["admin", "cobrador"] },
  { prefix: "/pagos", roles: ["admin", "cobrador"] },
  { prefix: "/cartera", roles: ["admin", "cobrador"] },
  { prefix: "/creditos", roles: ["admin", "vendedor", "cobrador"] },
  { prefix: "/clientes", roles: ["admin", "vendedor", "cobrador"] },
  { prefix: "/", roles: ["admin", "vendedor", "cobrador"] },
];

/** Devuelve los roles permitidos para una ruta (match por prefijo más largo). */
function rolesDeRuta(pathname: string): Role[] | null {
  let mejor: { prefix: string; roles: Role[] } | null = null;
  for (const r of ACCESO_RUTAS) {
    const matchea =
      r.prefix === "/" // "/" actúa de fallback: matchea cualquier ruta
        ? true
        : pathname === r.prefix || pathname.startsWith(r.prefix + "/");
    if (matchea && (!mejor || r.prefix.length > mejor.prefix.length)) mejor = r;
  }
  return mejor ? mejor.roles : null;
}

/** ¿Este rol puede acceder a esta ruta? Deny-by-default ante rol nulo o ruta sin regla. */
export function canAccess(role: Role | null | undefined, pathname: string): boolean {
  if (!role) return false;
  const roles = rolesDeRuta(pathname);
  return roles ? roles.includes(role) : false;
}

/** Pantalla de aterrizaje por rol (para redirigir tras un acceso denegado). */
export function homeFor(role: Role): string {
  switch (role) {
    case "admin":
      return "/";
    case "cobrador":
      return "/cobranza";
    case "vendedor":
      return "/clientes";
    default:
      return "/";
  }
}
