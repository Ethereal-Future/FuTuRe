/**
 * Tests for contract registry: versioning and breaking change detection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { publishVersion, listVersions, detectBreakingChanges } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACTS_DIR = path.resolve(__dirname, './pacts');
const LOGS_DIR = path.resolve(__dirname, './logs');

const CONSUMER = 'Test-Consumer';
const PROVIDER = 'Test-Provider';

const samplePact = (description, status = 200) => ({
  consumer: { name: CONSUMER },
  provider: { name: PROVIDER },
  interactions: [
    {
      description,
      request: { method: 'GET', path: '/test' },
      response: { status },
    },
  ],
});

function writePact(pact) {
  fs.mkdirSync(PACTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PACTS_DIR, `${CONSUMER}-${PROVIDER}.json`),
    JSON.stringify(pact, null, 2)
  );
}

function cleanLogs() {
  if (!fs.existsSync(LOGS_DIR)) return;
  fs.readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith(`${CONSUMER}-${PROVIDER}`))
    .forEach((f) => fs.unlinkSync(path.join(LOGS_DIR, f)));
}

beforeEach(cleanLogs);
afterEach(cleanLogs);

describe('Contract Registry', () => {
  it('publishes a version and assigns incrementing numbers', () => {
    writePact(samplePact('get test'));
    const v1 = publishVersion(CONSUMER, PROVIDER);
    const v2 = publishVersion(CONSUMER, PROVIDER);
    expect(v1).toBe(1);
    expect(v2).toBe(2);
  });

  it('lists published versions in order', () => {
    writePact(samplePact('get test'));
    publishVersion(CONSUMER, PROVIDER);
    publishVersion(CONSUMER, PROVIDER);
    const versions = listVersions(CONSUMER, PROVIDER);
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(1);
    expect(versions[1].version).toBe(2);
  });

  it('detects no breaking changes when interactions are identical', () => {
    writePact(samplePact('get test'));
    publishVersion(CONSUMER, PROVIDER);
    publishVersion(CONSUMER, PROVIDER);
    const breaks = detectBreakingChanges(CONSUMER, PROVIDER, 1, 2);
    expect(breaks).toHaveLength(0);
  });

  it('detects a removed interaction as a breaking change', () => {
    writePact(samplePact('get test'));
    publishVersion(CONSUMER, PROVIDER);

    // v2 removes the interaction
    writePact({ consumer: { name: CONSUMER }, provider: { name: PROVIDER }, interactions: [] });
    publishVersion(CONSUMER, PROVIDER);

    const breaks = detectBreakingChanges(CONSUMER, PROVIDER, 1, 2);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatch(/REMOVED/);
  });

  it('detects a status code change as a breaking change', () => {
    writePact(samplePact('get test', 200));
    publishVersion(CONSUMER, PROVIDER);

    writePact(samplePact('get test', 404));
    publishVersion(CONSUMER, PROVIDER);

    const breaks = detectBreakingChanges(CONSUMER, PROVIDER, 1, 2);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatch(/STATUS CHANGED/);
  });
});
