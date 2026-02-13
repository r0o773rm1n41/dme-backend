/**
 * Zero-trust socket lifecycle: JWT revalidation on every critical event.
 * Token expiry mid-quiz triggers disconnect.
 */
import jwt from 'jsonwebtoken';
import User from '../modules/user/user.model.js';

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY_TOLERANCE_MS = 60000; // Disconnect 1 min before actual expiry

export async function verifySocketToken(token) {
  if (!token) return { valid: false, reason: 'no_token' };
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.uid) return { valid: false, reason: 'invalid_payload' };
    // Support string _id values by querying directly
    const user = await User.findOne({ _id: payload.uid }).select('-passwordHash');
    if (!user) return { valid: false, reason: 'user_not_found' };
    return { valid: true, user, payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { valid: false, reason: 'expired', expiredAt: err.expiredAt };
    return { valid: false, reason: err.message || 'invalid' };
  }
}

export function isTokenExpiringSoon(payload) {
  if (!payload.exp) return true;
  const expMs = payload.exp * 1000;
  return Date.now() >= expMs - TOKEN_EXPIRY_TOLERANCE_MS;
}

/**
 * Revalidate token for critical socket events. Call before processing join-quiz, etc.
 * Returns { valid: true, user } or { valid: false, reason }.
 */
export async function revalidateSocketAuth(socket) {
  const token = socket.handshake?.auth?.token || socket.handshake?.headers?.authorization?.split(' ')?.[1];
  const result = await verifySocketToken(token);
  if (result.valid && result.user) {
    socket.user = result.user;
    if (isTokenExpiringSoon(result.payload)) {
      return { valid: false, reason: 'token_expiring_soon' };
    }
  }
  return result;
}
