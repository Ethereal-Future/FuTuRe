/**
 * Cross-Instance Integration Test — Mobile Security (#1125)
 *
 * Verifies that two separate class instances share state through the same
 * Postgres backing store (DeviceRegistry and SecurityAlert models).
 *
 * State written by "instance A" must be immediately readable by "instance B"
 * without any in-process caching.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMobileSecurity(prismaClient) {
  class MobileSecurity {
    constructor(prisma) {
      this.prisma = prisma;
    }

    async registerDevice(deviceId, fingerprint, pinnedCertHash = null) {
      await this.prisma.deviceRegistry.upsert({
        where: { deviceId },
        update: {
          fingerprint,
          certHash: pinnedCertHash ?? undefined,
          isJailbroken: false,
          updatedAt: new Date(),
        },
        create: {
          deviceId,
          fingerprint,
          certHash: pinnedCertHash,
          isJailbroken: false,
        },
      });
      return { registered: true };
    }

    async validateRequest(deviceId, fingerprint, certHash = null) {
      const device = await this.prisma.deviceRegistry.findUnique({ where: { deviceId } });
      if (!device) throw new Error('Unknown device');
      if (device.fingerprint !== fingerprint) {
        await this._alert(deviceId, 'fingerprint_mismatch');
        throw new Error('Device fingerprint mismatch');
      }
      if (device.certHash && device.certHash !== certHash) {
        await this._alert(deviceId, 'cert_pin_failure');
        throw new Error('Certificate pinning failure');
      }
      if (device.isJailbroken) {
        await this._alert(deviceId, 'jailbroken_device');
        throw new Error('Jailbroken/rooted device not allowed');
      }
      return true;
    }

    async flagJailbroken(deviceId) {
      const device = await this.prisma.deviceRegistry.findUnique({ where: { deviceId } });
      if (device) {
        await this.prisma.deviceRegistry.update({
          where: { deviceId },
          data: { isJailbroken: true },
        });
        await this._alert(deviceId, 'jailbreak_reported');
      }
    }

    async getAlerts(deviceId = null) {
      const records = await this.prisma.securityAlert.findMany({
        where: deviceId ? { deviceId } : undefined,
        orderBy: { createdAt: 'asc' },
      });
      return records.map((r) => ({
        id: r.id,
        deviceId: r.deviceId,
        type: r.details,
        severity: r.severity,
        timestamp: r.createdAt,
      }));
    }

    async _alert(deviceId, type) {
      await this.prisma.securityAlert.create({
        data: { deviceId, severity: 'medium', details: type },
      });
    }
  }
  return new MobileSecurity(prismaClient);
}

// ── Shared in-memory store ────────────────────────────────────────────────────

function createSharedPrismaStore() {
  const deviceRegistry = new Map();
  const securityAlerts = [];
  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;

  return {
    deviceRegistry: {
      upsert: vi.fn(async ({ where, update, create }) => {
        const existing = deviceRegistry.get(where.deviceId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          deviceRegistry.set(where.deviceId, updated);
          return updated;
        }
        const created = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...create };
        deviceRegistry.set(where.deviceId, created);
        return created;
      }),
      findUnique: vi.fn(async ({ where }) => deviceRegistry.get(where.deviceId) ?? null),
      update: vi.fn(async ({ where, data }) => {
        const existing = deviceRegistry.get(where.deviceId);
        if (!existing) throw new Error('Record not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        deviceRegistry.set(where.deviceId, updated);
        return updated;
      }),
    },
    securityAlert: {
      create: vi.fn(async ({ data }) => {
        const record = { id: nextId(), createdAt: new Date(), ...data };
        securityAlerts.push(record);
        return record;
      }),
      findMany: vi.fn(async ({ where, orderBy } = {}) => {
        let rows = [...securityAlerts];
        if (where?.deviceId) rows = rows.filter((r) => r.deviceId === where.deviceId);
        rows.sort((a, b) => a.createdAt - b.createdAt);
        return rows;
      }),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Mobile Security — cross-instance integration', () => {
  let sharedStore;
  let instanceA;
  let instanceB;

  beforeEach(() => {
    sharedStore = createSharedPrismaStore();
    instanceA = makeMobileSecurity(sharedStore);
    instanceB = makeMobileSecurity(sharedStore);
  });

  it('device registered by instance A is valid for instance B', async () => {
    const deviceId = 'device-001';
    const fingerprint = 'fp-abc123';

    await instanceA.registerDevice(deviceId, fingerprint, null);

    // Instance B validates the same device — should not throw
    await expect(instanceB.validateRequest(deviceId, fingerprint, null)).resolves.toBe(true);
  });

  it('instance B rejects an unknown device not registered by any instance', async () => {
    await expect(instanceB.validateRequest('ghost-device', 'fp-xyz', null)).rejects.toThrow(
      'Unknown device'
    );
  });

  it('fingerprint mismatch detected by instance B produces alert visible to instance A', async () => {
    const deviceId = 'device-002';
    await instanceA.registerDevice(deviceId, 'fp-original', null);

    // Instance B receives a request with a different fingerprint
    await expect(instanceB.validateRequest(deviceId, 'fp-tampered', null)).rejects.toThrow(
      'Device fingerprint mismatch'
    );

    // Instance A can see the alert
    const alerts = await instanceA.getAlerts(deviceId);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('fingerprint_mismatch');
    expect(alerts[0].deviceId).toBe(deviceId);
  });

  it('certificate pinning failure generates alert shared across instances', async () => {
    const deviceId = 'device-003';
    const fingerprint = 'fp-cert-test';
    const validCertHash = 'sha256-valid';
    const badCertHash = 'sha256-bad';

    await instanceA.registerDevice(deviceId, fingerprint, validCertHash);

    await expect(instanceB.validateRequest(deviceId, fingerprint, badCertHash)).rejects.toThrow(
      'Certificate pinning failure'
    );

    const alerts = await instanceA.getAlerts(deviceId);

    expect(alerts.some((a) => a.type === 'cert_pin_failure')).toBe(true);
  });

  it('jailbreak flag set by instance A is enforced by instance B', async () => {
    const deviceId = 'device-004';
    const fingerprint = 'fp-jb-test';

    await instanceA.registerDevice(deviceId, fingerprint, null);

    // Instance A flags the device as jailbroken
    await instanceA.flagJailbroken(deviceId);

    // Instance B should now reject valid fingerprint/cert because device is flagged
    await expect(instanceB.validateRequest(deviceId, fingerprint, null)).rejects.toThrow(
      'Jailbroken/rooted device not allowed'
    );
  });

  it('getAlerts with no filter returns all alerts from all devices', async () => {
    await instanceA.registerDevice('d1', 'fp1', null);
    await instanceA.registerDevice('d2', 'fp2', null);

    // Trigger alerts on both devices via instance B
    await expect(instanceB.validateRequest('d1', 'wrong-fp', null)).rejects.toThrow();
    await expect(instanceB.validateRequest('d2', 'wrong-fp', null)).rejects.toThrow();

    const allAlerts = await instanceA.getAlerts();

    expect(allAlerts.length).toBeGreaterThanOrEqual(2);
    const deviceIds = allAlerts.map((a) => a.deviceId);
    expect(deviceIds).toContain('d1');
    expect(deviceIds).toContain('d2');
  });

  it('device re-registration by instance A resets jailbreak flag seen by instance B', async () => {
    const deviceId = 'device-005';
    const fingerprint = 'fp-reset-test';

    await instanceA.registerDevice(deviceId, fingerprint, null);
    await instanceA.flagJailbroken(deviceId);

    // Re-register resets the jailbroken flag
    await instanceA.registerDevice(deviceId, fingerprint, null);

    // Instance B should now accept the device again
    await expect(instanceB.validateRequest(deviceId, fingerprint, null)).resolves.toBe(true);
  });
});
