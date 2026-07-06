/**
 * Dueño del SaaS (platform owner) — distinto del `admin` de un tenant. Puede administrar
 * los planes de TODOS los tenants (activar Pro cuando un cliente paga). Se identifica por
 * email, configurable con la env `SAAS_OWNER_EMAILS` (lista separada por comas). Por
 * defecto, el email del dueño del proyecto, para que funcione sin configurar nada.
 */
const OWNERS = (process.env.SAAS_OWNER_EMAILS ?? "vallefernando884@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function esOwner(email?: string | null): boolean {
  return !!email && OWNERS.includes(email.toLowerCase());
}
