/**
 * Load shedding: staggered joins via Redis queue
 * Soft queue - when join pressure is high, throttle new joins
 */
import redisClient from '../../config/redis.js';
import { redisWithCircuitBreaker } from '../../config/redisCircuitBreaker.js';

const JOIN_QUEUE_KEY = 'quiz:join:queue';
const JOIN_ACTIVE_KEY = 'quiz:join:active';
const MAX_CONCURRENT_JOINS = 500;
const STAGGER_MS = 50;

export async function acquireJoinSlot(quizDate) {
  const key = `${JOIN_ACTIVE_KEY}:${quizDate}`;
  try {
    const count = await redisWithCircuitBreaker(() => redisClient.incr(key), 0);
    if (count === 1) await redisClient.expire(key, 3600);
    if (count > MAX_CONCURRENT_JOINS) {
      await redisClient.decr(key);
      return { allowed: false, retryAfterMs: STAGGER_MS };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

export async function releaseJoinSlot(quizDate) {
  const key = `${JOIN_ACTIVE_KEY}:${quizDate}`;
  try {
    await redisWithCircuitBreaker(() => redisClient.incrby ? redisClient.incrby(key, -1) : Promise.resolve());
  } catch {}
}
