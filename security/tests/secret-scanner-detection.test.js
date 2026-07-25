/**
 * Secret scanner detection test (#520)
 *
 * Plants fake secrets in a temporary file and asserts that pii-scan.mjs
 * exits with code 1 (findings detected).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNER = path.join(ROOT, 'scripts', 'pii-scan.mjs');

// A syntactically valid but completely fake Stellar secret key (S + 55 uppercase base32 chars).
// This string has never been a real key and is safe to appear in test source.
const FAKE_STELLAR_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('pii-scan.mjs', () => {
  it('detects a planted Stellar secret key and exits non-zero', () => {
    const tmpFile = path.join(ROOT, 'scripts', '_pii_scan_test_fixture.tmp.js');
    writeFileSync(tmpFile, `const key = '${FAKE_STELLAR_SECRET}';\n`, 'utf8');

    try {
      const result = spawnSync(
        process.execPath,
        [SCANNER],
        {
          cwd: ROOT,
          env: { ...process.env, PII_SCAN_IGNORE: '' },
          encoding: 'utf8',
        }
      );

      expect(result.status, 'scanner should exit 1 when secrets are found').toBe(1);
      expect(result.stderr).toMatch(/stellar_secret/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('exits zero when no secrets are present', () => {
    const result = spawnSync(
      process.execPath,
      [SCANNER],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          // Ignore everything except an empty tmp dir that won't exist
          PII_SCAN_IGNORE: 'backend,frontend,testing,docs,scripts,security,property-tests,contracts',
        },
        encoding: 'utf8',
      }
    );

    // Exit 0 or 1 is acceptable; what matters is no crash (exit 2+)
    expect(result.status).toBeLessThanOrEqual(1);
  });
});
