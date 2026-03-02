// middlewares/monitoring.middleware.js
import redisClient from '../config/redis.js';
import ObservabilityService from '../modules/monitoring/observability.service.js';

export const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', async () => {
    const duration = Date.now() - start;
    const key = `metrics:requests:${req.method}:${req.originalUrl.split('?')[0]}:${res.statusCode}`;

    try {
      await redisClient.incr(key);
      // Expire after 24 hours
      await redisClient.expire(key, 86400);
    } catch (error) {
      console.warn('Failed to log request metrics:', error.message);
    }

    // Log slow requests (>1 second)
    if (duration > 1000) {
      console.warn(`Slow request: ${req.method} ${req.originalUrl} - ${duration}ms`);
    }
  });

  next();
};

export const healthCheck = async (req, res) => {
  try {
    // Check MongoDB
    const mongoose = (await import('mongoose')).default;
    const mongoStatus = mongoose.connection.readyState === 1 ? 'ok' : 'error';

    // Check Redis
    let redisStatus = 'error';
    try {
      await redisClient.ping();
      redisStatus = 'ok';
    } catch (error) {
      redisStatus = 'error';
    }

    // Get comprehensive system health
    const systemHealth = await ObservabilityService.getSystemHealth();

    const health = {
      status: mongoStatus === 'ok' && redisStatus === 'ok' && systemHealth.components.quizSystem.status === 'healthy' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        mongodb: mongoStatus,
        redis: redisStatus,
        quizSystem: systemHealth.components.quizSystem.status
      },
      uptime: process.uptime(),
      observability: {
        redisFencingFailures: systemHealth.metrics.redisFencingFailures,
        webSocketConnections: systemHealth.metrics.activeWebSocketConnections,
        recentFinalizeLatencies: systemHealth.metrics.recentFinalizeLatencies
      }
    };

    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};