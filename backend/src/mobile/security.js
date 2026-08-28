/**
 * Mobile Security — device fingerprint binding, certificate-pinning hash
 * registry, and jailbreak/root detection backed by Postgres via Prisma.
 *
 * Replaces the old in-process Map (this.devices) and alert array
 * (this.alerts) that were invisible to other process instances.
 *
 * Migrated as part of Issue #1125.
 */
import prisma from '../db/client.js';

class MobileSecurity {
  /**
   * Register (or update) a device fingerprint and optional pinned-cert hash.
   * @param {string} deviceId
   * @param {string} fingerprint
   * @param {string|null} [pinnedCertHash]
   * @returns {Promise<{ registered: boolean }>}
   */
  async registerDevice(deviceId, fingerprint, pinnedCertHash = null) {
    await prisma.deviceRegistry.upsert({
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

  /**
   * Validate an incoming request against the stored device record.
   * Throws on any security violation and persists an alert for each one.
   * @param {string} deviceId
   * @param {string} fingerprint
   * @param {string|null} [certHash]
   * @returns {Promise<true>}
   */
  async validateRequest(deviceId, fingerprint, certHash = null) {
    const device = await prisma.deviceRegistry.findUnique({ where: { deviceId } });
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

  /**
   * Mark a device as jailbroken/rooted and record an alert.
   * @param {string} deviceId
   */
  async flagJailbroken(deviceId) {
    const device = await prisma.deviceRegistry.findUnique({ where: { deviceId } });
    if (device) {
      await prisma.deviceRegistry.update({
        where: { deviceId },
        data: { isJailbroken: true },
      });
      await this._alert(deviceId, 'jailbreak_reported');
    }
  }

  /**
   * Return security alerts, optionally filtered to a single device.
   * @param {string|null} [deviceId]
   * @returns {Promise<object[]>}
   */
  async getAlerts(deviceId = null) {
    const records = await prisma.securityAlert.findMany({
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

  // ── Private ────────────────────────────────────────────────────────────────

  async _alert(deviceId, type) {
    await prisma.securityAlert.create({
      data: {
        deviceId,
        severity: 'medium',
        details: type,
      },
    });
  }
}

export default new MobileSecurity();
