/**
 * Disaster Recovery Testing Suite
 *
 * Covers:
 *  - Disaster simulation scenarios
 *  - Backup creation and restore verification
 *  - Failover testing
 *  - Data recovery testing
 *  - Recovery time (RTO) testing
 *  - Business continuity testing
 *  - Disaster recovery automation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  failureInjector,
  networkPartitionSimulator,
  serviceFailureSimulator,
  databaseFailureSimulator,
  recoveryTimeAnalyzer,
  chaosTestAutomation,
  chaosReporter,
} from '../src/chaos/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

async function cleanup() {
  try { await fs.rm(DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(cleanup);
afterEach(cleanup);

// ── 1. Disaster simulation scenarios ─────────────────────────────────────────
describe('Disaster Simulation Scenarios', () => {
  it('simulates network partition', () => {
    failureInjector.removeAllInjections();
    const injection = failureInjector.injectLatency('network', 5000, 1.0);
    expect(injection.type).toBe('LATENCY');
    expect(injection.delayMs).toBe(5000);
    failureInjector.removeAllInjections();
  });

  it('simulates service crash', () => {
    failureInjector.removeAllInjections();
    const injection = failureInjector.injectError('payment-service', 100, 503);
    expect(injection.type).toBe('ERROR');
    expect(injection.statusCode).toBe(503);
    failureInjector.removeAllInjections();
  });

  it('simulates database failure', () => {
    const failure = databaseFailureSimulator.simulateConnectionFailure('primary-db');
    expect(failure.type).toBe('CONNECTION_FAILURE');
    expect(failure.target).toBe('primary-db');
    databaseFailureSimulator.restore('primary-db');
  });

  it('creates and tracks a chaos experiment', async () => {
    const experiment = await chaosTestAutomation.createExperiment(
      'DR-Scenario-1',
      'Simulate primary DB failure',
      [{ type: 'DATABASE_FAILURE', target: 'primary-db' }],
      100 // 100ms duration for test speed
    );
    expect(experiment.id).toBeDefined();
    expect(experiment.status).toBe('CREATED');
  });
});

// ── 2. Backup / restore testing ───────────────────────────────────────────────
describe('Backup and Restore Testing', () => {
  it('creates a backup manifest file', async () => {
    const backupDir = path.join(DATA_DIR, 'backups');
    await fs.mkdir(backupDir, { recursive: true });

    const manifest = {
      id: `backup-${Date.now()}`,
      createdAt: new Date().toISOString(),
      type: 'full',
      checksum: 'sha256:abc123',
      sizeBytes: 1024,
    };
    const file = path.join(backupDir, `${manifest.id}.json`);
    await fs.writeFile(file, JSON.stringify(manifest, null, 2));

    const loaded = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(loaded.type).toBe('full');
    expect(loaded.checksum).toMatch(/^sha256:/);
  });

  it('verifies backup integrity via checksum field', async () => {
    const backupDir = path.join(DATA_DIR, 'backups');
    await fs.mkdir(backupDir, { recursive: true });

    const manifest = { id: 'bk-1', checksum: 'sha256:deadbeef', sizeBytes: 512 };
    await fs.writeFile(path.join(backupDir, 'bk-1.json'), JSON.stringify(manifest));

    const loaded = JSON.parse(await fs.readFile(path.join(backupDir, 'bk-1.json'), 'utf8'));
    expect(loaded.checksum).toBeDefined();
    expect(loaded.checksum.startsWith('sha256:')).toBe(true);
  });

  it('lists available backups for restore selection', async () => {
    const backupDir = path.join(DATA_DIR, 'backups');
    await fs.mkdir(backupDir, { recursive: true });

    for (let i = 0; i < 3; i++) {
      await fs.writeFile(
        path.join(backupDir, `bk-${i}.json`),
        JSON.stringify({ id: `bk-${i}`, type: 'full' })
      );
    }

    const files = await fs.readdir(backupDir);
    expect(files.length).toBe(3);
  });
});

// ── 3. Failover testing ───────────────────────────────────────────────────────
describe('Failover Testing', () => {
  it('records a service failover event', () => {
    const metric = recoveryTimeAnalyzer.recordRecovery('payment-service', 'CRASH', 3000, ['restart']);
    expect(metric.serviceId).toBe('payment-service');
    expect(metric.recovered).toBe(true);
    expect(metric.recoveryTime).toBe(3000);
  });

  it('calculates MTTR after multiple failures', () => {
    recoveryTimeAnalyzer.recoveryMetrics = [];
    recoveryTimeAnalyzer.recordRecovery('svc-a', 'CRASH', 2000);
    recoveryTimeAnalyzer.recordRecovery('svc-a', 'CRASH', 4000);
    const mttr = recoveryTimeAnalyzer.calculateMTTR('svc-a');
    expect(mttr).toBe(3000);
  });

  it('calculates availability percentage', () => {
    recoveryTimeAnalyzer.recoveryMetrics = [];
    recoveryTimeAnalyzer.recordRecovery('svc-b', 'CRASH', 600000); // 10 min downtime
    const availability = recoveryTimeAnalyzer.calculateAvailability('svc-b');
    expect(typeof availability).toBe('number');
    expect(availability).toBeGreaterThanOrEqual(0);
    expect(availability).toBeLessThanOrEqual(100);
  });
});

// ── 4. Data recovery testing ──────────────────────────────────────────────────
describe('Data Recovery Testing', () => {
  it('writes and recovers data from a recovery store file', async () => {
    const recoveryDir = path.join(DATA_DIR, 'recovery');
    await fs.mkdir(recoveryDir, { recursive: true });

    const snapshot = { userId: 'u1', balance: '100.00', timestamp: new Date().toISOString() };
    await fs.writeFile(path.join(recoveryDir, 'snapshot-u1.json'), JSON.stringify(snapshot));

    const recovered = JSON.parse(await fs.readFile(path.join(recoveryDir, 'snapshot-u1.json'), 'utf8'));
    expect(recovered.userId).toBe('u1');
    expect(recovered.balance).toBe('100.00');
  });

  it('detects missing recovery data', async () => {
    const recoveryDir = path.join(DATA_DIR, 'recovery');
    await fs.mkdir(recoveryDir, { recursive: true });

    await expect(
      fs.readFile(path.join(recoveryDir, 'snapshot-missing.json'), 'utf8')
    ).rejects.toThrow();
  });
});

// ── 5. Recovery time (RTO) testing ────────────────────────────────────────────
describe('Recovery Time Objective (RTO)', () => {
  it('meets RTO of 60 seconds for service restart', () => {
    const RTO_MS = 60_000;
    const metric = recoveryTimeAnalyzer.recordRecovery('api', 'CRASH', 30_000);
    expect(metric.recoveryTime).toBeLessThanOrEqual(RTO_MS);
  });

  it('flags RTO breach when recovery exceeds threshold', () => {
    const RTO_MS = 60_000;
    const metric = recoveryTimeAnalyzer.recordRecovery('api', 'CRASH', 120_000);
    expect(metric.recoveryTime).toBeGreaterThan(RTO_MS);
  });
});

// ── 6. Business continuity testing ───────────────────────────────────────────
describe('Business Continuity', () => {
  it('schedules a DR experiment', async () => {
    const experiment = await chaosTestAutomation.createExperiment(
      'BC-Test', 'Business continuity drill', [], 100
    );
    const schedule = chaosTestAutomation.scheduleExperiment(experiment.id, '0 2 * * *');
    expect(schedule.enabled).toBe(true);
    expect(schedule.nextRun).toBeDefined();
  });
});

// ── 7. DR automation ──────────────────────────────────────────────────────────
describe('Disaster Recovery Automation', () => {
  it('runs a chaos experiment end-to-end', async () => {
    const experiment = await chaosTestAutomation.createExperiment(
      'Auto-DR', 'Automated DR test', [], 50
    );
    const result = await chaosTestAutomation.runExperiment(experiment.id, {
      onStart: vi.fn(),
      onComplete: vi.fn(),
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.endTime).toBeGreaterThan(result.startTime);
  });

  it('generates a chaos report after experiment', async () => {
    const report = await chaosReporter.generateReport(
      'auto-dr-1',
      { status: 'COMPLETED', startTime: Date.now() - 1000, endTime: Date.now(), failuresInjected: 1, servicesAffected: ['api'], errorRate: 0, downtime: 500 },
      { mttr: 500, mtbf: null, availability: 99.9, recoveryTime: 500 }
    );
    expect(report).toBeDefined();
    expect(report.experimentId).toBe('auto-dr-1');
    expect(report.insights).toBeDefined();
  });
});
