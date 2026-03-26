# Chaos Engineering Framework

Enterprise-grade chaos engineering system for testing system resilience and reliability.

## Features

### 1. Failure Injection Framework

Inject various types of failures to test system behavior.

```javascript
import { failureInjector } from './chaos/index.js';

// Inject latency
failureInjector.injectLatency('api-1', 500, 1.0); // 500ms delay, 100% probability

// Inject errors
failureInjector.injectError('api-1', 10, 500); // 10% error rate, 500 status code

// Inject packet loss
failureInjector.injectPacketLoss('api-1', 5); // 5% packet loss

// Inject CPU spike
failureInjector.injectCpuSpike('api-1', 80, 30000); // 80% CPU for 30 seconds

// Inject memory leak
failureInjector.injectMemoryLeak('api-1', 10); // 10MB/s leak rate
```

**API Endpoints:**
- `POST /api/chaos/inject/latency` - Inject latency
- `POST /api/chaos/inject/error` - Inject errors
- `POST /api/chaos/inject/packet-loss` - Inject packet loss
- `GET /api/chaos/failures/active` - Get active failures
- `POST /api/chaos/failures/remove/:injectionId` - Remove injection

### 2. Network Partition Testing

Simulate network partitions between services.

```javascript
import { networkPartitionSimulator } from './chaos/index.js';

// Create partition
const partition = networkPartitionSimulator.createPartition(
  'part-1',
  ['api', 'db'],
  60000 // heal after 60 seconds
);

// Check if partitioned
const isPartitioned = networkPartitionSimulator.isPartitioned('api', 'db');

// Heal partition
networkPartitionSimulator.healPartition('part-1');
```

**API Endpoints:**
- `POST /api/chaos/network/partition` - Create partition
- `GET /api/chaos/network/partitions` - Get active partitions
- `POST /api/chaos/network/heal/:partitionId` - Heal partition

### 3. Service Failure Simulation

Simulate service failures and recovery.

```javascript
import { serviceFailureSimulator } from './chaos/index.js';

// Fail service
const failure = serviceFailureSimulator.failService(
  'api-1',
  'CRASH',
  30000 // recover after 30 seconds
);

// Check if failed
const isFailed = serviceFailureSimulator.isServiceFailed('api-1');

// Recover service
serviceFailureSimulator.recoverService('api-1');
```

**API Endpoints:**
- `POST /api/chaos/service/fail` - Fail service
- `GET /api/chaos/service/failures` - Get all failures
- `POST /api/chaos/service/recover/:serviceId` - Recover service

### 4. Database Failure Testing

Simulate database failures and query failures.

```javascript
import { databaseFailureSimulator } from './chaos/index.js';

// Fail database
databaseFailureSimulator.failDatabase('db-1', 'CONNECTION_TIMEOUT', 60000);

// Inject query failure
databaseFailureSimulator.injectQueryFailure('SELECT', 0.5, 'Query timeout');

// Check if failed
const isFailed = databaseFailureSimulator.isDatabaseFailed('db-1');
```

**API Endpoints:**
- `POST /api/chaos/database/fail` - Fail database
- `POST /api/chaos/database/query-failure` - Inject query failure

### 5. Recovery Time Measurement

Measure and analyze recovery metrics.

```javascript
import { recoveryTimeAnalyzer } from './chaos/index.js';

// Record recovery
recoveryTimeAnalyzer.recordRecovery('api-1', 'CRASH', 5000);

// Calculate MTTR (Mean Time To Recovery)
const mttr = recoveryTimeAnalyzer.calculateMTTR('api-1');

// Calculate MTBF (Mean Time Between Failures)
const mtbf = recoveryTimeAnalyzer.calculateMTBF('api-1');

// Calculate availability
const availability = recoveryTimeAnalyzer.calculateAvailability('api-1');

// Get report
const report = recoveryTimeAnalyzer.getRecoveryReport('api-1');
```

**API Endpoints:**
- `POST /api/chaos/recovery/record` - Record recovery
- `GET /api/chaos/recovery/report/:serviceId` - Get recovery report

### 6. Blast Radius Limitation

Limit the scope of chaos experiments.

```javascript
import { blastRadiusLimiter } from './chaos/index.js';

// Set limits
blastRadiusLimiter.setLimit('limit-1', 3, 10, 60000);
// Max 3 services, 10% error rate, 60 second downtime

// Check if injection allowed
const result = blastRadiusLimiter.canInjectFailure(
  'fail-1',
  ['api', 'db'],
  5 // 5% error rate
);

// Record impact
blastRadiusLimiter.recordImpact('fail-1', ['api', 'db'], 5, 1000);
```

**API Endpoints:**
- `POST /api/chaos/blast-radius/limit` - Set limit
- `POST /api/chaos/blast-radius/check` - Check if injection allowed

### 7. Chaos Testing Automation

Automate chaos experiments.

```javascript
import { chaosTestAutomation } from './chaos/index.js';

// Create experiment
const experiment = await chaosTestAutomation.createExperiment(
  'payment-flow-test',
  'Test payment flow resilience',
  [
    { type: 'LATENCY', target: 'api', delay: 500 },
    { type: 'ERROR', target: 'db', rate: 10 }
  ],
  120000 // 2 minute duration
);

// Run experiment
await chaosTestAutomation.runExperiment(experiment.id);

// Schedule experiment
chaosTestAutomation.scheduleExperiment(experiment.id, '0 2 * * *'); // Daily at 2 AM
```

**API Endpoints:**
- `POST /api/chaos/experiments/create` - Create experiment
- `POST /api/chaos/experiments/:experimentId/run` - Run experiment
- `GET /api/chaos/experiments` - Get all experiments

### 8. Chaos Testing Reporting

Generate comprehensive chaos testing reports.

```javascript
import { chaosReporter } from './chaos/index.js';

// Generate report
const report = await chaosReporter.generateReport(
  'exp-1',
  {
    status: 'COMPLETED',
    failuresInjected: 3,
    servicesAffected: ['api', 'db'],
    errorRate: 5,
    downtime: 5000
  },
  {
    mttr: 5000,
    mtbf: 300000,
    availability: 99.5
  }
);

// Get reports
const reports = await chaosReporter.getReports('exp-1', 10);

// Generate summary
const summary = await chaosReporter.generateSummaryReport();
```

**API Endpoints:**
- `POST /api/chaos/reports/generate` - Generate report
- `GET /api/chaos/reports/:experimentId` - Get reports
- `GET /api/chaos/reports/summary` - Get summary report

## Storage Structure

```
data/chaos/
├── experiments/        # Experiment definitions (JSON)
└── reports/           # Experiment reports (JSON)
```

## Failure Types

- **LATENCY**: Add response delay
- **ERROR**: Inject errors with configurable rate
- **PACKET_LOSS**: Simulate network packet loss
- **CPU_SPIKE**: Spike CPU usage
- **MEMORY_LEAK**: Simulate memory leak
- **CONNECTION_TIMEOUT**: Database connection timeout
- **CRASH**: Service crash

## Metrics

- **MTTR**: Mean Time To Recovery
- **MTBF**: Mean Time Between Failures
- **Availability**: Percentage uptime
- **Error Rate**: Percentage of failed requests
- **Downtime**: Total downtime duration

## Best Practices

1. **Start Small**: Begin with low-impact experiments
2. **Limit Blast Radius**: Set strict limits on affected services
3. **Monitor Closely**: Watch metrics during experiments
4. **Document Results**: Record all findings
5. **Iterate**: Run experiments regularly
6. **Automate**: Schedule regular chaos tests
7. **Improve**: Act on findings to improve resilience
8. **Communicate**: Share results with team

## API Examples

### Inject Latency

```bash
curl -X POST http://localhost:3001/api/chaos/inject/latency \
  -H "Content-Type: application/json" \
  -d '{"targetId":"api-1","delayMs":500,"probability":1.0}'
```

### Create Network Partition

```bash
curl -X POST http://localhost:3001/api/chaos/network/partition \
  -H "Content-Type: application/json" \
  -d '{"partitionId":"part-1","affectedServices":["api","db"],"healTime":60000}'
```

### Fail Service

```bash
curl -X POST http://localhost:3001/api/chaos/service/fail \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"api-1","failureType":"CRASH","recoveryTime":30000}'
```

### Create Experiment

```bash
curl -X POST http://localhost:3001/api/chaos/experiments/create \
  -H "Content-Type: application/json" \
  -d '{
    "name":"payment-test",
    "description":"Test payment resilience",
    "failureInjections":[{"type":"LATENCY","target":"api"}],
    "duration":120000
  }'
```

## Testing

Run chaos tests:

```bash
npm test -- chaos.test.js
```

## Resilience Patterns

### Circuit Breaker
Prevent cascading failures by stopping requests to failing services.

### Bulkhead
Isolate resources to limit blast radius.

### Retry with Backoff
Automatically retry failed requests with exponential backoff.

### Timeout
Set timeouts to prevent hanging requests.

### Fallback
Provide fallback behavior when services fail.

## Monitoring Integration

Integrate with monitoring tools:
- Prometheus for metrics
- Grafana for dashboards
- ELK for log analysis
- PagerDuty for alerting

## Future Enhancements

- Distributed chaos testing
- Advanced scheduling
- Machine learning-based recommendations
- Integration with APM tools
- Real-time dashboards
- Automated remediation
- Cost analysis
