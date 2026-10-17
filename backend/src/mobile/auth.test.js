/**
 * Transaction-bound biometric signatures (#1383).
 *
 * A P-256 key pair stands in for the Secure Enclave / Android Keystore key;
 * the "device" signs the exact payload returned by the challenge endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('./sessions.js', () => ({
  default: { create: vi.fn(async () => 'session-id') },
}));
vi.mock('../db/client.js', () => ({ default: {} }));

delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const {
  default: mobileAuth,
  buildBiometricSigningPayload,
  BIOMETRIC_CHALLENGE_TTL_SECONDS,
} = await import('./auth.js');

const USER = 'user-1';
const DEVICE = 'device-1';

const txA = {
  transactionHash: 'a'.repeat(64),
  amount: '25.5000000',
  destination: 'GDESTINATIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};
const txB = {
  transactionHash: 'b'.repeat(64),
  amount: '9000.0000000',
  destination: 'GATTACKERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
};

function newDeviceKey() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

function sign(privateKey, payload) {
  return crypto.sign('sha256', Buffer.from(payload), privateKey).toString('base64');
}

let deviceKey;

const challengeFor = (tx) => mobileAuth.createTransactionChallenge(USER, DEVICE, tx);
const verify = (...args) => mobileAuth.verifyTransactionSignature(...args);

beforeEach(() => {
  mobileAuth.biometricKeys.clear();
  deviceKey = newDeviceKey();
  mobileAuth.registerBiometric(
    USER,
    DEVICE,
    deviceKey.publicKey.export({ type: 'spki', format: 'pem' }),
  );
});

describe('transaction-bound biometric challenges (#1383)', () => {
  it('binds the challenge to transactionHash, amount, destination and timestamp', async () => {
    const { challenge, payload } = await challengeFor(txA);

    expect(challenge).toMatchObject({ ...txA, userId: USER, deviceId: DEVICE });
    expect(typeof challenge.timestamp).toBe('number');
    expect(payload).toBe(buildBiometricSigningPayload(challenge));
    expect(JSON.parse(payload)).toMatchObject(txA);
  });

  it('authorizes the exact transaction the signature was produced for', async () => {
    const { challengeId, payload } = await challengeFor(txA);

    const result = await verify(challengeId, sign(deviceKey.privateKey, payload), txA, {
      userId: USER,
      deviceId: DEVICE,
    });

    expect(result).toMatchObject({ authorized: true, ...txA, userId: USER, deviceId: DEVICE });
    expect(result).not.toHaveProperty('token');
  });

  it('rejects a valid signature for Transaction A when used to authorize Transaction B', async () => {
    const { challengeId, payload } = await challengeFor(txA);
    const signatureForA = sign(deviceKey.privateKey, payload);

    await expect(verify(challengeId, signatureForA, txB)).rejects.toMatchObject({
      code: 'TRANSACTION_MISMATCH',
    });
  });

  it('rejects a signature for Transaction A presented against a challenge for Transaction B', async () => {
    const a = await challengeFor(txA);
    const b = await challengeFor(txB);
    const signatureForA = sign(deviceKey.privateKey, a.payload);

    await expect(verify(b.challengeId, signatureForA, txB)).rejects.toMatchObject({
      code: 'SIGNATURE_INVALID',
    });
  });

  it('rejects a change to any single bound field (amount or destination)', async () => {
    for (const tampered of [
      { ...txA, amount: '2550.0000000' },
      { ...txA, destination: txB.destination },
    ]) {
      const { challengeId, payload } = await challengeFor(txA);
      const signature = sign(deviceKey.privateKey, payload);
      await expect(verify(challengeId, signature, tampered)).rejects.toMatchObject({
        code: 'TRANSACTION_MISMATCH',
      });
    }
  });

  it('consumes the challenge on use so a signature cannot be replayed', async () => {
    const { challengeId, payload } = await challengeFor(txA);
    const signature = sign(deviceKey.privateKey, payload);

    await expect(verify(challengeId, signature, txA)).resolves.toMatchObject({
      authorized: true,
    });
    await expect(verify(challengeId, signature, txA)).rejects.toMatchObject({
      code: 'CHALLENGE_INVALID',
    });
  });

  it('consumes the challenge even when verification fails, preventing retries', async () => {
    const { challengeId, payload } = await challengeFor(txA);
    const signature = sign(deviceKey.privateKey, payload);

    await expect(verify(challengeId, signature, txB)).rejects.toMatchObject({
      code: 'TRANSACTION_MISMATCH',
    });
    await expect(verify(challengeId, signature, txA)).rejects.toMatchObject({
      code: 'CHALLENGE_INVALID',
    });
  });

  it('rejects signatures from a key other than the registered device key', async () => {
    const { challengeId, payload } = await challengeFor(txA);
    const signature = sign(newDeviceKey().privateKey, payload);

    await expect(verify(challengeId, signature, txA)).rejects.toMatchObject({
      code: 'SIGNATURE_INVALID',
    });
  });

  it('rejects a challenge presented by a different authenticated user or device', async () => {
    const { challengeId, payload } = await challengeFor(txA);
    const signature = sign(deviceKey.privateKey, payload);

    await expect(
      verify(challengeId, signature, txA, { userId: USER, deviceId: 'device-2' }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_MISMATCH' });
  });

  it('rejects expired challenges', async () => {
    vi.useFakeTimers();
    try {
      const { challengeId, payload } = await challengeFor(txA);
      const signature = sign(deviceKey.privateKey, payload);
      vi.advanceTimersByTime(BIOMETRIC_CHALLENGE_TTL_SECONDS * 1000 + 1);

      await expect(verify(challengeId, signature, txA)).rejects.toMatchObject({
        code: 'CHALLENGE_INVALID',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('no longer exposes the general-purpose biometric challenge / token flow', () => {
    expect(mobileAuth.createChallenge).toBeUndefined();
    expect(mobileAuth.verifyBiometric).toBeUndefined();
  });
});
