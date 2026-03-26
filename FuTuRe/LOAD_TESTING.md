# Load Testing Framework

Comprehensive load testing system for performance analysis and optimization.

## Features

### 1. Realistic Load Testing Scenarios

Create and manage load testing scenarios with configurable parameters.

```javascript
import { LoadTestScenario } from './loadTesting/index.js';

const scenario = new LoadTestScenario('payment-flow', 'Payment processing test');
scenario.addRequest('GET', '/api/health');
scenario.addRequest('POST', '/api/stellar/account/create', {}, 1);
scenario.addRequest('POST', '/api/stellar/payment/send', { amount: '100' }, 5);
scenario.setDuration(120).setRampUp(20).setConcurrency(50);
await scenario.save();
```

**API Endpoint:**
- `POST /api/load-testing/scenarios/create` - Create scenario

### 2. Performance Baseline Establishment

Establish and track performance baselines for regression detection.

```javascript
import { PerformanceBaseline, LoadTestRunner } from './loadTesting/index.js';

const runner = new LoadTestRunner();
const results = await runner.runScenario(scenario);
const baseline = new PerformanceBaseline('payment-flow');
baseline.calculateFromResults(results);
await baseline.save();
```

**API Endpoints:**
- `POST /api/load-testing/baseline/establish` - Establish baseline
- `GET /api/load-testing/baseline/latest/:scenarioName` - Get latest baseline

### 3. Automated Performance Regression Testing

Detect performance regressions automatically.

```javascript
import { regressionTester } from './loadTesting/index.js';

const regressions = regressionTester.detectRegression(currentResults, baseline);
const report = regressionTester.generateReport(regressions);
// { status: 'PASS' | 'WARN' | 'FAIL', summary: {...}, regressions: [...] }
```

**API Endpoint:**
- `POST /api/load-testing/regression/check` - Check for regressions

### 4. Capacity Planning Tools

Calculate maximum capacity and scaling needs.

```javascript
import { capacityPlanner } from './loadTesting/index.js';

// Calculate current capacity
const capacity = capacityPlanner.calculateCapacity(results, targetErrorRate);
// { currentThroughput, maxSafeThroughput, maxCapacity, headroom, recommendations }

// Project scaling needs
const projection = capacityPlanner.estimateScalingNeeds(throughput, growthRate, months);
// { currentThroughput, projectedThroughput, scalingFactor, recommendations }
```

**API Endpoints:**
- `POST /api/load-testing/capacity/calculate` - Calculate capacity
- `POST /api/load-testing/capacity/project` - Project scaling needs

### 5. Performance Bottleneck Identification

Identify and analyze performance bottlenecks.

```javascript
import { bottleneckAnalyzer } from './loadTesting/index.js';

const bottlenecks = bottleneckAnalyzer.analyze(results);
const recommendations = bottleneckAnalyzer.getRecommendations(bottlenecks);
```

**API Endpoint:**
- `POST /api/load-testing/bottlenecks/analyze` - Analyze bottlenecks

### 6. Performance Alerting

Real-time performance alerting with configurable thresholds.

```javascript
import { performanceAlerting } from './loadTesting/index.js';

performanceAlerting.setThreshold('avgResponseTime', 1000);
performanceAlerting.setThreshold('errorRate', 5);

const alerts = performanceAlerting.checkMetrics(results);
await performanceAlerting.saveAlerts();
```

**API Endpoints:**
- `POST /api/load-testing/alerts/check` - Check metrics and generate alerts
- `GET /api/load-testing/alerts` - Get all alerts
- `GET /api/load-testing/alerts/critical` - Get critical alerts

### 7. Optimization Recommendations

Get actionable optimization recommendations.

```javascript
import { optimizationRecommender } from './loadTesting/index.js';

const recommendations = optimizationRecommender.generateRecommendations(results, bottlenecks);
const prioritized = optimizationRecommender.prioritizeRecommendations(recommendations);
```

**API Endpoint:**
- `POST /api/load-testing/recommendations` - Get optimization recommendations

### 8. Load Testing Execution

Run load tests and collect results.

```javascript
import { LoadTestRunner } from './loadTesting/index.js';

const runner = new LoadTestRunner();
const results = await runner.runScenario(scenario, 'http://localhost:3001');
const saved = await runner.saveResults('payment-flow');
```

**API Endpoints:**
- `POST /api/load-testing/run` - Run load test
- `GET /api/load-testing/results/:scenarioName` - Get test results

## Metrics Collected

- **Response Time**: Min, max, average, p50, p95, p99
- **Throughput**: Requests per second
- **Error Rate**: Percentage of failed requests
- **Success Count**: Total successful requests
- **Error Count**: Total failed requests
- **Duration**: Total test duration

## Storage Structure

```
data/load-tests/
├── scenarios/          # Test scenarios (JSON)
├── baselines/          # Performance baselines (JSON)
├── results/            # Test results (JSON)
└── alerts/             # Performance alerts (JSON)
```

## Performance Thresholds (Default)

- Average Response Time: 1000ms
- P95 Response Time: 2000ms
- Error Rate: 5%
- Throughput: 10 req/s

## Regression Detection Thresholds

- Average Response Time: 10% increase
- P95 Response Time: 15% increase
- Error Rate: 5% increase
- Throughput: 10% decrease

## Bottleneck Severity Calculation

Severity is calculated based on:
- Average response time (0-3 points)
- P95 response time (0-3 points)
- Error rate (0-3 points)

## Capacity Planning

Calculates:
- Current throughput
- Maximum safe throughput (based on error rate)
- Maximum capacity (based on response time)
- Headroom percentage
- Scaling recommendations

## Scaling Projections

Estimates:
- Projected throughput based on growth rate
- Scaling factor needed
- Recommendations for horizontal/vertical scaling
- Caching and optimization strategies

## API Examples

### Create Scenario

```bash
curl -X POST http://localhost:3001/api/load-testing/scenarios/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "payment-flow",
    "description": "Payment processing test",
    "requests": [
      {"method": "GET", "path": "/api/health", "weight": 1},
      {"method": "POST", "path": "/api/stellar/payment/send", "weight": 5}
    ],
    "duration": 120,
    "rampUp": 20,
    "concurrency": 50
  }'
```

### Run Load Test

```bash
curl -X POST http://localhost:3001/api/load-testing/run \
  -H "Content-Type: application/json" \
  -d '{"scenarioName": "payment-flow"}'
```

### Check for Regressions

```bash
curl -X POST http://localhost:3001/api/load-testing/regression/check \
  -H "Content-Type: application/json" \
  -d '{"scenarioName": "payment-flow"}'
```

### Get Optimization Recommendations

```bash
curl -X POST http://localhost:3001/api/load-testing/recommendations \
  -H "Content-Type: application/json" \
  -d '{"scenarioName": "payment-flow"}'
```

### Calculate Capacity

```bash
curl -X POST http://localhost:3001/api/load-testing/capacity/calculate \
  -H "Content-Type: application/json" \
  -d '{"scenarioName": "payment-flow", "targetErrorRate": 1}'
```

### Project Scaling Needs

```bash
curl -X POST http://localhost:3001/api/load-testing/capacity/project \
  -H "Content-Type: application/json" \
  -d '{"scenarioName": "payment-flow", "growthRate": 0.2, "months": 12}'
```

## CI/CD Integration

Add to your CI/CD pipeline:

```yaml
# .github/workflows/performance.yml
name: Performance Testing
on: [push, pull_request]

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run load tests
        run: |
          npm run load-test
      - name: Check regressions
        run: |
          npm run check-regression
      - name: Generate report
        run: |
          npm run performance-report
```

## Testing

Run load testing tests:

```bash
npm test -- loadTesting.test.js
```

## Best Practices

1. **Establish Baselines**: Create baselines before making changes
2. **Regular Testing**: Run load tests regularly (daily/weekly)
3. **Monitor Trends**: Track performance over time
4. **Act on Alerts**: Investigate and fix critical alerts
5. **Document Changes**: Record optimization efforts
6. **Capacity Planning**: Plan for growth proactively
7. **Realistic Scenarios**: Use realistic user behavior patterns
8. **Gradual Ramp-up**: Use ramp-up to simulate real traffic

## Performance Optimization Tips

1. **Caching**: Implement Redis/Memcached for frequently accessed data
2. **Database**: Add indexes, optimize queries, use connection pooling
3. **Async**: Use async/await patterns for I/O operations
4. **Batching**: Batch requests where possible
5. **Circuit Breakers**: Implement circuit breakers for external services
6. **Monitoring**: Use APM tools for detailed insights
7. **Scaling**: Plan horizontal scaling for high-traffic scenarios
8. **Testing**: Conduct regular load tests and regression testing

## Future Enhancements

- Distributed load testing
- Real-time dashboards
- Advanced analytics
- Machine learning-based anomaly detection
- Integration with monitoring tools
- Automated scaling recommendations
- Cost optimization analysis
