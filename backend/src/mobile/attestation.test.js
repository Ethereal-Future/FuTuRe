/**
 * Server-side hardware attestation (#1382): Google Play Integrity and Apple
 * App Attest verification, plus the MobileSecurity flows that consume them.
 *
 * Play Integrity tokens are produced here exactly as Google does (JWS ES256
 * wrapped in a JWE A256KW/A256GCM) with locally generated keys. App Attest
 * objects are real CBOR/authData structures signed with a locally generated
 * P-256 key; only the X.509 chain-to-Apple-root step is stubbed, since no
 * test can hold an Apple-issued certificate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── Prisma mock (DeviceRegistry + SecurityAlert) ──────────────────────────────

const devices = vi.hoisted(() => new Map());
const alerts = vi.hoisted(() => []);

vi.mock('../db/client.js', () => ({
  default: {
    deviceRegistry: {
      findUnique: vi.fn(async ({ where }) => {
        const d = devices.get(where.deviceId);
        return d ? { ...d } : null;
      }),
      create: vi.fn(async ({ data }) => {
        const row = { isJailbroken: false, appAttestCounter: 0n, attestedAt: null, attestationPlatform: null, ...data };
        devices.set(data.deviceId, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = devices.get(where.deviceId);
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = devices.get(where.deviceId);
        if (!row || !(row.appAttestCounter < where.appAttestCounter.lt)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    securityAlert: {
      create: vi.fn(async ({ data }) => {
        alerts.push(data);
        return data;
      }),
      findMany: vi.fn(async () => alerts),
    },
  },
}));

// ── Keys & config ─────────────────────────────────────────────────────────────

const PACKAGE = 'com.future.wallet';
const APP_ID = 'TEAMID1234.com.future.wallet';
const DECRYPTION_KEY = crypto.randomBytes(32);
const verification = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const VERIFICATION_KEY_B64 = verification.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
process.env.ANDROID_PACKAGE_NAME = PACKAGE;
process.env.PLAY_INTEGRITY_DECRYPTION_KEY = DECRYPTION_KEY.toString('base64');
process.env.PLAY_INTEGRITY_VERIFICATION_KEY = VERIFICATION_KEY_B64;
process.env.APPLE_APP_ID = APP_ID;
delete process.env.ANDROID_APP_CERT_SHA256;
delete process.env.APPLE_APP_ATTEST_ROOT_CA;
delete process.env.APPLE_APP_ATTEST_ALLOW_DEVELOPMENT;

const {
  AttestationError,
  decodeCbor,
  extractAppleNonce,
  issueAttestationNonce,
  takeAttestationNonce,
  verifyAppAssertion,
  verifyAppAttestation,
  verifyPlayIntegrityToken,
} = await import('./attestation.js');
const { default: mobileSecurity } = await import('./security.js');

// ── Helpers: Play Integrity token construction ───────────────────────────────

const sha256 = (d) => crypto.createHash('sha256').update(d).digest();
const b64u = (b) => Buffer.from(b).toString('base64url');

function signJws(payload, signingKey = verification.privateKey) {
  const header = b64u(JSON.stringify({ alg: 'ES256' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), { key: signingKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${body}.${b64u(sig)}`;
}

function encryptJwe(plaintext, kek = DECRYPTION_KEY) {
  const header = b64u(JSON.stringify({ alg: 'A256KW', enc: 'A256GCM' }));
  const cek = crypto.randomBytes(32);
  const wrap = crypto.createCipheriv('id-aes256-wrap', kek, Buffer.from('A6A6A6A6A6A6A6A6', 'hex'));
  const encryptedKey = Buffer.concat([wrap.update(cek), wrap.final()]);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(Buffer.from(header, 'ascii'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [header, b64u(encryptedKey), b64u(iv), b64u(ciphertext), b64u(cipher.getAuthTag())].join('.');
}

function integrityPayload(nonce, overrides = {}) {
  return {
    requestDetails: { requestPackageName: PACKAGE, nonce, timestampMillis: String(Date.now()) },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: PACKAGE, certificateSha256Digest: ['digest'] },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    accountDetails: { appLicensingVerdict: 'LICENSED' },
    ...overrides,
  };
}

const makeIntegrityToken = (nonce, overrides, signingKey) => encryptJwe(signJws(integrityPayload(nonce, overrides), signingKey));

// ── Helpers: CBOR / DER / App Attest construction ─────────────────────────────

function cborHead(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(length, 1);
  return b;
}

function cbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (typeof value === 'string') {
    const s = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, s.length), s]);
  }
  if (typeof value === 'number') return cborHead(0, value);
  if (Array.isArray(value)) return Buffer.concat([cborHead(4, value.length), ...value.map(cbor)]);
  const entries = Object.entries(value);
  return Buffer.concat([cborHead(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

function der(tag, content) {
  const len = content.length;
  const lenBytes = len < 128 ? Buffer.from([len]) : Buffer.from([0x81, len]);
  return Buffer.concat([Buffer.from([tag]), lenBytes, content]);
}

const APPLE_NONCE_OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);

/** Minimal DER blob carrying the Apple nonce extension the way a credCert does. */
function certWithNonce(nonce) {
  const extValue = der(0x30, der(0xa1, der(0x04, nonce)));
  const extension = der(0x30, Buffer.concat([der(0x06, APPLE_NONCE_OID), der(0x04, extValue)]));
  return der(0x30, der(0xa3, der(0x30, extension)));
}

function appAttestKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { publicKey, privateKey, keyId: sha256(point) };
}

function buildAttestation(key, challenge, opts = {}) {
  const aaguid = opts.aaguid ?? Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(opts.counter ?? 0);
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(key.keyId.length);
  const authData = Buffer.concat([
    sha256(opts.appId ?? APP_ID),
    Buffer.from([0x40]),
    counter,
    aaguid,
    credIdLen,
    opts.credentialId ?? key.keyId,
    cbor({ 1: 2 }), // COSE key placeholder (the key is taken from the certificate)
  ]);
  const nonce = sha256(Buffer.concat([authData, sha256(Buffer.from(opts.nonceChallenge ?? challenge))]));
  const cert = { raw: certWithNonce(opts.certNonce ?? nonce), publicKey: (opts.certKey ?? key).publicKey };
  const attestationObject = cbor({
    fmt: opts.fmt ?? 'apple-appattest',
    attStmt: { x5c: [Buffer.from('leaf-der'), Buffer.from('intermediate-der')], receipt: Buffer.from('receipt') },
    authData,
  });
  return { attestationObject: attestationObject.toString('base64'), keyId: key.keyId.toString('base64'), cert };
}

function buildAssertion(key, challenge, { counter = 1, appId = APP_ID, signer } = {}) {
  const clientData = Buffer.from(JSON.stringify({ challenge, action: 'queue.flush' }));
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([sha256(appId), Buffer.from([0x00]), counterBuf]);
  const nonce = sha256(Buffer.concat([authenticatorData, sha256(clientData)]));
  const signature = crypto.sign('sha256', nonce, signer ?? key.privateKey);
  return {
    assertion: cbor({ signature, authenticatorData }).toString('base64'),
    clientData: clientData.toString('base64'),
  };
}

const stubChain = (cert) => vi.fn(() => cert);

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  devices.clear();
  alerts.length = 0;
  vi.clearAllMocks();
});

describe('Play Integrity verification', () => {
  const nonce = crypto.randomBytes(32).toString('base64url');

  it('accepts a valid Google-signed token meeting device integrity', () => {
    const result = verifyPlayIntegrityToken(makeIntegrityToken(nonce), { expectedNonce: nonce });
    expect(result).toMatchObject({ platform: 'android', verdict: 'MEETS_DEVICE_INTEGRITY' });
  });

  it('reports strong integrity when present', () => {
    const token = makeIntegrityToken(nonce, {
      deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY'] },
    });
    expect(verifyPlayIntegrityToken(token, { expectedNonce: nonce }).verdict).toBe('MEETS_STRONG_INTEGRITY');
  });

  it.each([[['MEETS_BASIC_INTEGRITY']], [['MEETS_VIRTUAL_INTEGRITY']], [[]]])(
    'rejects device verdict %j',
    (deviceRecognitionVerdict) => {
      const token = makeIntegrityToken(nonce, { deviceIntegrity: { deviceRecognitionVerdict } });
      expect(() => verifyPlayIntegrityToken(token, { expectedNonce: nonce })).toThrow(
        expect.objectContaining({ code: 'DEVICE_INTEGRITY_FAILED' }),
      );
    },
  );

  it('rejects a token whose inner JWS was not signed by Google', () => {
    const attacker = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const token = makeIntegrityToken(nonce, {}, attacker);
    expect(() => verifyPlayIntegrityToken(token, { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_TAMPERED' }),
    );
  });

  it('rejects a token encrypted with a different key', () => {
    const token = encryptJwe(signJws(integrityPayload(nonce)), crypto.randomBytes(32));
    expect(() => verifyPlayIntegrityToken(token, { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_TAMPERED' }),
    );
  });

  it('rejects a tampered ciphertext', () => {
    const parts = makeIntegrityToken(nonce).split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 0xff;
    parts[3] = b64u(ct);
    expect(() => verifyPlayIntegrityToken(parts.join('.'), { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_TAMPERED' }),
    );
  });

  it('rejects a nonce that was not issued for this request', () => {
    expect(() => verifyPlayIntegrityToken(makeIntegrityToken('other-nonce'), { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_NONCE_MISMATCH' }),
    );
  });

  it('rejects a stale token', () => {
    const token = makeIntegrityToken(nonce, {
      requestDetails: { requestPackageName: PACKAGE, nonce, timestampMillis: String(Date.now() - 10 * 60 * 1000) },
    });
    expect(() => verifyPlayIntegrityToken(token, { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_STALE' }),
    );
  });

  it('rejects a token for another package or an unrecognized app binary', () => {
    const otherPkg = makeIntegrityToken(nonce, {
      requestDetails: { requestPackageName: 'com.evil', nonce, timestampMillis: String(Date.now()) },
    });
    expect(() => verifyPlayIntegrityToken(otherPkg, { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_MISMATCH' }),
    );

    const sideloaded = makeIntegrityToken(nonce, {
      appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: PACKAGE },
    });
    expect(() => verifyPlayIntegrityToken(sideloaded, { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'APP_INTEGRITY_FAILED' }),
    );
  });

  it('enforces the signing-certificate allowlist when configured', () => {
    const token = makeIntegrityToken(nonce);
    expect(() =>
      verifyPlayIntegrityToken(token, { expectedNonce: nonce, config: { allowedCertDigests: ['expected-digest'] } }),
    ).toThrow(expect.objectContaining({ code: 'APP_INTEGRITY_FAILED' }));
  });

  it('rejects spoofed client payloads such as plain integrity booleans', () => {
    const spoofed = JSON.stringify({ isJailbroken: false, isRooted: false });
    expect(() => verifyPlayIntegrityToken(spoofed, { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_INVALID' }),
    );
    expect(() => verifyPlayIntegrityToken(signJws(integrityPayload(nonce)), { expectedNonce: nonce })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_INVALID' }),
    );
  });

  it('fails closed when the Play Integrity keys are not configured', () => {
    expect(() =>
      verifyPlayIntegrityToken(makeIntegrityToken(nonce), {
        expectedNonce: nonce,
        config: { playIntegrityDecryptionKey: undefined },
      }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_NOT_CONFIGURED', status: 503 }));
  });
});

describe('Apple App Attest — attestation', () => {
  const challenge = 'server-nonce-123';

  it('accepts a valid attestation and returns the hardware key to store', () => {
    const key = appAttestKey();
    const { attestationObject, keyId, cert } = buildAttestation(key, challenge);
    const verifyCertificateChain = stubChain(cert);

    const result = verifyAppAttestation({ keyId, attestationObject, challenge }, { verifyCertificateChain });

    expect(verifyCertificateChain).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ platform: 'ios', keyId, counter: 0, environment: 'production' });
    expect(result.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('rejects an attestation made over a different challenge', () => {
    const key = appAttestKey();
    const { attestationObject, keyId, cert } = buildAttestation(key, challenge, { nonceChallenge: 'old-nonce' });
    expect(() =>
      verifyAppAttestation({ keyId, attestationObject, challenge }, { verifyCertificateChain: stubChain(cert) }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_NONCE_MISMATCH' }));
  });

  it('rejects a certificate whose key does not match keyId', () => {
    const key = appAttestKey();
    const { attestationObject, keyId, cert } = buildAttestation(key, challenge, { certKey: appAttestKey() });
    expect(() =>
      verifyAppAttestation({ keyId, attestationObject, challenge }, { verifyCertificateChain: stubChain(cert) }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_MISMATCH' }));
  });

  it('rejects an attestation for another App ID', () => {
    const key = appAttestKey();
    const { attestationObject, keyId, cert } = buildAttestation(key, challenge, { appId: 'OTHER.com.evil' });
    expect(() =>
      verifyAppAttestation({ keyId, attestationObject, challenge }, { verifyCertificateChain: stubChain(cert) }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_MISMATCH' }));
  });

  it('rejects the development environment unless explicitly allowed', () => {
    const key = appAttestKey();
    const { attestationObject, keyId, cert } = buildAttestation(key, challenge, {
      aaguid: Buffer.from('appattestdevelop'),
    });
    const opts = { verifyCertificateChain: stubChain(cert) };
    expect(() => verifyAppAttestation({ keyId, attestationObject, challenge }, opts)).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_MISMATCH' }),
    );
    const dev = verifyAppAttestation(
      { keyId, attestationObject, challenge },
      { ...opts, config: { appleAllowDevelopment: true } },
    );
    expect(dev.environment).toBe('development');
  });

  it('rejects a non-zero counter, wrong credentialId or wrong fmt', () => {
    const key = appAttestKey();
    for (const opts of [{ counter: 1 }, { credentialId: crypto.randomBytes(32) }]) {
      const { attestationObject, keyId, cert } = buildAttestation(key, challenge, opts);
      expect(() =>
        verifyAppAttestation({ keyId, attestationObject, challenge }, { verifyCertificateChain: stubChain(cert) }),
      ).toThrow(AttestationError);
    }
    const { attestationObject, keyId, cert } = buildAttestation(key, challenge, { fmt: 'none' });
    expect(() =>
      verifyAppAttestation({ keyId, attestationObject, challenge }, { verifyCertificateChain: stubChain(cert) }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_INVALID' }));
  });

  it('propagates certificate chain failures', () => {
    const key = appAttestKey();
    const { attestationObject, keyId } = buildAttestation(key, challenge);
    const verifyCertificateChain = () => {
      throw new AttestationError('chain does not lead to Apple root', 'ATTESTATION_TAMPERED');
    };
    expect(() => verifyAppAttestation({ keyId, attestationObject, challenge }, { verifyCertificateChain })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_TAMPERED' }),
    );
  });

  it('fails closed when the Apple root CA is not configured', () => {
    const key = appAttestKey();
    const { attestationObject, keyId } = buildAttestation(key, challenge);
    expect(() => verifyAppAttestation({ keyId, attestationObject, challenge })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_NOT_CONFIGURED', status: 503 }),
    );
  });

  it('rejects malformed CBOR', () => {
    expect(() =>
      verifyAppAttestation({ keyId: 'AAAA', attestationObject: Buffer.from([0xff, 0x00]), challenge }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_INVALID' }));
  });
});

describe('Apple App Attest — assertion', () => {
  const challenge = 'per-request-nonce';
  const key = appAttestKey();
  const publicKeyPem = key.publicKey.export({ type: 'spki', format: 'pem' });

  it('accepts a valid assertion with an increasing counter', () => {
    const { assertion, clientData } = buildAssertion(key, challenge, { counter: 5 });
    const result = verifyAppAssertion({ assertion, clientData, expectedChallenge: challenge, publicKeyPem, previousCounter: 4 });
    expect(result.counter).toBe(5);
  });

  it('rejects a replayed counter', () => {
    const { assertion, clientData } = buildAssertion(key, challenge, { counter: 4 });
    expect(() =>
      verifyAppAssertion({ assertion, clientData, expectedChallenge: challenge, publicKeyPem, previousCounter: 4 }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_REPLAY' }));
  });

  it('rejects an assertion signed by a different key', () => {
    const { assertion, clientData } = buildAssertion(key, challenge, { signer: appAttestKey().privateKey });
    expect(() => verifyAppAssertion({ assertion, clientData, expectedChallenge: challenge, publicKeyPem })).toThrow(
      expect.objectContaining({ code: 'ATTESTATION_TAMPERED' }),
    );
  });

  it('rejects tampered clientData or a stale challenge', () => {
    const { assertion } = buildAssertion(key, challenge);
    const forged = Buffer.from(JSON.stringify({ challenge, action: 'something-else' })).toString('base64');
    expect(() =>
      verifyAppAssertion({ assertion, clientData: forged, expectedChallenge: challenge, publicKeyPem }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_TAMPERED' }));

    const { assertion: a2, clientData: c2 } = buildAssertion(key, 'old-nonce');
    expect(() =>
      verifyAppAssertion({ assertion: a2, clientData: c2, expectedChallenge: challenge, publicKeyPem }),
    ).toThrow(expect.objectContaining({ code: 'ATTESTATION_NONCE_MISMATCH' }));
  });
});

describe('CBOR / DER helpers', () => {
  it('decodes the CBOR subset used by App Attest', () => {
    const decoded = decodeCbor(cbor({ fmt: 'apple-appattest', n: 300, list: [Buffer.from([1, 2])] }));
    expect(decoded.fmt).toBe('apple-appattest');
    expect(decoded.n).toBe(300);
    expect(decoded.list[0]).toEqual(Buffer.from([1, 2]));
  });

  it('extracts the nonce extension from a credential certificate', () => {
    const nonce = crypto.randomBytes(32);
    expect(extractAppleNonce(certWithNonce(nonce))).toEqual(nonce);
    expect(extractAppleNonce(der(0x30, der(0x02, Buffer.from([1]))))).toBeNull();
  });
});

describe('attestation nonces', () => {
  it('are single use', async () => {
    const { nonce } = await issueAttestationNonce('device-n');
    expect(await takeAttestationNonce('device-n')).toBe(nonce);
    await expect(takeAttestationNonce('device-n')).rejects.toMatchObject({ code: 'ATTESTATION_NONCE_EXPIRED' });
  });
});

describe('MobileSecurity hardware attestation flows', () => {
  async function registered(deviceId) {
    await mobileSecurity.registerDevice(deviceId, 'fp-1');
    return deviceId;
  }

  it('never clears the jailbreak flag from client-supplied booleans', async () => {
    const deviceId = await registered('device-jb');
    await mobileSecurity.flagJailbroken(deviceId);

    // Re-registering, or "attesting" with only client booleans, must not clear it.
    await mobileSecurity.registerDevice(deviceId, 'fp-1');
    await mobileSecurity.createAttestationChallenge(deviceId);
    await expect(
      mobileSecurity.attestDevice(deviceId, { platform: 'android', isJailbroken: false, isRooted: false }),
    ).rejects.toMatchObject({ code: 'ATTESTATION_INVALID' });

    expect(devices.get(deviceId).isJailbroken).toBe(true);
    await expect(mobileSecurity.validateRequest(deviceId, 'fp-1')).rejects.toThrow(/Jailbroken/);
  });

  it('records a server-verified Play Integrity attestation', async () => {
    const deviceId = await registered('device-android');
    const { nonce } = await mobileSecurity.createAttestationChallenge(deviceId);

    const result = await mobileSecurity.attestDevice(deviceId, {
      platform: 'android',
      integrityToken: makeIntegrityToken(nonce),
    });

    expect(result).toMatchObject({ attested: true, platform: 'android', verdict: 'MEETS_DEVICE_INTEGRITY' });
    expect(devices.get(deviceId)).toMatchObject({ attestationPlatform: 'android', isJailbroken: false });
    expect(devices.get(deviceId).attestedAt).toBeInstanceOf(Date);
  });

  it('flags the device when Play Integrity reports a compromised device', async () => {
    const deviceId = await registered('device-rooted');
    const { nonce } = await mobileSecurity.createAttestationChallenge(deviceId);
    const token = makeIntegrityToken(nonce, { deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } });

    await expect(mobileSecurity.attestDevice(deviceId, { platform: 'android', integrityToken: token })).rejects.toMatchObject({
      code: 'DEVICE_INTEGRITY_FAILED',
    });
    expect(devices.get(deviceId).isJailbroken).toBe(true);
    expect(alerts.map((a) => a.details)).toContain('device_integrity_failed');
  });

  it('cannot replay an integrity token against a consumed nonce', async () => {
    const deviceId = await registered('device-replay');
    const { nonce } = await mobileSecurity.createAttestationChallenge(deviceId);
    const token = makeIntegrityToken(nonce);
    await mobileSecurity.attestDevice(deviceId, { platform: 'android', integrityToken: token });

    await expect(mobileSecurity.attestDevice(deviceId, { platform: 'android', integrityToken: token })).rejects.toMatchObject({
      code: 'ATTESTATION_NONCE_EXPIRED',
    });
  });

  it('requires attestation before high-risk operations', async () => {
    const deviceId = await registered('device-unattested');
    await expect(mobileSecurity.verifyHighRiskOperation(deviceId, {})).rejects.toMatchObject({
      code: 'ATTESTATION_REQUIRED',
    });
  });

  it('requires a fresh Play Integrity token for each high-risk operation', async () => {
    const deviceId = await registered('device-hr-android');
    let { nonce } = await mobileSecurity.createAttestationChallenge(deviceId);
    await mobileSecurity.attestDevice(deviceId, { platform: 'android', integrityToken: makeIntegrityToken(nonce) });

    ({ nonce } = await mobileSecurity.createAttestationChallenge(deviceId));
    const token = makeIntegrityToken(nonce);
    await expect(mobileSecurity.verifyHighRiskOperation(deviceId, { integrityToken: token })).resolves.toMatchObject({
      verified: true,
    });
    await expect(mobileSecurity.verifyHighRiskOperation(deviceId, { integrityToken: token })).rejects.toMatchObject({
      code: 'ATTESTATION_NONCE_EXPIRED',
    });
  });

  it('verifies App Attest assertions for high-risk operations and rejects counter replay', async () => {
    const deviceId = await registered('device-hr-ios');
    const key = appAttestKey();
    Object.assign(devices.get(deviceId), {
      attestationPlatform: 'ios',
      attestedAt: new Date(),
      appAttestKeyId: key.keyId.toString('base64'),
      appAttestPublicKey: key.publicKey.export({ type: 'spki', format: 'pem' }),
      appAttestCounter: 0n,
    });

    let { nonce } = await mobileSecurity.createAttestationChallenge(deviceId);
    await expect(
      mobileSecurity.verifyHighRiskOperation(deviceId, buildAssertion(key, nonce, { counter: 1 })),
    ).resolves.toMatchObject({ verified: true, platform: 'ios' });
    expect(devices.get(deviceId).appAttestCounter).toBe(1n);

    ({ nonce } = await mobileSecurity.createAttestationChallenge(deviceId));
    await expect(
      mobileSecurity.verifyHighRiskOperation(deviceId, buildAssertion(key, nonce, { counter: 1 })),
    ).rejects.toMatchObject({ code: 'ATTESTATION_REPLAY' });
  });

  it('middleware blocks requests without attestation evidence', async () => {
    const deviceId = await registered('device-mw');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await mobileSecurity.requireHardwareAttestation()({ mobile: { deviceId }, headers: {} }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ATTESTATION_REQUIRED' }));
  });
});
