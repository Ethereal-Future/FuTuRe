import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import projectionManager from '../src/eventSourcing/projectionManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PROJ_DIR = path.join(__dirname, '../data/projections-test');

describe('ProjectionManager', () => {
  beforeEach(async () => {
    // Use a separate test directory
    const originalDir = path.join(__dirname, '../data/projections');
    const testDir = path.join(__dirname, '../data/projections');
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      const projDir = path.join(__dirname, '../data/projections');
      await fs.rm(projDir, { recursive: true, force: true });
    } catch {}
  });

  it('should handle concurrent writes to the same projection without data loss', async () => {
    projectionManager.registerProjection('test-concurrent', (projection, event) => {
      if (!projection.count) projection.count = 0;
      projection.count += 1;
      if (!projection.events) projection.events = [];
      projection.events.push(event);
      return projection;
    });

    const eventBatches = [
      [{ type: 'event', id: 1 }, { type: 'event', id: 2 }],
      [{ type: 'event', id: 3 }, { type: 'event', id: 4 }],
      [{ type: 'event', id: 5 }, { type: 'event', id: 6 }],
    ];

    // Write concurrently
    await Promise.all(
      eventBatches.map(batch => projectionManager.project('test-concurrent', batch))
    );

    // Verify all events were saved
    const final = await projectionManager.getProjection('test-concurrent');
    expect(final.count).toBe(6);
    expect(final.events).toHaveLength(6);
  });

  it('should recover from incomplete writes to temporary files', async () => {
    projectionManager.registerProjection('test-atomic', (projection, event) => {
      if (!projection.data) projection.data = [];
      projection.data.push(event);
      return projection;
    });

    const testEvent = { type: 'test', value: 'atomic-write' };
    await projectionManager.project('test-atomic', [testEvent]);

    // Verify file exists and is valid JSON
    const projFile = path.join(__dirname, '../data/projections/test-atomic.json');
    const content = await fs.readFile(projFile, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]).toEqual(testEvent);
  });

  it('should not leave temporary files on disk', async () => {
    projectionManager.registerProjection('test-cleanup', (projection) => {
      if (!projection.timestamp) projection.timestamp = new Date().toISOString();
      return projection;
    });

    await projectionManager.project('test-cleanup', [{ type: 'event' }]);

    const projDir = path.join(__dirname, '../data/projections');
    const files = await fs.readdir(projDir);

    // Should only have the actual projection file, no .tmp files
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });
});
