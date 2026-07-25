/**
 * Secrets Scanner
 * 
 * Scans codebase for accidentally committed secrets, API keys, and credentials
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

// Patterns to detect secrets
const SECRET_PATTERNS = [
  {
    name: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'HIGH',
  },
  {
    name: 'AWS Secret Key',
    pattern: /aws_secret_access_key\s*=\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi,
    severity: 'HIGH',
  },
  {
    name: 'GitHub Token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
    severity: 'HIGH',
  },
  {
    name: 'GitHub Fine-grained PAT',
    pattern: /github_pat_[A-Za-z0-9_]{22,}/g,
    severity: 'HIGH',
  },
  {
    name: 'Stripe API Key',
    pattern: /sk_live_[0-9a-zA-Z]{24,}/g,
    severity: 'HIGH',
  },
  {
    name: 'Stripe Test Key',
    pattern: /sk_test_[0-9a-zA-Z]{24,}/g,
    severity: 'MEDIUM',
  },
  {
    name: 'Twilio API Key',
    pattern: /SK[0-9a-fA-F]{32}/g,
    severity: 'HIGH',
  },
  {
    name: 'SendGrid API Key',
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
    severity: 'HIGH',
  },
  {
    name: 'Heroku API Key',
    pattern: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
    severity: 'MEDIUM',
  },
  {
    name: 'Slack Token',
    pattern: /xox[baprs]-[0-9a-zA-Z]{10,48}/g,
    severity: 'HIGH',
  },
  {
    name: 'Slack Webhook',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
    severity: 'MEDIUM',
  },
  {
    name: 'Private Key',
    pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g,
    severity: 'CRITICAL',
  },
  {
    name: 'JWT Token',
    pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
    severity: 'MEDIUM',
  },
  {
    name: 'Database URL',
    pattern: /(?:postgres|mysql|mongodb):\/\/[^:]+:[^@]+@[^/]+\/[^?]+/gi,
    severity: 'HIGH',
  },
  {
    name: 'Stellar Secret Key',
    pattern: /S[A-Z2-7]{55}/g,
    severity: 'CRITICAL',
  },
  {
    name: 'Environment Variable with Secret',
    pattern: /(?:SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL)\s*=\s*['"]?[^\s'"]{8,}['"]?/gi,
    severity: 'HIGH',
  },
];

// Directories to exclude from scanning
const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'test-reports',
  'reports',
  '__snapshots__',
  'migration-logs',
];

// File extensions to scan
const SCAN_EXTENSIONS = [
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.json',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.yml',
  '.yaml',
  '.md',
  '.txt',
  '.config',
  '.conf',
];

async function scanFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const findings = [];

    for (const { name, pattern, severity } of SECRET_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Get line number
          const lines = content.split('\n');
          const lineNumber = lines.findIndex(line => line.includes(match)) + 1;

          findings.push({
            file: filePath,
            line: lineNumber,
            secret: name,
            severity,
            match: match.substring(0, 20) + '...',
          });
        }
      }
    }

    return findings;
  } catch (error) {
    console.error(`Error scanning ${filePath}:`, error.message);
    return [];
  }
}

async function scanDirectory(dirPath) {
  const findings = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.includes(entry.name)) {
          const subFindings = await scanDirectory(fullPath);
          findings.push(...subFindings);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SCAN_EXTENSIONS.includes(ext)) {
          const fileFindings = await scanFile(fullPath);
          findings.push(...fileFindings);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error.message);
  }

  return findings;
}

async function generateReport(findings) {
  const reportDir = path.join(PROJECT_ROOT, 'security', 'reports');
  await fs.mkdir(reportDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    scanType: 'secrets',
    summary: {
      total: findings.length,
      critical: findings.filter(f => f.severity === 'CRITICAL').length,
      high: findings.filter(f => f.severity === 'HIGH').length,
      medium: findings.filter(f => f.severity === 'MEDIUM').length,
      low: findings.filter(f => f.severity === 'LOW').length,
    },
    findings: findings.map(f => ({
      file: path.relative(PROJECT_ROOT, f.file),
      line: f.line,
      secret: f.secret,
      severity: f.severity,
      match: f.match,
    })),
  };

  const reportPath = path.join(reportDir, 'secrets-scan.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  return report;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Secrets Scanner');
  console.log('='.repeat(60));
  console.log(`Scanning: ${PROJECT_ROOT}`);
  console.log('');

  const findings = await scanDirectory(PROJECT_ROOT);
  const report = await generateReport(findings);

  console.log('');
  console.log('='.repeat(60));
  console.log('Scan Results:');
  console.log('='.repeat(60));
  console.log(`Total findings: ${report.summary.total}`);
  console.log(`Critical: ${report.summary.critical}`);
  console.log(`High: ${report.summary.high}`);
  console.log(`Medium: ${report.summary.medium}`);
  console.log(`Low: ${report.summary.low}`);
  console.log('');

  if (report.summary.critical > 0 || report.summary.high > 0) {
    console.log('⚠️  CRITICAL/HIGH severity secrets found!');
    console.log('');
    console.log('Findings:');
    report.findings
      .filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')
      .forEach(f => {
        console.log(`  - ${f.secret} (${f.severity})`);
        console.log(`    File: ${f.file}:${f.line}`);
        console.log(`    Match: ${f.match}`);
        console.log('');
      });
    
    process.exit(1);
  } else if (report.summary.total > 0) {
    console.log('⚠️  Potential secrets found. Please review.');
    console.log('');
    console.log('Findings:');
    report.findings.forEach(f => {
      console.log(`  - ${f.secret} (${f.severity})`);
      console.log(`    File: ${f.file}:${f.line}`);
      console.log('');
    });
    
    process.exit(0);
  } else {
    console.log('✅ No secrets found!');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Scan failed:', error);
  process.exit(1);
});
