import User from "../user/user.model.js";
import { hasUserPaidEver } from "./payment.service.js";

/**
 * Check and optionally consume one PDF upload credit.
 * Business rule: only lifetime flag determines access. Temporary credits are no longer honored.
 * Legacy users who paid before the flag existed are migrated automatically.
 */
export async function checkAndConsumePdfUpload(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  if (user.hasPdfAccess) {
    return { allowed: true, lifetime: true };
  }

  // Legacy migration: if they ever paid, upgrade them
  const hadAnyPayment = await hasUserPaidEver(userId);
  if (hadAnyPayment) {
    user.hasPdfAccess = true;
    await user.save();
    return { allowed: true, lifetime: true };
  }

  return { allowed: false, lifetime: false };
}

/**
 * Check and optionally consume one PDF download credit.
 * Lifetime access only; temporary credits are ignored.
 */
export async function checkAndConsumePdfDownload(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  if (user.hasPdfAccess) {
    return { allowed: true, lifetime: true };
  }

  const hadAnyPayment = await hasUserPaidEver(userId);
  if (hadAnyPayment) {
    user.hasPdfAccess = true;
    await user.save();
    return { allowed: true, lifetime: true };
  }

  return { allowed: false, lifetime: false };
}

