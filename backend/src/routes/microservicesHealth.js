/**
 * Microservices health route
 * Exposes GET /microservices/health for load-balancer and orchestration probes.
 * Delegates to ServiceRegistry.health() which aggregates per-service instance status.
 */
import express from 'express';
import { ServiceRegistry } from '../microservices/discovery.js';

const router = express.Router();

// Shared singleton registry — callers register services/instances against this.
export const serviceRegistry = new ServiceRegistry();

/**
 * GET /microservices/health
 * Returns the aggregate health of all registered microservices.
 * Response shape:
 *   { status, uptime, timestamp, services: [{ name, status, totalInstances, healthyInstances }] }
 *
 * Intentionally public: load balancers and orchestrators probe this route
 * without credentials, and it exposes no sensitive data (#1102).
 */
router.get('/microservices/health', (req, res) => {
  const health = serviceRegistry.health();
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
