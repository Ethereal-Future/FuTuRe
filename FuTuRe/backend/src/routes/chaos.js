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

// Failure injection endpoints
router.post('/inject/latency', (req, res) => {
  try {
    const { targetId, delayMs, probability } = req.body;
    const injection = failureInjector.injectLatency(targetId, delayMs, probability);
    res.json(injection);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/inject/error', (req, res) => {
  try {
    const { targetId, errorRate, errorCode, probability } = req.body;
    const injection = failureInjector.injectError(targetId, errorRate, errorCode, probability);
    res.json(injection);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/inject/packet-loss', (req, res) => {
  try {
    const { targetId, lossRate, probability } = req.body;
    const injection = failureInjector.injectPacketLoss(targetId, lossRate, probability);
    res.json(injection);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/failures/active', (req, res) => {
  try {
    const failures = failureInjector.getActiveFailures();
    res.json({ failures });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/failures/remove/:injectionId', (req, res) => {
  try {
    failureInjector.removeInjection(req.params.injectionId);
    res.json({ message: 'Injection removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Network partition endpoints
router.post('/network/partition', (req, res) => {
  try {
    const { partitionId, affectedServices, healTime } = req.body;
    const partition = networkPartitionSimulator.createPartition(partitionId, affectedServices, healTime);
    res.json(partition);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/network/partitions', (req, res) => {
  try {
    const partitions = networkPartitionSimulator.getActivePartitions();
    res.json({ partitions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/network/heal/:partitionId', (req, res) => {
  try {
    networkPartitionSimulator.healPartition(req.params.partitionId);
    res.json({ message: 'Partition healed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Service failure endpoints
router.post('/service/fail', (req, res) => {
  try {
    const { serviceId, failureType, recoveryTime } = req.body;
    const failure = serviceFailureSimulator.failService(serviceId, failureType, recoveryTime);
    res.json(failure);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/service/failures', (req, res) => {
  try {
    const failures = serviceFailureSimulator.getAllFailures();
    res.json({ failures });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/service/recover/:serviceId', (req, res) => {
  try {
    serviceFailureSimulator.recoverService(req.params.serviceId);
    res.json({ message: 'Service recovered' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Database failure endpoints
router.post('/database/fail', (req, res) => {
  try {
    const { databaseId, failureType, recoveryTime } = req.body;
    const failure = databaseFailureSimulator.failDatabase(databaseId, failureType, recoveryTime);
    res.json(failure);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/database/query-failure', (req, res) => {
  try {
    const { queryPattern, failureRate, errorMessage } = req.body;
    const failure = databaseFailureSimulator.injectQueryFailure(queryPattern, failureRate, errorMessage);
    res.json(failure);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Recovery analysis endpoints
router.post('/recovery/record', (req, res) => {
  try {
    const { serviceId, failureType, downtime, recoveryActions } = req.body;
    const metric = recoveryTimeAnalyzer.recordRecovery(serviceId, failureType, downtime, recoveryActions);
    res.json(metric);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/recovery/report/:serviceId', (req, res) => {
  try {
    const report = recoveryTimeAnalyzer.getRecoveryReport(req.params.serviceId);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Blast radius endpoints
router.post('/blast-radius/limit', (req, res) => {
  try {
    const { limitId, maxAffectedServices, maxErrorRate, maxDowntime } = req.body;
    const limit = blastRadiusLimiter.setLimit(limitId, maxAffectedServices, maxErrorRate, maxDowntime);
    res.json(limit);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/blast-radius/check', (req, res) => {
  try {
    const { failureId, affectedServices, estimatedErrorRate } = req.body;
    const result = blastRadiusLimiter.canInjectFailure(failureId, affectedServices, estimatedErrorRate);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Chaos experiment endpoints
router.post('/experiments/create', async (req, res) => {
  try {
    const { name, description, failureInjections, duration } = req.body;
    const experiment = await chaosTestAutomation.createExperiment(name, description, failureInjections, duration);
    res.json(experiment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/experiments/:experimentId/run', async (req, res) => {
  try {
    const experiment = await chaosTestAutomation.runExperiment(req.params.experimentId);
    res.json(experiment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/experiments', async (req, res) => {
  try {
    const experiments = await chaosTestAutomation.getAllExperiments();
    res.json({ experiments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reporting endpoints
router.post('/reports/generate', async (req, res) => {
  try {
    const { experimentId, results, metrics } = req.body;
    const report = await chaosReporter.generateReport(experimentId, results, metrics);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/reports/:experimentId', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const reports = await chaosReporter.getReports(req.params.experimentId, limit);
    res.json({ reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/reports/summary', async (req, res) => {
  try {
    const summary = await chaosReporter.generateSummaryReport();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
