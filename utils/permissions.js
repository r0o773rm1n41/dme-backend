/**
 * Admin privilege tiers - zero-trust enforcement
 * ADMIN_VIEW: read-only
 * ADMIN_MUTATE: create/update (no delete, no user block)
 * SUPER_ADMIN: full access
 */
export const ADMIN_PRIVILEGES = {
  ADMIN_VIEW: ['dashboard', 'quiz', 'users', 'payments', 'refunds', 'audit', 'analytics', 'anticheat', 'blogs/pending', 'winners', 'system/health'],
  ADMIN_MUTATE: ['quiz/create', 'quiz/update', 'quiz/lock', 'quiz/start', 'quiz/end', 'questions/bulk', 'blogs/approve', 'blogs/reject', 'refunds/process', 'refunds/status'],
  SUPER_ADMIN: ['users/block', 'users/unblock', 'users/delete', 'quiz/delete']
};

export function getRequiredPrivilege(action, resource) {
  const key = `${resource}/${action}`.toLowerCase();
  if (ADMIN_PRIVILEGES.SUPER_ADMIN.some(p => key.includes(p))) return 'SUPER_ADMIN';
  if (ADMIN_PRIVILEGES.ADMIN_MUTATE.some(p => key.includes(p))) return 'ADMIN_MUTATE';
  return 'ADMIN_VIEW';
}

export function hasPrivilege(userRole, requiredPrivilege) {
  const hierarchy = { SUPER_ADMIN: 3, QUIZ_ADMIN: 2, CONTENT_ADMIN: 2, USER: 1 };
  const required = { SUPER_ADMIN: 3, ADMIN_MUTATE: 2, ADMIN_VIEW: 1 };
  return (hierarchy[userRole] || 0) >= (required[requiredPrivilege] || 0);
}
