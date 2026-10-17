/**
 * Mobile Security — device fingerprint binding, certificate-pinning hash
 * registry, and server-verified hardware attestation backed by Postgres via
 * Prisma.
 *
 * Replaces the old in-process Map (this.devices) and alert array
 * (this.alerts) that were invisible to other process instances.
 *
 * Migrated as part of Issue #1125. Hardware attestation added in #1382:
 * device integrity is no longer taken from client-sent `isJailbroken` /
 * `isRooted` booleans. A device is only considered trustworthy after a
 * Google Play Integrity or Apple App Attest verification performed here on
 * the server, and high-risk operations require fresh attestation evidence.
 */
import prisma from '../db/client.js';
import {
  AttestationError,
  issueAttestationNonce,
  takeAttestationNonce,
  verifyPlayIntegrityToken,
  verifyAppAttestation,
  verifyAppAssertion,
} from './attestation.js';

export const PLATFORM_ANDROID = 'android';
export const PLATFORM_IOS = 'ios';

class MobileSecurity {
  /**
   * Register (or update) a device fingerprint and optional pinned-cert hash.
   *
   * The jailbreak flag is never reset here — it is only cleared by a
   * successful server-side attestation. Changing the fingerprint of an
   * existing device discards its previous attestation.
   *
   * @param {string} deviceId
   * @param {string} fingerprint
   * @param {string|null} [pinnedCertHash]
   * @returns {Promise<{ registered: boolean }>}
   */
  async registerDevice(deviceId, fingerprint, pinnedCertHash = null) {
    const existing = await prisma.deviceRegistry.findUnique({ where: { deviceId } });
    if (existing) {
      const fingerprintChanged = existing.fingerprint !== fingerprint;
      await prisma.deviceRegistry.update({
        where: { deviceId },
        data: {
          fingerprint,
          certHash: pinnedCertHash ?? undefined,
          ...(fingerprintChanged ? resetAttestation() : {}),
          updatedAt: new Date(),
        },
      });
      if (fingerprintChanged) await this._alert(deviceId, 'fingerprint_changed_attestation_reset');
    } else {
      await prisma.deviceRegistry.create({
        data: {
          deviceId,
          fingerprint,
          certHash: pinnedCertHash,
        },
      });
    }
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
   * Record a client self-report of jailbreak/root. A self-report can only
   * ever *restrict* a device; it can never mark one as clean.
   * @param {string} deviceId
   */
  async flagJailbroken(deviceId) {
    const device = await prisma.deviceRegistry.findUnique({ where: { deviceId } });
    if (device) {
      await prisma.deviceRegistry.update({
        where: { deviceId },
        data: { isJailbroken: true, ...resetAttestation() },
      });
      await this._alert(deviceId, 'jailbreak_reported');
    }
  }

  // ── Hardware attestation (#1382) ─────────────────────────────────────────

  /** Issue a single-use nonce the app must bind into its attestation evidence. */
  async createAttestationChallenge(deviceId) {
    const device = await prisma.deviceRegistry.findUnique({ where: { deviceId } });
    if (!device) throw new AttestationError('Unknown device', 'UNKNOWN_DEVICE', 404);
    return issueAttestationNonce(deviceId);
  }

  /**
   * Verify platform attestation evidence and record the result.
   *
   * @param {string} deviceId
   * @param {{ platform: 'android'|'ios', integrityToken?: string,
   *           keyId?: string, attestationObject?: string }} evidence
   *   Any client-supplied integrity booleans (isJailbroken, isRooted, ...) are ignored.
   * @returns {Promise<{ attested: true, platform: string, verdict: string }>}
   */
  async attestDevice(deviceId, evidence = {}) {
    const device = await prisma.deviceRegistry.findUnique({ where: { deviceId } });
    if (!device) throw new AttestationError('Unknown device', 'UNKNOWN_DEVICE', 404);

    const nonce = await takeAttestationNonce(deviceId);
    try {
      if (evidence.platform === PLATFORM_ANDROID) {
        const result = verifyPlayIntegrityToken(evidence.integrityToken, { expectedNonce: nonce });
        await prisma.deviceRegistry.update({
          where: { deviceId },
          data: {
            ...resetAttestation(),
            attestationPlatform: PLATFORM_ANDROID,
            attestationVerdict: result.verdict,
            attestedAt: new Date(),
            isJailbroken: false,
          },
        });
        return { attested: true, platform: PLATFORM_ANDROID, verdict: result.verdict };
      }

      if (evidence.platform === PLATFORM_IOS) {
        const result = verifyAppAttestation({
          keyId: evidence.keyId,
          attestationObject: evidence.attestationObject,
          challenge: nonce,
        });
        const verdict = 'APP_ATTEST_VERIFIED';
        await prisma.deviceRegistry.update({
          where: { deviceId },
          data: {
            attestationPlatform: PLATFORM_IOS,
            attestationVerdict: verdict,
            attestedAt: new Date(),
            appAttestKeyId: result.keyId,
            appAttestPublicKey: result.publicKeyPem,
            appAttestCounter: BigInt(result.counter),
            isJailbroken: false,
          },
        });
        return { attested: true, platform: PLATFORM_IOS, verdict };
      }

      throw new AttestationError('platform must be "android" or "ios"', 'ATTESTATION_INVALID', 400);
    } catch (err) {
      await this._recordAttestationFailure(deviceId, err);
      throw err;
    }
  }

  /**
   * Require fresh hardware attestation evidence for a high-risk operation
   * (wallet creation, large transfers, offline-queue submission, ...).
   *
   * @param {string} deviceId
   * @param {{ integrityToken?: string, assertion?: string, clientData?: string }} proof
   *   Android: a new Play Integrity token over the current nonce.
   *   iOS: an App Attest assertion whose clientData.challenge is the current nonce.
   * @returns {Promise<{ verified: true, platform: string }>}
   */
  async verifyHighRiskOperation(deviceId, proof = {}) {
    const device = await prisma.deviceRegistry.findUnique({ where: { deviceId } });
    if (!device) throw new AttestationError('Unknown device', 'UNKNOWN_DEVICE', 404);
    if (device.isJailbroken) {
      await this._alert(deviceId, 'jailbroken_device');
      throw new AttestationError('Jailbroken/rooted device not allowed', 'DEVICE_INTEGRITY_FAILED');
    }
    if (!device.attestedAt || !device.attestationPlatform) {
      throw new AttestationError(
        'Device has not completed hardware attestation',
        'ATTESTATION_REQUIRED',
      );
    }

    const nonce = await takeAttestationNonce(deviceId);
    try {
      if (device.attestationPlatform === PLATFORM_ANDROID) {
        const result = verifyPlayIntegrityToken(proof.integrityToken, { expectedNonce: nonce });
        await prisma.deviceRegistry.update({
          where: { deviceId },
          data: { attestationVerdict: result.verdict, attestedAt: new Date() },
        });
        return { verified: true, platform: PLATFORM_ANDROID };
      }

      const previousCounter = Number(device.appAttestCounter ?? 0);
      const { counter } = verifyAppAssertion({
        assertion: proof.assertion,
        clientData: proof.clientData,
        expectedChallenge: nonce,
        publicKeyPem: device.appAttestPublicKey,
        previousCounter,
      });
      // Compare-and-set so two racing assertions can't both advance from the same counter.
      const updated = await prisma.deviceRegistry.updateMany({
        where: { deviceId, appAttestCounter: { lt: BigInt(counter) } },
        data: { appAttestCounter: BigInt(counter), attestedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new AttestationError('App Attest counter did not increase', 'ATTESTATION_REPLAY');
      }
      return { verified: true, platform: PLATFORM_IOS };
    } catch (err) {
      await this._recordAttestationFailure(deviceId, err);
      throw err;
    }
  }

  /**
   * Express middleware enforcing fresh hardware attestation. Reads the device
   * from `req.mobile.deviceId` (set by mobile auth) and the evidence from the
   * `X-Play-Integrity-Token` header (Android) or the `X-App-Attest-Assertion`
   * + `X-App-Attest-Client-Data` headers (iOS).
   */
  requireHardwareAttestation() {
    return async (req, res, next) => {
      const deviceId = req.mobile?.deviceId ?? req.headers['x-device-id'];
      try {
        await this.verifyHighRiskOperation(deviceId, {
          integrityToken: req.headers['x-play-integrity-token'],
          assertion: req.headers['x-app-attest-assertion'],
          clientData: req.headers['x-app-attest-client-data'],
        });
        next();
      } catch (err) {
        const status = err instanceof AttestationError ? err.status : 403;
        res.status(status).json({ error: err.message, code: err.code ?? 'ATTESTATION_FAILED' });
      }
    };
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

  async _recordAttestationFailure(deviceId, err) {
    if (err?.code === 'DEVICE_INTEGRITY_FAILED') {
      await prisma.deviceRegistry.update({
        where: { deviceId },
        data: { isJailbroken: true, ...resetAttestation() },
      });
      await this._alert(deviceId, 'device_integrity_failed', 'high');
    } else if (err?.code !== 'ATTESTATION_NOT_CONFIGURED') {
      await this._alert(deviceId, `attestation_failed:${err?.code ?? 'unknown'}`);
    }
  }

  async _alert(deviceId, type, severity = 'medium') {
    await prisma.securityAlert.create({
      data: {
        deviceId,
        severity,
        details: type,
      },
    });
  }
}

function resetAttestation() {
  return {
    attestationPlatform: null,
    attestationVerdict: null,
    attestedAt: null,
    appAttestKeyId: null,
    appAttestPublicKey: null,
    appAttestCounter: 0n,
  };
}

export default new MobileSecurity();
