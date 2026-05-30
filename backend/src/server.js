import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';
import logger from './config/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { connectDB, checkDBHealth, disconnectDB } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import stellarRoutes from './routes/stellar/index.js';
import multiSigRoutes from './routes/multiSig.js';
import authRoutes from './routes/auth.js';
import { initWebSocket } from './services/websocket.js';
import eventsRoutes from './routes/events.js';
import securityRoutes from './routes/security.js';
import loadTestingRoutes from './routes/loadTesting.js';
import chaosRoutes from './routes/chaos.js';
import healthRoutes from './routes/health.js';
import mobileRoutes from './routes/mobile.js';
import webhookRoutes from './routes/webhooks.js';
import metricsRoutes from './routes/metrics.js';
import transactionRoutes from './routes/transactions.js';
import notificationRoutes from './routes/notifications.js';
import complianceRoutes from './routes/compliance.js';
import pathPaymentRoutes from './routes/pathPayment.js';
import analyticsRoutes from './routes/analytics.js';
import backupRoutes from './routes/backup.js';
import cacheRoutes from './routes/cache.js';
import recoveryRoutes from './routes/recovery.js';
import { eventMonitor } from './eventSourcing/index.js';
import streamingRoutes from './routes/streaming.js';
import retryRoutes from './routes/retry.js';
import accountsRoutes from './routes/accounts.js';
import { auditLogger } from './security/index.js';
import { getConfig } from './config/env.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { performanceMiddleware } from './monitoring/middleware.js';
import { cdnMiddleware } from './cdn/index.js';
import {
  requestIdMiddleware,
  errorLogger,
  errorHandler,
  notFoundHandler,
} from './middleware/errorHandler.js';
import { securityMiddleware } from './middleware/securityHeaders.js';
import { sanitizeInputs } from './middleware/sanitize.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { csrfTokenMiddleware, validateCSRFMiddleware, csrfTokenEndpoint } from './middleware/csrf.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = getConfig().server.port;

// Security middleware
app.use(securityMiddleware());

app.use(
  cors({
    origin: (origin, cb) => {
      const allowedOrigins = getConfig().cors.allowedOrigins;
      // Allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true
  })
);

// CORS error handler - returns 403 for disallowed origins
app.use((err, req, res, next) => {
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'CORS: origin not allowed' });
  }
  next(err);
});

// Global body size limit (1kb for most endpoints)
app.use(express.json({ limit: '1kb' }));
app.use(express.urlencoded({ extended: false, limit: '1kb' }));

// Larger body size limit for specific routes that need it (file uploads, KYC, etc.)
const largeBodyLimit = express.json({ limit: '100kb' });
const largeUrlEncodedLimit = express.urlencoded({ extended: false, limit: '100kb' });

// Apply larger limits to routes that need them
app.use('/api/v1/backup', largeBodyLimit, largeUrlEncodedLimit);
app.use('/api/v1/compliance', largeBodyLimit, largeUrlEncodedLimit);
app.use('/api/v1/recovery', largeBodyLimit, largeUrlEncodedLimit);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(requestLogger);

// CSRF protection
app.use(csrfTokenMiddleware);
app.use(validateCSRFMiddleware);

// Rate limiting
app.use(createRateLimiter());

// Performance monitoring
app.use(performanceMiddleware);

// CDN cache-control and security headers
app.use(cdnMiddleware);
// Input sanitization (runs before all route handlers)
app.use(sanitizeInputs);

// Initialize event sourcing
await runMigrations();
await connectDB();
await eventMonitor.initialize();
await auditLogger.initialize();

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API v1 routes
app.use('/api/v1/stellar', stellarRoutes);
app.use('/api/v1/multisig', multiSigRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/events', eventsRoutes);
app.use('/api/v1/security', securityRoutes);
app.use('/api/v1/load-testing', loadTestingRoutes);
app.use('/api/v1/chaos', chaosRoutes);
app.use('/api/v1/mobile', mobileRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/metrics', metricsRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/compliance', complianceRoutes);
app.use('/api/v1/path-payment', pathPaymentRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/backup', backupRoutes);
app.use('/api/v1/cache', cacheRoutes);
app.use('/api/v1/streaming', streamingRoutes);
app.use('/api/v1/recovery', recoveryRoutes);
app.use('/api/v1/retry', retryRoutes);
app.use('/api/v1/accounts', accountsRoutes);

// Health routes (not versioned - used by load balancers)
app.use('/', healthRoutes);

// Deprecation middleware for unversioned /api/* paths
app.use('/api/*', (req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString());
  res.setHeader('Link', `<${req.originalUrl.replace('/api/', '/api/v1/')}>; rel="successor-version"`);
  res.status(301).redirect(req.originalUrl.replace('/api/', '/api/v1/'));
});

// 404 handler for undefined routes
app.use(notFoundHandler);

// Error handling middleware (must be after all routes)
app.use(errorLogger);
app.use(errorHandler);

const httpServer = createServer(app);
initWebSocket(httpServer);

// Track active intervals for cleanup
const activeIntervals = [];

httpServer.listen(PORT, () => {
  const { stellar, meta } = getConfig();
  logger.info('server.started', { port: PORT, network: stellar.network });
  if (meta.loadedEnvFiles.length > 0) {
    logger.info('server.envFiles', {
      files: meta.loadedEnvFiles.map((p) => p.split('/').pop()).join(', '),
    });
  }
  logger.info('server.started', { port: PORT, network: process.env.STELLAR_NETWORK });

  // Start background workers
  // Start background streaming payment worker
  const STREAM_INTERVAL = 60 * 1000; // Check every minute
  const streamInterval = setInterval(async () => {
    try {
      await processActiveStreams();
    } catch (err) {
      logger.error('streaming.worker.failed', { error: err.message });
    }
  }, STREAM_INTERVAL);
  activeIntervals.push(streamInterval);

  // Expire stale multi-sig transactions every minute
  const multiSigInterval = setInterval(async () => {
    try {
      const count = await expireStaleTransactions();
      if (count > 0) logger.info('multisig.expired', { count });
    } catch (err) {
      logger.error('multisig.expiry.failed', { error: err.message });
    }
  }, 60 * 1000);
  activeIntervals.push(multiSigInterval);

  startScheduler();
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 10_000;

async function shutdown(signal) {
  logger.info('server.shutdown.start', { signal });

  // 1. Stop accepting new connections
  httpServer.close(() => {
    logger.info('server.shutdown.httpClosed');
  });

  // 2. Clear all active intervals
  for (const interval of activeIntervals) {
    clearInterval(interval);
  }
  logger.info('server.shutdown.intervalsCleared', { count: activeIntervals.length });

  // 3. Wait for in-flight requests to drain, with a hard timeout
  const forceExit = setTimeout(() => {
    logger.error('server.shutdown.timeout', { ms: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // 3. Stop background workers
    stopScheduler();
    // 4. Close DB connection
    await disconnectDB();
    logger.info('server.shutdown.complete');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('server.shutdown.error', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
