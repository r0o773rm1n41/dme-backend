/**
 * Redis circuit breaker - graceful degradation on failures
 */
import redisClient from './redis.js';

const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 30000;
let failureCount = 0;
let lastFailureTime = 0;
let circuitState = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN

export function isRedisHealthy() {
  if (circuitState === 'OPEN') {
    if (Date.now() - lastFailureTime > RECOVERY_TIMEOUT_MS) {
      circuitState = 'HALF_OPEN';
    } else {
      return false;
    }
  }
  return true;
}

export async function redisWithCircuitBreaker(operation, fallback = null) {
  if (!isRedisHealthy()) return fallback;
  try {
    const result = await Promise.race([
      operation(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Redis timeout')), 2000))
    ]);
    if (circuitState === 'HALF_OPEN') circuitState = 'CLOSED';
    failureCount = 0;
    return result;
  } catch (err) {
    failureCount++;
    lastFailureTime = Date.now();
    if (failureCount >= FAILURE_THRESHOLD) circuitState = 'OPEN';
    console.warn('Redis circuit breaker:', err.message, 'fallback to', fallback !== null ? 'default' : 'null');
    return fallback;
  }
}

export async function redisGet(key, fallback = null) {
  return redisWithCircuitBreaker(() => redisClient.get(key), fallback);
}

export async function redisSet(key, value, options = {}, fallback = 'OK') {
  return redisWithCircuitBreaker(() => {
    if (options.ex) return redisClient.setEx(key, options.ex, value);
    return redisClient.set(key, value, options);
  }, fallback);
}
