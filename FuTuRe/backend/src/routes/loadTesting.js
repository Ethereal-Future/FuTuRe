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

// Scenario endpoints
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

// Load test endpoints
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

router.get('/results/:scenarioName', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const results = await LoadTestRunner.getLatestResults(req.params.scenarioName, limit);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Baseline endpoints
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

router.get('/baseline/latest/:scenarioName', async (req, res) => {
  try {
    const baseline = await PerformanceBaseline.getLatest(req.params.scenarioName);
    res.json({ baseline });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Regression testing endpoints
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

// Bottleneck analysis endpoints
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

// Capacity planning endpoints
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

// Performance alerting endpoints
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

router.get('/alerts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const alerts = await performanceAlerting.constructor.getAlerts(limit);
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/alerts/critical', async (req, res) => {
  try {
    const alerts = await performanceAlerting.constructor.getCriticalAlerts();
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Optimization recommendations endpoints
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
