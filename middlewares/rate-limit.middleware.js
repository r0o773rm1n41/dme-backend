// middlewares/rate-limit.middleware.js
/**
 * Enterprise-Grade Rate Limiting Middleware
 * 
 * Features:
 * - Redis-based distributed rate limiting
 * - Per-user and per-IP rate limits
 * - Graceful degradation when Redis unavailable
 * - Proper error messages and retry-after headers
 * - Different limits for different endpoint types
 * - Development mode disables rate limiting
 */

import redis from "../config/redis.js";

const DEFAULT_WINDOW_MS = 60000; // 1 minute
const DEFAULT_MAX_REQUESTS = 100;

function getDeviceHash(req) {
  const fp = req.headers['x-device-fingerprint'] || req.body?.deviceFingerprint || '';
  const did = req.headers['x-device-id'] || req.body?.deviceId || '';
  return `${did}:${fp}`.slice(0, 64) || 'none';
}

/**
 * Main rate limit: IP + userId + deviceHash for NAT/mobile resilience
 */
export function rateLimit(windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS, keyPrefix = 'rate_limit') {
  return async (req, res, next) => {
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev') {
      return next();
    }

    try {
      const ip = req.ip || req.connection?.remoteAddress || 'anonymous';
      const userId = req.user?._id?.toString() || 'anon';
      const deviceHash = getDeviceHash(req);
      const endpoint = req.originalUrl.split('?')[0];
      const rateKey = `${keyPrefix}:${ip}:${userId}:${deviceHash.slice(0, 16)}:${endpoint}`;

      // Check Redis availability
      const redisAvailable = await checkRedisHealth();
      
      if (!redisAvailable) {
        // In production, fail open (allow request)
        console.warn('⚠️ Redis unavailable for rate limiting - allowing request');
        res.set('X-RateLimit-Degraded', 'true');
        return next();
      }

      // Get current request count with longer timeout for high load
      let currentRequests;
      try {
        currentRequests = await Promise.race([
          redis.get(rateKey),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 2000))
        ]);
      } catch (timeoutError) {
        // If Redis times out, fail open (allow request) to prevent service degradation
        console.warn('⚠️ Redis timeout in rate limiting - allowing request');
        res.set('X-RateLimit-Degraded', 'true');
        return next();
      }
      
      const requestCount = currentRequests ? parseInt(currentRequests) : 0;
      const remaining = Math.max(0, maxRequests - requestCount);
      const resetTime = new Date(Date.now() + windowMs).toISOString();

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': resetTime,
      });

      // Check if limit exceeded
      if (requestCount >= maxRequests) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.set('Retry-After', retryAfter.toString());
        
        console.warn(`⚠️ Rate limit exceeded for ${identifier} on ${endpoint}`);
        
        return res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.',
          retryAfter,
          timestamp: new Date().toISOString(),
        });
      }

      // Increment counter with longer timeout
      try {
        await Promise.race([
          redis.set(rateKey, requestCount + 1, { ex: Math.floor(windowMs / 1000) }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 2000))
        ]);
      } catch (timeoutError) {
        // If Redis times out during increment, still allow request but log warning
        console.warn('⚠️ Redis timeout during rate limit increment - allowing request');
        res.set('X-RateLimit-Degraded', 'true');
      }

      next();
    } catch (error) {
      console.error('❌ Rate limiting error:', error.message);
      // Fail open in case of error
      return next();
    }
  };
}

/**
 * Check Redis health with timeout
 */
async function checkRedisHealth() {
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 500))
    ]);
    return true;
  } catch (error) {
    console.warn('⚠️ Redis health check failed:', error.message);
    return false;
  }
}

/**
 * Production-ready rate limiters with proper categorization
 */

// AUTH ENDPOINTS - Strict limits to prevent brute force
export const authRateLimit = rateLimit(60 * 1000, 10, 'auth'); // 10 attempts per minute per IP

// READ ENDPOINTS - Lenient for user experience
export const readRateLimit = rateLimit(60 * 1000, 300, 'read'); // 300 requests per minute

// WRITE ENDPOINTS - Moderate limits
export const writeRateLimit = rateLimit(60 * 1000, 100, 'write'); // 100 requests per minute

// QUIZ ENDPOINTS - Optimized for 5000 concurrent users
export const quizAttemptRateLimit = rateLimit(60 * 60 * 1000, 20, 'quiz_attempt'); // 20 quiz attempts per hour per user
// Rate limit: 1 answer per question (allow up to 50 answers per quiz, but prevent rapid-fire submissions)
// Use 2 seconds window to prevent duplicate clicks, but allow answering different questions quickly
export const quizAnswerRateLimit = rateLimit(2 * 1000, 1, 'quiz_answer'); // 1 answer per 2 seconds per user (prevents double-clicks)
export const quizListRateLimit = rateLimit(60 * 1000, 1000, 'quiz_list'); // 1000 requests per minute per user/IP (optimized for high concurrency)
export const quizStatusRateLimit = rateLimit(60 * 1000, 120, 'quiz_status'); // 120 status checks per minute (2 per second max)
export const quizQuestionRateLimit = rateLimit(60 * 1000, 120, 'quiz_question'); // 120 question fetches per minute (2 per second max)

// BLOG ENDPOINTS - Balanced limits
export const blogViewRateLimit = rateLimit(60 * 1000, 200, 'blog_view'); // 200 blog views per minute
export const blogListRateLimit = rateLimit(60 * 1000, 200, 'blog_list'); // 200 list requests per minute

// FILE UPLOAD - Strict to prevent abuse
export const fileUploadRateLimit = rateLimit(60 * 60 * 1000, 10, 'file_upload'); // 10 uploads per hour

// PAYMENT - Very strict
export const paymentRateLimit = rateLimit(60 * 1000, 5, 'payment'); // 5 payment requests per minute

// REPORT - Moderate to prevent spam
export const reportRateLimit = rateLimit(60 * 60 * 1000, 20, 'report'); // 20 reports per hour

// GENERAL API - Fallback limit
export const generalRateLimit = rateLimit(60 * 1000, 200, 'general'); // 200 requests per minute
