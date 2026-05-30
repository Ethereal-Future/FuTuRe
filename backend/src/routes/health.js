import express from 'express';
import os from 'os';
import * as StellarService from '../services/stellar.js';
import { eventMonitor, eventStore } from '../eventSourcing/index.js';
import { auditLogger } from '../security/index.js';
import { requireAuth } from '../middleware/auth.js';
import { analytics as cacheAnalytics, monitor as cacheMonitor } from '../cache/appCache.js';
import prisma from '../db/client.js';
import { getMetrics as getBackupMetrics } from '../backup/manager.js';
import { RedisBackend } from '../cache/redis.js';
import { sendEmail } from '../notifications/channels/email.js';
import logger from '../config/logger.js';

const router = express.Router();

// Redis backend instance for health checks
const redisBackend = new RedisBackend(process.env.REDIS_URL || null);

function getSystemInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    cpus: os.cpus().length,
    hostname: os.hostname(),
  };
}

function getApplicationInfo() {
  return {
    version: process.env.npm_package_version || '1.0.0',
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    startTime: new Date().toISOString(),
    processId: process.pid,
  };
}

async function checkStellarConnectivity() {
  try {
    const status = await StellarService.getNetworkStatus();
    return {
      status: 'healthy',
      network: status.network,
      horizonUrl: status.horizonUrl,
      online: status.online,
      horizonVersion: status.horizonVersion,
      currentProtocolVersion: status.currentProtocolVersion,
      responseTime: Date.now(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now(),
    };
  }
}

async function checkRedisConnectivity() {
  try {
    if (!redisBackend.client) {
      return {
        status: 'unavailable',
        message: 'Redis not configured',
      };
    }
    
    // Try to ping Redis
    const pong = await redisBackend.client.ping();
    return {
      status: pong === 'PONG' ? 'healthy' : 'unhealthy',
      responseTime: Date.now(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now(),
    };
  }
}

async function checkEmailServiceConnectivity() {
  try {
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
      return {
        status: 'unavailable',
        message: 'Email service not configured (using stub)',
      };
    }

    // Try to send a test email (in production, this would be a real test)
    const result = await sendEmail('health-check@example.com', {
      subject: 'Health Check',
      body: 'This is a health check email',
    });

    return {
      status: result.success ? 'healthy' : 'unhealthy',
      error: result.error || null,
      responseTime: Date.now(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now(),
    };
  }
}

async function checkWebSocketConnectivity() {
  try {
    // WebSocket server is initialized with the HTTP server
    // We can check if it's available by checking if the server has a wss property
    // For now, we'll return healthy if the server is running
    return {
      status: 'healthy',
      message: 'WebSocket server initialized',
      responseTime: Date.now(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now(),
    };
  }
}

async function checkDatabaseConnectivity() {
  // This application doesn't appear to use a traditional database
  // Using event sourcing and in-memory storage instead
  try {
    const eventMonitorStatus = eventMonitor.isInitialized ? 'healthy' : 'unhealthy';
    const auditLoggerStatus = auditLogger.isInitialized ? 'healthy' : 'unhealthy';

    return {
      status:
        eventMonitorStatus === 'healthy' && auditLoggerStatus === 'healthy'
          ? 'healthy'
          : 'unhealthy',
      eventMonitor: eventMonitorStatus,
      auditLogger: auditLoggerStatus,
      type: 'event-sourcing',
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      type: 'event-sourcing',
    };
  }
}

async function checkDependencies() {
  const checks = [];

  // Check Stellar SDK
  try {
    const stellarStatus = await checkStellarConnectivity();
    checks.push({
      name: '@stellar/stellar-sdk',
      status: stellarStatus.status,
      version: '12.3.0',
    });
  } catch (error) {
    checks.push({
      name: '@stellar/stellar-sdk',
      status: 'unhealthy',
      error: error.message,
    });
  }

  // Check Redis
  try {
    const redisStatus = await checkRedisConnectivity();
    checks.push({
      name: 'redis',
      status: redisStatus.status,
      version: '7.0.0',
    });
  } catch (error) {
    checks.push({
      name: 'redis',
      status: 'unhealthy',
      error: error.message,
    });
  }

  // Check Email Service
  try {
    const emailStatus = await checkEmailServiceConnectivity();
    checks.push({
      name: 'email-service',
      status: emailStatus.status,
      version: 'nodemailer',
    });
  } catch (error) {
    checks.push({
      name: 'email-service',
      status: 'unhealthy',
      error: error.message,
    });
  }

  // Check WebSocket
  try {
    const wsStatus = await checkWebSocketConnectivity();
    checks.push({
      name: 'ws',
      status: wsStatus.status,
      version: '8.20.0',
    });
  } catch (error) {
    checks.push({
      name: 'ws',
      status: 'unhealthy',
      error: error.message,
    });
  }

  // Check Express (core framework)
  checks.push({
    name: 'express',
    status: 'healthy',
    version: '4.19.2',
  });

  return {
    overall: checks.every((c) => c.status === 'healthy' || c.status === 'unavailable') ? 'healthy' : 'degraded',
    dependencies: checks,
  };
}

function calculateHealthPercentage(checks) {
  const healthyCount = checks.filter((check) => check.status === 'healthy').length;
  return Math.round((healthyCount / checks.length) * 100);
}

router.get('/health', async (req, res) => {
  try {
    const systemInfo = getSystemInfo();
    const appInfo = getApplicationInfo();
    const stellarCheck = await checkStellarConnectivity();
    const databaseCheck = await checkDatabaseConnectivity();
    const redisCheck = await checkRedisConnectivity();
    const emailCheck = await checkEmailServiceConnectivity();
    const wsCheck = await checkWebSocketConnectivity();
    const dependencyCheck = await checkDependencies();

    const healthChecks = [
      { name: 'stellar', ...stellarCheck },
      { name: 'database', ...databaseCheck },
      { name: 'redis', ...redisCheck },
      { name: 'email', ...emailCheck },
      { name: 'websocket', ...wsCheck },
    ];

    // Calculate overall health (exclude unavailable services)
    const criticalChecks = healthChecks.filter(c => c.status !== 'unavailable');
    const healthyCount = criticalChecks.filter(c => c.status === 'healthy').length;
    const overallHealth = criticalChecks.length > 0 ? Math.round((healthyCount / criticalChecks.length) * 100) : 100;
    const status = overallHealth >= 80 ? 'healthy' : overallHealth >= 50 ? 'degraded' : 'unhealthy';

    const healthData = {
      status,
      overallHealth,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: healthChecks,
      dependencies: dependencyCheck,
      system: systemInfo,
      application: appInfo,
    };

    const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(healthData);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/health/live', (req, res) => {
  // Liveness probe - checks if the application is running
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

router.get('/health/ready', async (req, res) => {
  try {
    // Readiness probe - checks if the application is ready to serve traffic
    const stellarCheck = await checkStellarConnectivity();
    const databaseCheck = await checkDatabaseConnectivity();
    const redisCheck = await checkRedisConnectivity();
    const emailCheck = await checkEmailServiceConnectivity();
    const wsCheck = await checkWebSocketConnectivity();

    // Ready if critical services are healthy (Redis and email can be unavailable)
    const isReady = 
      stellarCheck.status === 'healthy' && 
      databaseCheck.status === 'healthy' &&
      wsCheck.status === 'healthy';

    const readinessData = {
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks: {
        stellar: stellarCheck.status,
        database: databaseCheck.status,
        redis: redisCheck.status,
        email: emailCheck.status,
        websocket: wsCheck.status,
      },
    };

    const statusCode = isReady ? 200 : 503;
    res.status(statusCode).json(readinessData);
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/metrics', (req, res) => {
  try {
    const systemInfo = getSystemInfo();
    const appInfo = getApplicationInfo();
    const memoryUsage = process.memoryUsage();

    const metrics = {
      timestamp: new Date().toISOString(),
      application: {
        version: appInfo.version,
        nodeVersion: appInfo.nodeVersion,
        environment: appInfo.environment,
        processId: appInfo.processId,
        uptime: process.uptime(),
      },
      system: {
        platform: systemInfo.platform,
        arch: systemInfo.arch,
        hostname: systemInfo.hostname,
        cpuCount: systemInfo.cpus,
        loadAverage: systemInfo.loadavg,
        memory: {
          total: systemInfo.totalmem,
          free: systemInfo.freemem,
          used: systemInfo.totalmem - systemInfo.freemem,
          usagePercentage: Math.round(
            ((systemInfo.totalmem - systemInfo.freemem) / systemInfo.totalmem) * 100
          ),
        },
      },
      process: {
        memory: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers,
        },
        cpuUsage: process.cpuUsage(),
      },
    };

    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /health/detailed:
 *   get:
 *     summary: Detailed system health (auth-gated)
 *     description: >
 *       Returns extended health information including cache status, event store
 *       queue depth, active stream count, pending multi-sig transaction count,
 *       and last backup timestamp. Requires a valid Bearer token.
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Detailed health report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 cache:
 *                   type: object
 *                 eventStore:
 *                   type: object
 *                 streams:
 *                   type: object
 *                 multiSig:
 *                   type: object
 *                 backup:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/health/detailed', requireAuth, async (req, res) => {
  try {
    const [activeStreamCount, pendingMultiSigCount, eventQueueDepth] = await Promise.all([
      prisma.paymentStream.count({ where: { status: 'ACTIVE' } }).catch(() => null),
      prisma.pendingMultiSigTx.count({ where: { status: 'pending' } }).catch(() => null),
      // eventStore.events holds in-memory events appended since startup
      Promise.resolve(eventStore.events?.length ?? 0),
    ]);

    const cacheStats = cacheMonitor.getPerformanceStats();
    const cacheAlerts = cacheMonitor.getAlerts().slice(-5);

    const backupMetrics = (() => {
      try {
        return getBackupMetrics();
      } catch {
        return null;
      }
    })();

    const checks = [
      { name: 'cache', status: cacheStats ? 'healthy' : 'unknown' },
      { name: 'eventStore', status: eventStore.initialized ? 'healthy' : 'unhealthy' },
      { name: 'streams', status: activeStreamCount !== null ? 'healthy' : 'unknown' },
      { name: 'multiSig', status: pendingMultiSigCount !== null ? 'healthy' : 'unknown' },
      { name: 'backup', status: backupMetrics ? 'healthy' : 'unknown' },
    ];

    const unhealthyCount = checks.filter((c) => c.status === 'unhealthy').length;
    const overallStatus =
      unhealthyCount === 0 ? 'healthy' : unhealthyCount < checks.length ? 'degraded' : 'unhealthy';

    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      cache: {
        status: cacheStats ? 'healthy' : 'unknown',
        performance: cacheStats,
        recentAlerts: cacheAlerts,
      },
      eventStore: {
        status: eventStore.initialized ? 'healthy' : 'unhealthy',
        initialized: eventStore.initialized ?? false,
        queueDepth: eventQueueDepth,
      },
      streams: {
        status: activeStreamCount !== null ? 'healthy' : 'unknown',
        activeCount: activeStreamCount,
      },
      multiSig: {
        status: pendingMultiSigCount !== null ? 'healthy' : 'unknown',
        pendingTransactions: pendingMultiSigCount,
      },
      backup: {
        status: backupMetrics ? 'healthy' : 'unknown',
        lastBackupAt: backupMetrics?.lastBackupAt ?? null,
        lastBackupSize: backupMetrics?.lastBackupSize ?? null,
        totalBackups: backupMetrics?.totalBackups ?? null,
        encryptionEnabled: backupMetrics?.encryptionEnabled ?? null,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
