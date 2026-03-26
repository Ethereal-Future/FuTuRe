import crypto from 'crypto';

/**
 * Mobile-specific security measures:
 * - Device fingerprint binding
 * - Certificate pinning hash registry
 * - Jailbreak/root detection flag handling
 */
class MobileSecurity {
  constructor() {
    // deviceId -> { fingerprint, pinnedCertHash, jailbroken, registeredAt }
    this.devices = new Map();
    // Suspicious event log
    this.alerts = [];
  }

  registerDevice(deviceId, fingerprint, pinnedCertHash) {
    this.devices.set(deviceId, {
      fingerprint,
      pinnedCertHash,
      jailbroken: false,
      registeredAt: new Date(),
    });
    return { registered: true };
  }

  validateRequest(deviceId, fingerprint, certHash) {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('Unknown device');

    if (device.fingerprint !== fingerprint) {
      this._alert(deviceId, 'fingerprint_mismatch');
      throw new Error('Device fingerprint mismatch');
    }

    if (device.pinnedCertHash && device.pinnedCertHash !== certHash) {
      this._alert(deviceId, 'cert_pin_failure');
      throw new Error('Certificate pinning failure');
    }

    if (device.jailbroken) {
      this._alert(deviceId, 'jailbroken_device');
      throw new Error('Jailbroken/rooted device not allowed');
    }

    return true;
  }

  flagJailbroken(deviceId) {
    const device = this.devices.get(deviceId);
    if (device) {
      device.jailbroken = true;
      this._alert(deviceId, 'jailbreak_reported');
    }
  }

  _alert(deviceId, type) {
    this.alerts.push({ deviceId, type, timestamp: new Date(), id: crypto.randomUUID() });
  }

  getAlerts(deviceId) {
    return deviceId ? this.alerts.filter(a => a.deviceId === deviceId) : this.alerts;
  }
}

export default new MobileSecurity();
