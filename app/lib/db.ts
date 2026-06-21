/**
 * Helper para el filtro obligatorio de tenant (Modelo Org: tenant_id).
 * NUNCA omitir este filtro en queries de negocio. El valor debe provenir del
 * contexto de sesión: withTenant(ctx.tenantId).
 */
export function withTenant(tenantId: string) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('withTenant: tenantId inválido');
  }
  return { tenant_id: tenantId };
}

/**
 * Helper para combinar el filtro de tenant con filtros adicionales.
 * Uso: { ...withTenant(tenantId), estado: 'activo' }
 */
export function withTenantAnd(tenantId: string, ...filters: Record<string, any>[]) {
  return {
    ...withTenant(tenantId),
    ...filters.reduce((acc, f) => ({ ...acc, ...f }), {}),
  };
}
