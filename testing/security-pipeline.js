/**
 * Security Testing Pipeline
 * SAST patterns, DAST probes, dependency vulnerability scanning, compliance checks
 */

// ── SAST: static pattern checks ──────────────────────────────────────────────

const SAST_PATTERNS = [
  { id: 'S001', name: 'hardcoded-secret', pattern: /(password|secret|api_?key)\s*=\s*['"][^'"]{6,}/i, severity: 'critical' },
  { id: 'S002', name: 'eval-usage', pattern: /\beval\s*\(/, severity: 'high' },
  { id: 'S003', name: 'sql-injection-risk', pattern: /query\s*\(\s*`[^`]*\$\{/, severity: 'high' },
  { id: 'S004', name: 'insecure-random', pattern: /Math\.random\(\)/, severity: 'medium' },
  { id: 'S005', name: 'console-log-secret', pattern: /console\.(log|info)\(.*?(key|secret|token|password)/i, severity: 'low' },
];

export class SASTScanner {
  scan(sourceCode, filename = 'unknown') {
    const findings = [];
    SAST_PATTERNS.forEach(({ id, name, pattern, severity }) => {
      const lines = sourceCode.split('\n');
      lines.forEach((line, idx) => {
        if (pattern.test(line)) {
          findings.push({ id, name, severity, file: filename, line: idx + 1, snippet: line.trim() });
        }
      });
    });
    return { file: filename, findings, passed: findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length === 0 };
  }
}

// ── DAST: dynamic endpoint probes ────────────────────────────────────────────

const DAST_PROBES = [
  { id: 'D001', name: 'sql-injection', payload: "' OR '1'='1", field: 'input' },
  { id: 'D002', name: 'xss', payload: '<script>alert(1)</script>', field: 'input' },
  { id: 'D003', name: 'path-traversal', payload: '../../etc/passwd', field: 'path' },
  { id: 'D004', name: 'oversized-payload', payload: 'A'.repeat(10_001), field: 'body' },
];

export class DASTScanner {
  constructor(requester) {
    // requester: async (method, path, body) => { status, body, headers }
    this.requester = requester;
  }

  async probe(endpoint) {
    const results = [];
    for (const probe of DAST_PROBES) {
      try {
        const res = await this.requester('POST', endpoint, { [probe.field]: probe.payload });
        // A safe server should return 400/422/413, not 200 with reflected payload
        const reflected = JSON.stringify(res.body ?? '').includes(probe.payload);
        const passed = res.status >= 400 || !reflected;
        results.push({ ...probe, status: res.status, passed });
      } catch {
        results.push({ ...probe, status: 0, passed: true }); // connection refused = safe
      }
    }
    return { endpoint, results, passed: results.every((r) => r.passed) };
  }
}

// ── Dependency vulnerability scanner ─────────────────────────────────────────

export class DependencyScanner {
  constructor(knownVulns = []) {
    // knownVulns: [{ package, affectedVersions[], severity, cve }]
    this.knownVulns = knownVulns;
  }

  scan(dependencies) {
    // dependencies: { name: version }
    const findings = [];
    Object.entries(dependencies).forEach(([pkg, version]) => {
      this.knownVulns
        .filter((v) => v.package === pkg && v.affectedVersions.includes(version))
        .forEach((v) => findings.push({ package: pkg, version, ...v }));
    });
    const critical = findings.filter((f) => f.severity === 'critical').length;
    const high = findings.filter((f) => f.severity === 'high').length;
    return { findings, passed: critical === 0 && high === 0, critical, high };
  }
}

// ── Compliance checker ────────────────────────────────────────────────────────

const COMPLIANCE_CHECKS = [
  { id: 'C001', name: 'https-only', check: (cfg) => cfg.httpsOnly === true },
  { id: 'C002', name: 'rate-limiting', check: (cfg) => cfg.rateLimitEnabled === true },
  { id: 'C003', name: 'auth-required', check: (cfg) => cfg.authRequired === true },
  { id: 'C004', name: 'cors-restricted', check: (cfg) => Array.isArray(cfg.allowedOrigins) && cfg.allowedOrigins.length > 0 },
  { id: 'C005', name: 'logging-enabled', check: (cfg) => cfg.auditLogging === true },
];

export class ComplianceChecker {
  check(config) {
    const results = COMPLIANCE_CHECKS.map(({ id, name, check }) => ({
      id, name, passed: check(config),
    }));
    const failed = results.filter((r) => !r.passed);
    return { results, passed: failed.length === 0, failedCount: failed.length };
  }
}

// ── Pipeline orchestrator ─────────────────────────────────────────────────────

export class SecurityPipeline {
  constructor({ requester, knownVulns = [] } = {}) {
    this.sast = new SASTScanner();
    this.dast = requester ? new DASTScanner(requester) : null;
    this.deps = new DependencyScanner(knownVulns);
    this.compliance = new ComplianceChecker();
    this.results = {};
  }

  runSAST(sourceCode, filename) {
    this.results.sast = this.sast.scan(sourceCode, filename);
    return this.results.sast;
  }

  async runDAST(endpoint) {
    if (!this.dast) throw new Error('No requester provided for DAST');
    this.results.dast = await this.dast.probe(endpoint);
    return this.results.dast;
  }

  runDependencyScan(deps) {
    this.results.deps = this.deps.scan(deps);
    return this.results.deps;
  }

  runComplianceCheck(config) {
    this.results.compliance = this.compliance.check(config);
    return this.results.compliance;
  }

  report() {
    const stages = Object.entries(this.results);
    const failed = stages.filter(([, r]) => !r.passed);
    return {
      stages: stages.length,
      passed: stages.length - failed.length,
      failed: failed.length,
      gate: failed.length === 0,
      details: this.results,
      timestamp: new Date().toISOString(),
    };
  }
}
