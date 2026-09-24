/**
 * Tests for ISSUE-063: distributed migration advisory lock
 *
 * WARNING: Do NOT run these tests against a production database.
 * These tests use real PostgreSQL advisory lock primitives via mocked
 * pg.Client instances to verify serialization behaviour without a live DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock pg before importing migrate.js ────────────────────────────────────────
const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  return {
    default: {
      Client: vi.fn(() => ({
        connect: mockConnect,
        query: mockQuery,
        end: mockEnd,
      })),
    },
  };
});

// Mock execSync to avoid running prisma in tests
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({ execSync: mockExecSync }));

// Silence logger output in tests
vi.mock('../src/config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runMigrations, MIGRATION_LOCK_ID } from '../src/db/migrate.js';

describe('ISSUE-063: Migration advisory locking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
  });

  it('acquires advisory lock before running migrations', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockEnd.mockResolvedValue(undefined);

    await runMigrations();

    const lockCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_lock')
    );
    expect(lockCall).toBeDefined();
    expect(lockCall[1]).toEqual([MIGRATION_LOCK_ID]);
  });

  it('releases advisory lock after successful migrations', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockEnd.mockResolvedValue(undefined);

    await runMigrations();

    const unlockCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_unlock')
    );
    expect(unlockCall).toBeDefined();
    expect(unlockCall[1]).toEqual([MIGRATION_LOCK_ID]);
  });

  it('releases advisory lock even if execSync throws', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
    mockExecSync.mockImplementation(() => {
      throw new Error('prisma migrate deploy failed');
    });
    mockEnd.mockResolvedValue(undefined);

    await expect(runMigrations()).rejects.toThrow('prisma migrate deploy failed');

    const unlockCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_unlock')
    );
    expect(unlockCall).toBeDefined();
  });

  it('sets lock_timeout before acquiring the lock', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockEnd.mockResolvedValue(undefined);

    await runMigrations();

    const timeoutCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('lock_timeout')
    );
    const lockCallIdx = mockQuery.mock.calls.findIndex(
      (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_lock')
    );
    const timeoutCallIdx = mockQuery.mock.calls.findIndex(
      (c) => typeof c[0] === 'string' && c[0].includes('lock_timeout')
    );

    expect(timeoutCall).toBeDefined();
    // timeout must be set before lock is acquired
    expect(timeoutCallIdx).toBeLessThan(lockCallIdx);
  });

  it('skips migration when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;

    await runMigrations();

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('serializes two concurrent migrate() calls (second waits for first)', async () => {
    // Simulate two callers: the first holds the lock, the second waits.
    // We model this by tracking call order rather than actual blocking.
    const callOrder = [];

    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);

    let lockHeld = false;
    mockQuery.mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('pg_advisory_lock')) {
        // Simulate waiting while lock is held
        if (lockHeld) {
          await new Promise((r) => setTimeout(r, 10));
        }
        lockHeld = true;
        callOrder.push('lock-acquired');
      } else if (typeof sql === 'string' && sql.includes('pg_advisory_unlock')) {
        lockHeld = false;
        callOrder.push('lock-released');
      }
      return { rows: [] };
    });

    let execCount = 0;
    mockExecSync.mockImplementation(() => {
      execCount++;
      callOrder.push(`migrate-run-${execCount}`);
      return Buffer.from('');
    });

    // Run two migrations concurrently
    await Promise.all([runMigrations(), runMigrations()]);

    // Both should have run
    expect(execCount).toBe(2);

    // Each lock-acquired should be followed by lock-released before the next lock
    const lockAcquiredIndices = callOrder.reduce((acc, v, i) => {
      if (v === 'lock-acquired') acc.push(i);
      return acc;
    }, []);
    const lockReleasedIndices = callOrder.reduce((acc, v, i) => {
      if (v === 'lock-released') acc.push(i);
      return acc;
    }, []);

    expect(lockAcquiredIndices).toHaveLength(2);
    expect(lockReleasedIndices).toHaveLength(2);
    // First release must come before second acquire
    expect(lockReleasedIndices[0]).toBeLessThan(lockAcquiredIndices[1]);
  });
});
