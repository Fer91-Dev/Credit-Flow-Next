/**
 * Helper para filtro obligatorio de tenant (user_id).
 * NUNCA omitir este filtro en queries de negocio.
 */
export function withTenant(userId: string) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('withTenant: userId inválido');
  }
  return { user_id: userId };
}

/**
 * Helper para combinar filtros de tenant con filtros adicionales.
 * Uso: { ...withTenant(userId), estado: 'activo' }
 */
export function withTenantAnd(userId: string, ...filters: Record<string, any>[]) {
  return {
    ...withTenant(userId),
    ...filters.reduce((acc, f) => ({ ...acc, ...f }), {}),
  };
}
