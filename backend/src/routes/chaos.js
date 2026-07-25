import express from 'express';
import {
  failureInjector,
  networkPartitionSimulator,
  serviceFailureSimulator,
  databaseFailureSimulator,
  recoveryTimeAnalyzer,
  blastRadiusLimiter,
  chaosTestAutomation,
  chaosReporter
} from '../chaos/index.js';

const router = express.Router();

/**
 * @swagger
 * /api/chaos/inject/latency:
 *   post:
 *     summary: Inject latency into a target
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetId, delayMs]
 *             properties:
 *               targetId: { type: string }
 *               delayMs: { type: integer }
 *               probability: { type: number, minimum: 0, maximum: 1 }
 *     responses:
 *       200:
 *         description: Latency injection created
 *       400:
 *         description: Invalid parameters
 */
router.post('/inject/latency', (req, res) => {
  try {
    const { targetId, delayMs, probability } = req.body;
    const injection = failureInjector.injectLatency(targetId, delayMs, probability);
    res.json(injection);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/inject/error:
 *   post:
 *     summary: Inject errors into a target
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetId, errorRate]
 *             properties:
 *               targetId: { type: string }
 *               errorRate: { type: number }
 *               errorCode: { type: integer }
 *               probability: { type: number }
 *     responses:
 *       200:
 *         description: Error injection created
 *       400:
 *         description: Invalid parameters
 */
router.post('/inject/error', (req, res) => {
  try {
    const { targetId, errorRate, errorCode, probability } = req.body;
    const injection = failureInjector.injectError(targetId, errorRate, errorCode, probability);
    res.json(injection);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/inject/packet-loss:
 *   post:
 *     summary: Inject packet loss into a target
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetId, lossRate]
 *             properties:
 *               targetId: { type: string }
 *               lossRate: { type: number }
 *               probability: { type: number }
 *     responses:
 *       200:
 *         description: Packet loss injection created
 *       400:
 *         description: Invalid parameters
 */
router.post('/inject/packet-loss', (req, res) => {
  try {
    const { targetId, lossRate, probability } = req.body;
    const injection = failureInjector.injectPacketLoss(targetId, lossRate, probability);
    res.json(injection);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/failures/active:
 *   get:
 *     summary: Get all active failure injections
 *     tags: [Chaos]
 *     responses:
 *       200:
 *         description: Active failures
 *       500:
 *         description: Server error
 */
router.get('/failures/active', (req, res) => {
  try {
    const failures = failureInjector.getActiveFailures();
    res.json({ failures });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/failures/remove/{injectionId}:
 *   post:
 *     summary: Remove a failure injection
 *     tags: [Chaos]
 *     parameters:
 *       - in: path
 *         name: injectionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Injection removed
 *       500:
 *         description: Server error
 */
router.post('/failures/remove/:injectionId', (req, res) => {
  try {
    failureInjector.removeInjection(req.params.injectionId);
    res.json({ message: 'Injection removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/network/partition:
 *   post:
 *     summary: Create a network partition
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [partitionId, affectedServices]
 *             properties:
 *               partitionId: { type: string }
 *               affectedServices: { type: array, items: { type: string } }
 *               healTime: { type: integer, description: Auto-heal after ms }
 *     responses:
 *       200:
 *         description: Partition created
 *       400:
 *         description: Invalid parameters
 */
router.post('/network/partition', (req, res) => {
  try {
    const { partitionId, affectedServices, healTime } = req.body;
    const partition = networkPartitionSimulator.createPartition(partitionId, affectedServices, healTime);
    res.json(partition);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/network/partitions:
 *   get:
 *     summary: Get active network partitions
 *     tags: [Chaos]
 *     responses:
 *       200:
 *         description: Active partitions
 *       500:
 *         description: Server error
 */
router.get('/network/partitions', (req, res) => {
  try {
    const partitions = networkPartitionSimulator.getActivePartitions();
    res.json({ partitions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/network/heal/{partitionId}:
 *   post:
 *     summary: Heal a network partition
 *     tags: [Chaos]
 *     parameters:
 *       - in: path
 *         name: partitionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Partition healed
 *       500:
 *         description: Server error
 */
router.post('/network/heal/:partitionId', (req, res) => {
  try {
    networkPartitionSimulator.healPartition(req.params.partitionId);
    res.json({ message: 'Partition healed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/service/fail:
 *   post:
 *     summary: Simulate a service failure
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [serviceId, failureType]
 *             properties:
 *               serviceId: { type: string }
 *               failureType: { type: string }
 *               recoveryTime: { type: integer }
 *     responses:
 *       200:
 *         description: Service failure simulated
 *       400:
 *         description: Invalid parameters
 */
router.post('/service/fail', (req, res) => {
  try {
    const { serviceId, failureType, recoveryTime } = req.body;
    const failure = serviceFailureSimulator.failService(serviceId, failureType, recoveryTime);
    res.json(failure);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/service/failures:
 *   get:
 *     summary: Get all service failures
 *     tags: [Chaos]
 *     responses:
 *       200:
 *         description: Service failures
 *       500:
 *         description: Server error
 */
router.get('/service/failures', (req, res) => {
  try {
    const failures = serviceFailureSimulator.getAllFailures();
    res.json({ failures });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/service/recover/{serviceId}:
 *   post:
 *     summary: Recover a failed service
 *     tags: [Chaos]
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Service recovered
 *       500:
 *         description: Server error
 */
router.post('/service/recover/:serviceId', (req, res) => {
  try {
    serviceFailureSimulator.recoverService(req.params.serviceId);
    res.json({ message: 'Service recovered' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/database/fail:
 *   post:
 *     summary: Simulate a database failure
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [databaseId, failureType]
 *             properties:
 *               databaseId: { type: string }
 *               failureType: { type: string }
 *               recoveryTime: { type: integer }
 *     responses:
 *       200:
 *         description: Database failure simulated
 *       400:
 *         description: Invalid parameters
 */
router.post('/database/fail', (req, res) => {
  try {
    const { databaseId, failureType, recoveryTime } = req.body;
    const failure = databaseFailureSimulator.failDatabase(databaseId, failureType, recoveryTime);
    res.json(failure);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/database/query-failure:
 *   post:
 *     summary: Inject query-level database failures
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [queryPattern, failureRate]
 *             properties:
 *               queryPattern: { type: string }
 *               failureRate: { type: number }
 *               errorMessage: { type: string }
 *     responses:
 *       200:
 *         description: Query failure injected
 *       400:
 *         description: Invalid parameters
 */
router.post('/database/query-failure', (req, res) => {
  try {
    const { queryPattern, failureRate, errorMessage } = req.body;
    const failure = databaseFailureSimulator.injectQueryFailure(queryPattern, failureRate, errorMessage);
    res.json(failure);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/recovery/record:
 *   post:
 *     summary: Record a recovery time metric
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [serviceId, failureType, downtime]
 *             properties:
 *               serviceId: { type: string }
 *               failureType: { type: string }
 *               downtime: { type: integer, description: Downtime in ms }
 *               recoveryActions: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Recovery metric recorded
 *       400:
 *         description: Invalid parameters
 */
router.post('/recovery/record', (req, res) => {
  try {
    const { serviceId, failureType, downtime, recoveryActions } = req.body;
    const metric = recoveryTimeAnalyzer.recordRecovery(serviceId, failureType, downtime, recoveryActions);
    res.json(metric);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/recovery/report/{serviceId}:
 *   get:
 *     summary: Get recovery time report for a service
 *     tags: [Chaos]
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recovery report
 *       500:
 *         description: Server error
 */
router.get('/recovery/report/:serviceId', (req, res) => {
  try {
    const report = recoveryTimeAnalyzer.getRecoveryReport(req.params.serviceId);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/blast-radius/limit:
 *   post:
 *     summary: Set blast radius limits for chaos experiments
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [limitId]
 *             properties:
 *               limitId: { type: string }
 *               maxAffectedServices: { type: integer }
 *               maxErrorRate: { type: number }
 *               maxDowntime: { type: integer }
 *     responses:
 *       200:
 *         description: Limit set
 *       400:
 *         description: Invalid parameters
 */
router.post('/blast-radius/limit', (req, res) => {
  try {
    const { limitId, maxAffectedServices, maxErrorRate, maxDowntime } = req.body;
    const limit = blastRadiusLimiter.setLimit(limitId, maxAffectedServices, maxErrorRate, maxDowntime);
    res.json(limit);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/blast-radius/check:
 *   post:
 *     summary: Check if a failure injection is within blast radius limits
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [failureId, affectedServices, estimatedErrorRate]
 *             properties:
 *               failureId: { type: string }
 *               affectedServices: { type: array, items: { type: string } }
 *               estimatedErrorRate: { type: number }
 *     responses:
 *       200:
 *         description: Check result
 *       400:
 *         description: Invalid parameters
 */
router.post('/blast-radius/check', (req, res) => {
  try {
    const { failureId, affectedServices, estimatedErrorRate } = req.body;
    const result = blastRadiusLimiter.canInjectFailure(failureId, affectedServices, estimatedErrorRate);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/experiments/create:
 *   post:
 *     summary: Create a chaos experiment
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               failureInjections: { type: array, items: { type: object } }
 *               duration: { type: integer, description: Duration in ms }
 *     responses:
 *       200:
 *         description: Experiment created
 *       500:
 *         description: Server error
 */
router.post('/experiments/create', async (req, res) => {
  try {
    const { name, description, failureInjections, duration } = req.body;
    const experiment = await chaosTestAutomation.createExperiment(name, description, failureInjections, duration);
    res.json(experiment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/experiments/{experimentId}/run:
 *   post:
 *     summary: Run a chaos experiment
 *     tags: [Chaos]
 *     parameters:
 *       - in: path
 *         name: experimentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Experiment result
 *       500:
 *         description: Server error
 */
router.post('/experiments/:experimentId/run', async (req, res) => {
  try {
    const experiment = await chaosTestAutomation.runExperiment(req.params.experimentId);
    res.json(experiment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/experiments:
 *   get:
 *     summary: List all chaos experiments
 *     tags: [Chaos]
 *     responses:
 *       200:
 *         description: List of experiments
 *       500:
 *         description: Server error
 */
router.get('/experiments', async (req, res) => {
  try {
    const experiments = await chaosTestAutomation.getAllExperiments();
    res.json({ experiments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/reports/generate:
 *   post:
 *     summary: Generate a chaos experiment report
 *     tags: [Chaos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [experimentId]
 *             properties:
 *               experimentId: { type: string }
 *               results: { type: object }
 *               metrics: { type: object }
 *     responses:
 *       200:
 *         description: Report generated
 *       500:
 *         description: Server error
 */
router.post('/reports/generate', async (req, res) => {
  try {
    const { experimentId, results, metrics } = req.body;
    const report = await chaosReporter.generateReport(experimentId, results, metrics);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/reports/{experimentId}:
 *   get:
 *     summary: Get reports for a chaos experiment
 *     tags: [Chaos]
 *     parameters:
 *       - in: path
 *         name: experimentId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Experiment reports
 *       500:
 *         description: Server error
 */
router.get('/reports/:experimentId', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const reports = await chaosReporter.getReports(req.params.experimentId, limit);
    res.json({ reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/chaos/reports/summary:
 *   get:
 *     summary: Get a summary report across all chaos experiments
 *     tags: [Chaos]
 *     responses:
 *       200:
 *         description: Summary report
 *       500:
 *         description: Server error
 */
router.get('/reports/summary', async (req, res) => {
  try {
    const summary = await chaosReporter.generateSummaryReport();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
