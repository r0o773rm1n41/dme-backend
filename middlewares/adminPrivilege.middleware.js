import { getRequiredPrivilege, hasPrivilege } from '../utils/permissions.js';

export function privilegeRequired(requiredPrivilege) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Auth required' });
    if (!hasPrivilege(req.user.role, requiredPrivilege)) {
      return res.status(403).json({ message: 'Insufficient admin privilege', required: requiredPrivilege });
    }
    next();
  };
}

export function privilegeForRoute(routePath, method) {
  const key = routePath.replace(/^\/admin\/?/, '').toLowerCase();
  if (['users/:userId/block', 'users/:userId/unblock', 'users/:userId'].some(p => key.includes('users'))) {
    return method === 'GET' ? 'ADMIN_VIEW' : 'SUPER_ADMIN';
  }
  if (['quiz/:quizDate', 'quiz'].some(p => key.includes('quiz')) && method === 'DELETE') return 'SUPER_ADMIN';
  if (['quiz', 'questions', 'blogs', 'refunds'].some(p => key.includes(p)) && ['POST', 'PUT', 'PATCH'].includes(method)) return 'ADMIN_MUTATE';
  return 'ADMIN_VIEW';
}
