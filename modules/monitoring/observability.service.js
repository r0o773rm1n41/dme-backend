// modules/monitoring/observability.service.js
import Quiz from '../quiz/quiz.model.js';
import QuizAttempt from '../quiz/quizAttempt.model.js';
import Winner from '../quiz/winner.model.js';
import Payment from '../payment/payment.model.js';
import User from '../user/user.model.js';
import redisClient from '../../config/redis.js';
import logger from '../../utils/logger.js';

class ObservabilityService {
  // Quiz State Timeline
  async recordQuizStateChange(quizDate, fromState, toState, metadata = {}) {
    const key = `quiz:${quizDate}:timeline`;
    const event = {
      timestamp: new Date(),
      fromState,
      toState,
      metadata
    };

    await redisClient.lpush(key, JSON.stringify(event));
    await redisClient.expire(key, 86400 * 30); // Keep for 30 days

    logger.info('Quiz state change recorded', { quizDate, fromState, toState, metadata });
  }

  async getQuizTimeline(quizDate) {
    const key = `quiz:${quizDate}:timeline`;
    const events = await redisClient.lrange(key, 0, -1);
    return events.map(event => JSON.parse(event)).reverse();
  }

  // Payment-Eligibility Mismatch Alert
  async checkPaymentEligibilityMismatch(quizDate) {
    const payments = await Payment.find({ quizDate, status: 'SUCCESS' });
    const paidUserIds = payments.map(p => p.user.toString());

    const attempts = await QuizAttempt.find({ quizDate, answersSaved: true });
    const attemptedUserIds = attempts.map(a => a.user.toString());

    const mismatches = [];

    // Users with payments but no attempts
    for (const userId of paidUserIds) {
      if (!attemptedUserIds.includes(userId)) {
        const user = await User.findById(userId);
        mismatches.push({
          type: 'PAID_NO_ATTEMPT',
          user: user?.phone,
          userId
        });
      }
    }

    // Users with attempts but no payments (shouldn't happen)
    for (const userId of attemptedUserIds) {
      if (!paidUserIds.includes(userId)) {
        const user = await User.findById(userId);
        mismatches.push({
          type: 'ATTEMPT_NO_PAYMENT',
          user: user?.phone,
          userId
        });
      }
    }

    if (mismatches.length > 0) {
      logger.warn('Payment-eligibility mismatches detected', { quizDate, mismatches });
      // In production, this would trigger alerts
    }

    return mismatches;
  }

  // WebSocket Connection Monitoring
  async recordWebSocketConnection(userId, action) {
    const key = `ws:connections:${new Date().toISOString().split('T')[0]}`;
    await redisClient.hincrby(key, action, 1); // connect/disconnect
    await redisClient.expire(key, 86400 * 7); // Keep for 7 days
  }

  async getWebSocketStats(date = new Date().toISOString().split('T')[0]) {
    const key = `ws:connections:${date}`;
    return await redisClient.hgetall(key);
  }

  // Finalize Latency Tracking
  async recordFinalizeLatency(quizDate, latencyMs, success = true) {
    const key = `finalize:latency:${quizDate}`;
    await redisClient.setex(key, 86400, JSON.stringify({ latencyMs, success, timestamp: new Date() }));

    // Track daily averages
    const dailyKey = `finalize:daily:${new Date().toISOString().split('T')[0]}`;
    await redisClient.lpush(dailyKey, latencyMs);
    await redisClient.ltrim(dailyKey, 0, 99); // Keep last 100
    await redisClient.expire(dailyKey, 86400 * 7);
  }

  async getFinalizeLatency(quizDate) {
    const key = `finalize:latency:${quizDate}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  }

  // Redis Fencing Failure Tracking
  async recordRedisFencingFailure(quizDate, operation) {
    const key = `fencing:failures:${quizDate}`;
    const event = {
      timestamp: new Date(),
      operation, // 'finalize', 'start', 'end', etc.
      token: await redisClient.get(`quiz:${quizDate}:${operation}`)
    };

    await redisClient.lpush(key, JSON.stringify(event));
    await redisClient.expire(key, 86400 * 7); // Keep for 7 days

    logger.warn('Redis fencing failure recorded', { quizDate, operation, event });
  }

  async getRedisFencingFailures(quizDate = null, limit = 50) {
    let keys;
    if (quizDate) {
      keys = [`fencing:failures:${quizDate}`];
    } else {
      keys = await redisClient.keys('fencing:failures:*');
    }

    const failures = [];
    for (const key of keys.slice(0, limit)) {
      const events = await redisClient.lrange(key, 0, limit - 1);
      failures.push(...events.map(event => JSON.parse(event)));
    }

    return failures.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  // Anti-cheat Monitoring
  async recordAntiCheatEvent(userId, quizDate, eventType, details = {}) {
    const key = `anticheat:events:${quizDate}`;
    const event = {
      timestamp: new Date(),
      userId,
      eventType, // 'device_mismatch', 'rapid_answer', 'suspicious_timing', etc.
      details
    };

    await redisClient.lpush(key, JSON.stringify(event));
    await redisClient.expire(key, 86400 * 30); // Keep for 30 days

    // Also track per user
    const userKey = `anticheat:user:${userId}`;
    await redisClient.lpush(userKey, JSON.stringify(event));
    await redisClient.ltrim(userKey, 0, 49); // Keep last 50 events per user
    await redisClient.expire(userKey, 86400 * 30);

    logger.warn('Anti-cheat event recorded', { userId, quizDate, eventType, details });
  }

  async getAntiCheatEvents(quizDate, limit = 100) {
    const key = `anticheat:events:${quizDate}`;
    const events = await redisClient.lrange(key, 0, limit - 1);
    return events.map(event => JSON.parse(event));
  }

  async getUserAntiCheatEvents(userId) {
    const key = `anticheat:user:${userId}`;
    const events = await redisClient.lrange(key, 0, -1);
    return events.map(event => JSON.parse(event)).reverse();
  }

  async executeAutoAction(userId, action, reason, metadata = {}) {
    try {
      if (action === 'TEMP_BLOCK') {
        const User = (await import('../user/user.model.js')).default;
        await User.updateOne({ _id: userId }, { $set: { isBlocked: true } });
        logger.warn('Auto-action: user temp blocked', { userId, reason, metadata });
      } else if (action === 'MARK_SUSPICIOUS') {
        await redisClient.lpush(`suspicious:${userId}`, JSON.stringify({ reason, metadata, at: new Date() }));
        await redisClient.ltrim(`suspicious:${userId}`, 0, 49);
        await redisClient.expire(`suspicious:${userId}`, 86400 * 30);
        logger.warn('Auto-action: attempt marked suspicious', { userId, reason, metadata });
      } else if (action === 'FORCE_LOGOUT') {
        await redisClient.setEx(`logout:${userId}`, 60, '1');
        if (global.io) {
          const socks = await global.io.fetchSockets();
          for (const s of socks) {
            if (s.user?._id?.toString() === userId.toString()) {
              s.emit('force-logout', { reason });
              s.disconnect(true);
            }
          }
        }
        logger.warn('Auto-action: user force logout', { userId, reason });
      }
    } catch (err) {
      logger.error('Auto-action failed', { userId, action, err: err.message });
    }
  }

  async detectSuspiciousActivity(userId, quizDate) {
    const events = await this.getUserAntiCheatEvents(userId);
    const recentEvents = events.filter(e => 
      new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    );

    const suspiciousPatterns = {
      multipleDeviceMismatches: recentEvents.filter(e => e.eventType === 'device_mismatch').length > 2,
      rapidAnswering: recentEvents.filter(e => e.eventType === 'rapid_answer').length > 5,
      timingAnomalies: recentEvents.filter(e => e.eventType === 'suspicious_timing').length > 3
    };

    if (Object.values(suspiciousPatterns).some(Boolean)) {
      logger.alert('Suspicious activity pattern detected', { userId, quizDate, patterns: suspiciousPatterns });
      if (suspiciousPatterns.multipleDeviceMismatches && recentEvents.filter(e => e.eventType === 'device_mismatch').length >= 5) {
        await this.executeAutoAction(userId, 'TEMP_BLOCK', 'Multiple device mismatch attempts', { quizDate, patterns: suspiciousPatterns });
      } else {
        await this.executeAutoAction(userId, 'MARK_SUSPICIOUS', 'Suspicious pattern', { quizDate, patterns: suspiciousPatterns });
      }
      return { isSuspicious: true, patterns: suspiciousPatterns };
    }

    return { isSuspicious: false };
  }

  // Comprehensive Health Check
  async getSystemHealth() {
    const health = {
      timestamp: new Date(),
      components: {}
    };

    // Redis health
    try {
      await redisClient.ping();
      health.components.redis = { status: 'healthy' };
    } catch (error) {
      health.components.redis = { status: 'unhealthy', error: error.message };
    }

    // MongoDB health
    try {
      await mongoose.connection.db.admin().ping();
      health.components.mongodb = { status: 'healthy' };
    } catch (error) {
      health.components.mongodb = { status: 'unhealthy', error: error.message };
    }

    // Quiz system health
    try {
      const recentQuizzes = await Quiz.find().sort({ createdAt: -1 }).limit(1);
      health.components.quizSystem = { status: 'healthy', lastQuiz: recentQuizzes[0]?.createdAt };
    } catch (error) {
      health.components.quizSystem = { status: 'unhealthy', error: error.message };
    }

    // Critical metrics
    health.metrics = {
      redisFencingFailures: await this.getRedisFencingFailures(),
      activeWebSocketConnections: await this.getWebSocketStats(),
      recentFinalizeLatencies: await this.getRecentFinalizeLatencies()
    };

    return health;
  }

  async getRecentFinalizeLatencies(limit = 10) {
    const keys = await redisClient.keys('finalize:latency:*');
    const latencies = [];

    for (const key of keys.slice(0, limit)) {
      const data = await redisClient.get(key);
      if (data) {
        latencies.push(JSON.parse(data));
      }
    }

    return latencies;
  }

  // G2: Alert on abnormal behavior
  async checkAbnormalBehavior(quizDate) {
    const alerts = [];

    // Check for too many wrong answers too fast
    const rapidWrongAnswers = await this.detectRapidWrongAnswers(quizDate);
    if (rapidWrongAnswers.length > 0) {
      alerts.push({
        type: 'RAPID_WRONG_ANSWERS',
        severity: 'HIGH',
        details: rapidWrongAnswers,
        message: `Detected ${rapidWrongAnswers.length} users answering incorrectly too quickly`
      });
    }

    // Check for too many attempts per IP
    const suspiciousIPs = await this.detectSuspiciousIPs(quizDate);
    if (suspiciousIPs.length > 0) {
      alerts.push({
        type: 'SUSPICIOUS_IP_ACTIVITY',
        severity: 'MEDIUM',
        details: suspiciousIPs,
        message: `Detected ${suspiciousIPs.length} IPs with suspicious activity`
      });
    }

    // Check for multiple device rejections
    const deviceRejections = await this.getDeviceRejections(quizDate);
    if (deviceRejections.length > 0) {
      alerts.push({
        type: 'MULTIPLE_DEVICE_REJECTIONS',
        severity: 'HIGH',
        details: deviceRejections,
        message: `Detected ${deviceRejections.length} device mismatch rejections`
      });
    }

    // Log alerts
    if (alerts.length > 0) {
      logger.alert('Abnormal behavior detected', { quizDate, alerts });
    }

    return alerts;
  }

  async detectRapidWrongAnswers(quizDate, thresholdMs = 2000) {
    const attempts = await QuizAttempt.find({ quizDate, answersSaved: true })
      .populate('user', 'name phone')
      .select('user answers answerTimestamps');
    
    const suspicious = [];
    for (const attempt of attempts) {
      if (!attempt.answerTimestamps || attempt.answerTimestamps.length < 2) continue;
      
      for (let i = 1; i < attempt.answerTimestamps.length; i++) {
        const timeDiff = attempt.answerTimestamps[i].getTime() - attempt.answerTimestamps[i-1].getTime();
        if (timeDiff < thresholdMs && attempt.answers[i] !== undefined) {
          suspicious.push({
            userId: attempt.user._id,
            userName: attempt.user.name,
            questionIndex: i,
            timeDiff
          });
        }
      }
    }
    return suspicious;
  }

  async detectSuspiciousIPs(quizDate, maxAttemptsPerIP = 5) {
    const attempts = await QuizAttempt.find({ quizDate })
      .select('ipAddress user');
    
    const ipCounts = new Map();
    for (const attempt of attempts) {
      if (!attempt.ipAddress) continue;
      const count = ipCounts.get(attempt.ipAddress) || 0;
      ipCounts.set(attempt.ipAddress, count + 1);
    }
    
    const suspicious = [];
    for (const [ip, count] of ipCounts.entries()) {
      if (count > maxAttemptsPerIP) {
        suspicious.push({ ip, attemptCount: count });
      }
    }
    return suspicious;
  }

  async getDeviceRejections(quizDate) {
    const key = `anticheat:events:${quizDate}`;
    const events = await redisClient.lrange(key, 0, -1);
    const rejections = events
      .map(e => JSON.parse(e))
      .filter(e => e.eventType === 'device_mismatch' || e.eventType === 'device_fingerprint_mismatch');
    return rejections;
  }
}

export default new ObservabilityService();