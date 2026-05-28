import express from 'express';
import {
  LoadTestScenario,
  PerformanceBaseline,
  LoadTestRunner,
  regressionTester,
  bottleneckAnalyzer,
  capacityPlanner,
  performanceAlerting,
  optimizationRecommender
} from '../loadTesting/index.js';

const router = express.Router();

/**
 * @swagger
 * /api/load-testing/scenarios/create:
 *   post:
 *     summary: Create a load test scenario
 *     tags: [LoadTesting]
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
 *               requests:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     method: { type: string }
 *                     path: { type: string }
 *                     body: { type: object }
 *                     weight: { type: number }
 *               duration: { type: integer, description: Duration in ms }
 *               rampUp: { type: integer }
 *               concurrency: { type: integer }
 *     responses:
 *       200:
 *         description: Scenario created
 *       500:
 *         description: Server error
 */
router.post('/scenarios/create', async (req, res) => {
  try {
    const { name, description, requests, duration, rampUp, concurrency } = req.body;
    const scenario = new LoadTestScenario(name, description);
    
    for (const req of requests) {
      scenario.addRequest(req.method, req.path, req.body, req.weight);
    }
    
    scenario.setDuration(duration).setRampUp(rampUp).setConcurrency(concurrency);
    await scenario.save();
    
    res.json({ message: 'Scenario created', scenario });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/run:
 *   post:
 *     summary: Run a load test scenario
 *     tags: [LoadTesting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scenarioName]
 *             properties:
 *               scenarioName: { type: string }
 *               baseUrl: { type: string, default: 'http://localhost:3001' }
 *     responses:
 *       200:
 *         description: Load test results
 *       500:
 *         description: Server error
 */
router.post('/run', async (req, res) => {
  try {
    const { scenarioName, baseUrl } = req.body;
    const scenario = await LoadTestScenario.load(scenarioName);
    const runner = new LoadTestRunner();
    
    const results = await runner.runScenario(scenario, baseUrl || 'http://localhost:3001');
    const saved = await runner.saveResults(scenarioName);
    
    res.json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/results/{scenarioName}:
 *   get:
 *     summary: Get latest load test results for a scenario
 *     tags: [LoadTesting]
 *     parameters:
 *       - in: path
 *         name: scenarioName
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Test results
 *       500:
 *         description: Server error
 */
router.get('/results/:scenarioName', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const results = await LoadTestRunner.getLatestResults(req.params.scenarioName, limit);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/baseline/establish:
 *   post:
 *     summary: Establish a performance baseline from latest results
 *     tags: [LoadTesting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scenarioName]
 *             properties:
 *               scenarioName: { type: string }
 *     responses:
 *       200:
 *         description: Baseline established
 *       400:
 *         description: No test results found
 *       500:
 *         description: Server error
 */
router.post('/baseline/establish', async (req, res) => {
  try {
    const { scenarioName } = req.body;
    const results = await LoadTestRunner.getLatestResults(scenarioName, 1);
    
    if (results.length === 0) {
      return res.status(400).json({ error: 'No test results found' });
    }

    const baseline = new PerformanceBaseline(scenarioName);
    baseline.calculateFromResults(results[0].results);
    await baseline.save();
    
    res.json({ baseline });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/baseline/latest/{scenarioName}:
 *   get:
 *     summary: Get the latest performance baseline for a scenario
 *     tags: [LoadTesting]
 *     parameters:
 *       - in: path
 *         name: scenarioName
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Latest baseline
 *       500:
 *         description: Server error
 */
router.get('/baseline/latest/:scenarioName', async (req, res) => {
  try {
    const baseline = await PerformanceBaseline.getLatest(req.params.scenarioName);
    res.json({ baseline });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/regression/check:
 *   post:
 *     summary: Check for performance regressions against baseline
 *     tags: [LoadTesting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scenarioName]
 *             properties:
 *               scenarioName: { type: string }
 *     responses:
 *       200:
 *         description: Regression report
 *       400:
 *         description: Missing baseline or results
 *       500:
 *         description: Server error
 */
router.post('/regression/check', async (req, res) => {
  try {
    const { scenarioName } = req.body;
    const baseline = await PerformanceBaseline.getLatest(scenarioName);
    const results = await LoadTestRunner.getLatestResults(scenarioName, 1);
    
    if (!baseline || results.length === 0) {
      return res.status(400).json({ error: 'Missing baseline or results' });
    }

    const regressions = regressionTester.detectRegression(results[0].summary, baseline);
    const report = regressionTester.generateReport(regressions);
    
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/bottlenecks/analyze:
 *   post:
 *     summary: Analyze bottlenecks from latest test results
 *     tags: [LoadTesting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scenarioName]
 *             properties:
 *               scenarioName: { type: string }
 *     responses:
 *       200:
 *         description: Bottlenecks and recommendations
 *       400:
 *         description: No test results found
 *       500:
 *         description: Server error
 */
router.post('/bottlenecks/analyze', async (req, res) => {
  try {
    const { scenarioName } = req.body;
    const results = await LoadTestRunner.getLatestResults(scenarioName, 1);
    
    if (results.length === 0) {
      return res.status(400).json({ error: 'No test results found' });
    }

    const bottlenecks = bottleneckAnalyzer.analyze(results[0].results);
    const recommendations = bottleneckAnalyzer.getRecommendations(bottlenecks);
    
    res.json({ bottlenecks, recommendations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/capacity/calculate:
 *   post:
 *     summary: Calculate current capacity from test results
 *     tags: [LoadTesting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scenarioName]
 *             properties:
 *               scenarioName: { type: string }
 *               targetErrorRate: { type: number, default: 1 }
 *     responses:
 *       200:
 *         description: Capacity data
 *       400:
 *         description: No test results found
 *       500:
 *         description: Server error
 */
router.post('/capacity/calculate', async (req, res) => {
  try {
    const { scenarioName, targetErrorRate } = req.body;
    const results = await LoadTestRunner.getLatestResults(scenarioName, 1);
    
    if (results.length === 0) {
      return res.status(400).json({ error: 'No test results found' });
    }

    const capacity = capacityPlanner.calculateCapacity(results[0].summary, targetErrorRate || 1);
    res.json(capacity);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/capacity/project:
 *   post:
 *     summary: Project future capacity needs based on growth rate
 *     tags: [LoadTesting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scenarioName, growthRate, months]
 *             properties:
 *               scenarioName: { type: string }
 *               growthRate: { type: number, description: Monthly growth rate as decimal }
 *               months: { type: integer }
 *     responses:
 *       200:
 *         description: Capacity projection
 *       400:
 *         description: No test results found
 *       500:
 *         description: Server error
 */
router.post('/capacity/project', async (req, res) => {
  try {
    const { scenarioName, growthRate, months } = req.body;
    const results = await LoadTestRunner.getLatestResults(scenarioName, 1);
    
    if (results.length === 0) {
      return res.status(400).json({ error: 'No test results found' });
    }

    const projection = capacityPlanner.estimateScalingNeeds(
      results[0].summary.throughput,
      growthRate,
      months
    );
    res.json(projection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/alerts/check:
 *   post:
 *     summary: Check performance metrics against alert thresholds
 *     tags: [LoadTesting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scenarioName]
 *             properties:
 *               scenarioName: { type: string }
 *     responses:
 *       200:
 *         description: Alerts triggered
 *       400:
 *         description: No test results found
 *       500:
 *         description: Server error
 */
router.post('/alerts/check', async (req, res) => {
  try {
    const { scenarioName } = req.body;
    const results = await LoadTestRunner.getLatestResults(scenarioName, 1);
    
    if (results.length === 0) {
      return res.status(400).json({ error: 'No test results found' });
    }

    const alerts = performanceAlerting.checkMetrics(results[0].summary);
    await performanceAlerting.saveAlerts();
    
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/alerts:
 *   get:
 *     summary: Get performance alerts
 *     tags: [LoadTesting]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100 }
 *     responses:
 *       200:
 *         description: Performance alerts
 *       500:
 *         description: Server error
 */
router.get('/alerts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const alerts = await performanceAlerting.constructor.getAlerts(limit);
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/alerts/critical:
 *   get:
 *     summary: Get critical performance alerts
 *     tags: [LoadTesting]
 *     responses:
 *       200:
 *         description: Critical alerts
 *       500:
 *         description: Server error
 */
router.get('/alerts/critical', async (req, res) => {
  try {
    const alerts = await performanceAlerting.constructor.getCriticalAlerts();
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/load-testing/recommendations:
 *   post:
 *     summary: Get optimization recommendations from test results
 *     tags: [LoadTesting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scenarioName]
 *             properties:
 *               scenarioName: { type: string }
 *     responses:
 *       200:
 *         description: Prioritized recommendations
 *       400:
 *         description: No test results found
 *       500:
 *         description: Server error
 */
router.post('/recommendations', async (req, res) => {
  try {
    const { scenarioName } = req.body;
    const results = await LoadTestRunner.getLatestResults(scenarioName, 1);
    
    if (results.length === 0) {
      return res.status(400).json({ error: 'No test results found' });
    }

    const bottlenecks = bottleneckAnalyzer.analyze(results[0].results);
    const recommendations = optimizationRecommender.generateRecommendations(
      results[0].summary,
      bottlenecks
    );
    const prioritized = optimizationRecommender.prioritizeRecommendations(recommendations);
    
    res.json({ recommendations: prioritized });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
