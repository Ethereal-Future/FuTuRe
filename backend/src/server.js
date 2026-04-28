import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';
import logger from './config/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { connectDB, checkDBHealth } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import stellarRoutes from './routes/stellar.js';
import multiSigRoutes from './routes/multiSig.js';
import { expireStaleTransactions } from './services/multiSig.js';
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
import { startScheduler } from './backup/manager.js';
import cacheRoutes from './routes/cache.js';
import recoveryRoutes from './routes/recovery.js';
import { eventMonitor } from './eventSourcing/index.js';
import streamingRoutes from './routes/streaming.js';
import { processActiveStreams } from './services/streaming.js';
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
  notFoundHandler
} from './middleware/errorHandler.js';
import { securityMiddleware } from './middleware/securityHeaders.js';
import { sanitizeInputs } from './middleware/sanitize.js';

dotenv.config();

const app = express();
const PORT = getConfig().server.port;

// Security middleware
app.use(securityMiddleware());

app.use(cors({
  origin: (origin, cb) => {
    const allowedOrigins = getConfig().cors.allowedOrigins;
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// CORS error handler - returns 403 for disallowed origins
app.use((err, req, res, next) => {
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'CORS: origin not allowed' });
  }
  next(err);
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(requestIdMiddleware);
app.use(requestLogger);

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
app.use('/api/stellar', stellarRoutes);
app.use('/api/multisig', multiSigRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/load-testing', loadTestingRoutes);
app.use('/api/chaos', chaosRoutes);
app.use('/', healthRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/path-payment', pathPaymentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/streaming', streamingRoutes);
app.use('/api/recovery', recoveryRoutes);
app.use('/api/retry', retryRoutes);
app.use('/api/accounts', accountsRoutes);

// 404 handler for undefined routes
app.use(notFoundHandler);

// Error handling middleware (must be after all routes)
app.use(errorLogger);
app.use(errorHandler);

app.get('/health', async (req, res) => {
  const db = await checkDBHealth();
  
  // Check Stellar network connectivity
  let stellar = { online: false };
  try {
    const { getNetworkStatus } = await import('./services/stellar.js');
    stellar = await getNetworkStatus();
  } catch (err) {
    logger.warn('health.stellar.check.failed', { error: err.message });
  }
  
  const allHealthy = db.status === 'ok' && stellar.online;
  const status = allHealthy ? 'ok' : 'degraded';
  
  res.status(allHealthy ? 200 : 503).json({
    status,
    network: getConfig().stellar.network,
    db,
    stellar: {
      online: stellar.online,
      network: stellar.network || null,
      horizonVersion: stellar.horizonVersion || null,
    },
  });
});

const httpServer = createServer(app);
initWebSocket(httpServer);

httpServer.listen(PORT, () => {
  const { stellar, meta } = getConfig();
  logger.info('server.started', { port: PORT, network: stellar.network });
  if (meta.loadedEnvFiles.length > 0) {
    logger.info('server.envFiles', { files: meta.loadedEnvFiles.map(p => p.split('/').pop()).join(', ') });
  }
  logger.info('server.started', { port: PORT, network: process.env.STELLAR_NETWORK });

  // Start background streaming payment worker
  const STREAM_INTERVAL = 60 * 1000; // Check every minute
  setInterval(async () => {
    try {
      await processActiveStreams();
    } catch (err) {
      logger.error('streaming.worker.failed', { error: err.message });
    }
  }, STREAM_INTERVAL);
  // Expire stale multi-sig transactions every minute
  setInterval(async () => {
    try {
      const count = await expireStaleTransactions();
      if (count > 0) logger.info('multisig.expired', { count });
    } catch (err) {
      logger.error('multisig.expiry.failed', { error: err.message });
    }
  }, 60 * 1000);
  startScheduler();
});
