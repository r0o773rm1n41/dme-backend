// modules/admin/adminAudit.service.js
import AdminAudit from "./adminAudit.model.js";

export async function logAdminAction(adminId, action, targetType, targetId, details = {}, req = null, beforeAfter = null) {
  try {
    const auditPayload = {
      admin: adminId,
      action,
      targetType,
      targetId,
      details,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.headers?.['user-agent']
    };
    if (beforeAfter) {
      auditPayload.beforeSnapshot = beforeAfter.before;
      auditPayload.afterSnapshot = beforeAfter.after;
    }
    const auditEntry = new AdminAudit(auditPayload);
    await auditEntry.save();
    console.log(`Admin audit: ${action} by ${adminId} on ${targetType}:${targetId}`);
  } catch (error) {
    console.error('Failed to log admin action:', error);
  }
}

export async function getAdminAuditLog(adminId = null, action = null, limit = 100) {
  const query = {};
  if (adminId) query.admin = adminId;
  if (action) query.action = action;

  return await AdminAudit.find(query)
    .populate('admin', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit);
}

export async function getAuditTrail(targetType, targetId) {
  return await AdminAudit.find({ targetType, targetId })
    .populate('admin', 'name email')
    .sort({ createdAt: -1 });
}