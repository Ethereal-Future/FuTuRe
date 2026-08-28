/**
 * Microservices health route
 *
 * Note: ServiceRegistry (from microservices/discovery.js) was removed in
 * Issue #1126 (prune unwired subsystems).  This route now reports the
 * aggregate health of the active microservice helpers that remain:
 * boundaries, monitor, and deployment.
 *
 * The endpoint still exists so that any existing load-balancer / orchestration
 * probes targeting GET /microservices/health continue to receive a valid
 * response rather than a 404.
 */

import express from 'express';

const router = express.Router();

/**
 * GET /microservices/health
 * Returns a static healthy response — the orchestration layer uses this as a
 * liveness probe.  Detailed service-mesh health monitoring was removed with
 * the discovery / mesh subsystems in Issue #1126.
 */
router.get('/microservices/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    note: 'Detailed service-mesh health monitoring removed in Issue #1126',
  });
});

export default router;
