import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../tests/helpers/app.js';
import {
  SASTScanner,
  DASTScanner,
  DependencyScanner,
  ComplianceChecker,
  SecurityPipeline,
} from '../../testing/security-pipeline.js';

// Supertest-based requester for DAST probes
const makeRequester = (testApp) => async (method, path, body) => {
  const res = await request(testApp)[method.toLowerCase()](path).send(body);
  return { status: res.status, body: res.body, headers: res.headers };
};

describe('Security Testing Pipeline', () => {
  describe('SAST – Static Analysis', () => {
    let sast;
    beforeEach(() => { sast = new SASTScanner(); });

    it('passes clean source code', () => {
      const result = sast.scan('const x = 1 + 1;', 'clean.js');
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it('detects eval usage', () => {
      const result = sast.scan('eval(userInput)', 'bad.js');
      const finding = result.findings.find((f) => f.name === 'eval-usage');
      expect(finding).toBeDefined();
      expect(finding.severity).toBe('high');
    });

    it('detects insecure Math.random()', () => {
      const result = sast.scan('const token = Math.random().toString(36);', 'token.js');
      const finding = result.findings.find((f) => f.name === 'insecure-random');
      expect(finding).toBeDefined();
    });

    it('detects SQL injection risk in template literal', () => {
      const result = sast.scan('db.query(`SELECT * FROM users WHERE id = ${userId}`)', 'db.js');
      const finding = result.findings.find((f) => f.name === 'sql-injection-risk');
      expect(finding).toBeDefined();
    });

    it('flags critical/high findings as failed', () => {
      const result = sast.scan('eval(x)', 'evil.js');
      expect(result.passed).toBe(false);
    });
  });

  describe('DAST – Dynamic Analysis', () => {
    it('health endpoint passes all DAST probes', async () => {
      const dast = new DASTScanner(makeRequester(app));
      const result = await dast.probe('/health');
      // Health endpoint doesn't accept POST body fields, so all probes should be safe
      expect(result.passed).toBe(true);
    });
  });

  describe('Dependency scanning', () => {
    it('passes when no known vulnerabilities match', () => {
      const scanner = new DependencyScanner([
        { package: 'lodash', affectedVersions: ['4.17.15'], severity: 'high', cve: 'CVE-2021-23337' },
      ]);
      const result = scanner.scan({ express: '4.19.2', cors: '2.8.5' });
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it('fails when a critical vulnerability is found', () => {
      const scanner = new DependencyScanner([
        { package: 'express', affectedVersions: ['4.19.2'], severity: 'critical', cve: 'CVE-TEST-001' },
      ]);
      const result = scanner.scan({ express: '4.19.2' });
      expect(result.passed).toBe(false);
      expect(result.critical).toBe(1);
    });
  });

  describe('Compliance checks', () => {
    let checker;
    beforeEach(() => { checker = new ComplianceChecker(); });

    it('passes a fully compliant config', () => {
      const result = checker.check({
        httpsOnly: true,
        rateLimitEnabled: true,
        authRequired: true,
        allowedOrigins: ['https://app.example.com'],
        auditLogging: true,
      });
      expect(result.passed).toBe(true);
      expect(result.failedCount).toBe(0);
    });

    it('fails when rate limiting is disabled', () => {
      const result = checker.check({
        httpsOnly: true,
        rateLimitEnabled: false,
        authRequired: true,
        allowedOrigins: ['https://app.example.com'],
        auditLogging: true,
      });
      expect(result.passed).toBe(false);
      const failed = result.results.find((r) => r.name === 'rate-limiting');
      expect(failed.passed).toBe(false);
    });
  });

  describe('Pipeline orchestration', () => {
    it('generates a gate report with all stages', async () => {
      const pipeline = new SecurityPipeline({ requester: makeRequester(app) });

      pipeline.runSAST('const x = 1;', 'app.js');
      pipeline.runDependencyScan({ express: '4.19.2' });
      pipeline.runComplianceCheck({
        httpsOnly: true,
        rateLimitEnabled: true,
        authRequired: true,
        allowedOrigins: ['https://app.example.com'],
        auditLogging: true,
      });

      const report = pipeline.report();
      expect(report.stages).toBe(3);
      expect(report.gate).toBe(true);
      expect(report.timestamp).toBeDefined();
    });

    it('gate fails when any stage fails', () => {
      const pipeline = new SecurityPipeline();
      pipeline.runSAST('eval(x)', 'bad.js');
      const report = pipeline.report();
      expect(report.gate).toBe(false);
    });
  });
});
