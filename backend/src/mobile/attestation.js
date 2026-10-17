/**
 * Server-side cryptographic hardware attestation (issue #1382).
 *
 * Replaces trust in client-supplied `isJailbroken` / `isRooted` booleans with
 * verification of platform-signed evidence:
 *
 *  - Android: Google Play Integrity tokens, decrypted (JWE A256KW/A256GCM) and
 *    signature-verified (JWS ES256) locally with the app's Play Console
 *    response keys. The device verdict must include MEETS_DEVICE_INTEGRITY or
 *    MEETS_STRONG_INTEGRITY.
 *  - iOS: Apple App Attest. A one-time attestation (CBOR `apple-appattest`
 *    statement whose x5c chain must lead to the Apple App Attestation Root CA)
 *    registers a hardware-backed key; every later high-risk request carries an
 *    assertion signed by that key with a strictly increasing counter.
 *
 * Every attestation and assertion is bound to a single-use, server-issued
 * nonce (Redis GETDEL), so captured evidence cannot be replayed.
 *
 * Configuration (env):
 *   ANDROID_PACKAGE_NAME               expected Android applicationId
 *   PLAY_INTEGRITY_DECRYPTION_KEY      base64 AES-256 key from Play Console
 *   PLAY_INTEGRITY_VERIFICATION_KEY    base64 DER (SPKI) EC public key from Play Console
 *   ANDROID_APP_CERT_SHA256            optional comma-separated allowed signing-cert digests
 *   PLAY_INTEGRITY_MAX_AGE_MS          max token age (default 5 minutes)
 *   APPLE_APP_ID                       "<TEAM_ID>.<bundle id>"
 *   APPLE_APP_ATTEST_ROOT_CA           PEM of the Apple App Attestation Root CA
 *   APPLE_APP_ATTEST_ALLOW_DEVELOPMENT "true" to accept the development environment
 *
 * Verification fails closed: a missing key or root certificate rejects the
 * attestation rather than skipping the check.
 */
import crypto from 'crypto';
import { redisSet, redisGetDelete } from './redisStore.js';
import { parseAuthenticatorData } from './authenticatorData.js';

export const NONCE_TTL_SECONDS = 300;
const DEFAULT_PLAY_INTEGRITY_MAX_AGE_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

export const ACCEPTED_DEVICE_VERDICTS = ['MEETS_STRONG_INTEGRITY', 'MEETS_DEVICE_INTEGRITY'];

// 1.2.840.113635.100.8.2 — Apple App Attest nonce extension.
const APPLE_NONCE_OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
const AAGUID_PRODUCTION = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from('appattestdevelop');
// RFC 3394 default initial value for AES key wrap.
const AES_KW_IV = Buffer.from('A6A6A6A6A6A6A6A6', 'hex');

export class AttestationError extends Error {
  constructor(message, code, status = 403) {
    super(message);
    this.name = 'AttestationError';
    this.code = code;
    this.status = status;
  }
}

function loadConfig(overrides = {}) {
  const env = process.env;
  return {
    androidPackageName: env.ANDROID_PACKAGE_NAME,
    playIntegrityDecryptionKey: env.PLAY_INTEGRITY_DECRYPTION_KEY,
    playIntegrityVerificationKey: env.PLAY_INTEGRITY_VERIFICATION_KEY,
    allowedCertDigests: (env.ANDROID_APP_CERT_SHA256 || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
    playIntegrityMaxAgeMs:
      Number(env.PLAY_INTEGRITY_MAX_AGE_MS) || DEFAULT_PLAY_INTEGRITY_MAX_AGE_MS,
    appleAppId: env.APPLE_APP_ID,
    appleRootCa: env.APPLE_APP_ATTEST_ROOT_CA,
    appleAllowDevelopment: env.APPLE_APP_ATTEST_ALLOW_DEVELOPMENT === 'true',
    ...overrides,
  };
}

function requireConfig(value, name) {
  if (!value) {
    throw new AttestationError(`${name} is not configured`, 'ATTESTATION_NOT_CONFIGURED', 503);
  }
  return value;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function b64url(segment) {
  return Buffer.from(segment, 'base64url');
}

function safeEqual(a, b) {
  return (
    Buffer.isBuffer(a) &&
    Buffer.isBuffer(b) &&
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

function toBytes(value, field) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string' && value.length > 0) return Buffer.from(value, 'base64');
  throw new AttestationError(`${field} is required`, 'ATTESTATION_INVALID', 400);
}

// ── Single-use nonces ───────────────────────────────────────────────────────

function nonceKey(deviceId) {
  return `mobile:attest:nonce:${deviceId}`;
}

/**
 * Issue a fresh attestation nonce for `deviceId`. The client must embed it in
 * its Play Integrity request / App Attest clientData. Issuing a new nonce
 * invalidates any previous outstanding one for the device.
 */
export async function issueAttestationNonce(deviceId) {
  if (!deviceId) throw new AttestationError('deviceId is required', 'ATTESTATION_INVALID', 400);
  const nonce = crypto.randomBytes(32).toString('base64url');
  await redisSet(nonceKey(deviceId), { nonce, issuedAt: Date.now() }, NONCE_TTL_SECONDS);
  return { nonce, expiresIn: NONCE_TTL_SECONDS };
}

/** Atomically consume the outstanding nonce for `deviceId`. */
export async function takeAttestationNonce(deviceId) {
  const entry = deviceId ? await redisGetDelete(nonceKey(deviceId)) : null;
  if (!entry?.nonce) {
    throw new AttestationError(
      'Attestation nonce expired or not found',
      'ATTESTATION_NONCE_EXPIRED',
      401,
    );
  }
  return entry.nonce;
}

// ── Google Play Integrity ───────────────────────────────────────────────────

function decryptJwe(token, decryptionKeyB64) {
  const parts = String(token).split('.');
  if (parts.length !== 5) {
    throw new AttestationError(
      'Play Integrity token is not a compact JWE',
      'ATTESTATION_INVALID',
      400,
    );
  }
  const [protectedHeader, encryptedKey, iv, ciphertext, tag] = parts;

  let header;
  try {
    header = JSON.parse(b64url(protectedHeader).toString('utf8'));
  } catch {
    throw new AttestationError(
      'Play Integrity JWE header is malformed',
      'ATTESTATION_INVALID',
      400,
    );
  }
  if (header.alg !== 'A256KW' || header.enc !== 'A256GCM') {
    throw new AttestationError(
      'Unsupported Play Integrity JWE algorithm',
      'ATTESTATION_INVALID',
      400,
    );
  }

  const kek = Buffer.from(decryptionKeyB64, 'base64');
  if (kek.length !== 32) {
    throw new AttestationError(
      'PLAY_INTEGRITY_DECRYPTION_KEY must be a 256-bit key',
      'ATTESTATION_NOT_CONFIGURED',
      503,
    );
  }

  try {
    const unwrap = crypto.createDecipheriv('id-aes256-wrap', kek, AES_KW_IV);
    const cek = Buffer.concat([unwrap.update(b64url(encryptedKey)), unwrap.final()]);
    const decipher = crypto.createDecipheriv('aes-256-gcm', cek, b64url(iv));
    decipher.setAAD(Buffer.from(protectedHeader, 'ascii'));
    decipher.setAuthTag(b64url(tag));
    return Buffer.concat([decipher.update(b64url(ciphertext)), decipher.final()]).toString('utf8');
  } catch {
    throw new AttestationError('Play Integrity token decryption failed', 'ATTESTATION_TAMPERED');
  }
}

function verifyJws(jws, verificationKeyB64) {
  const parts = jws.split('.');
  if (parts.length !== 3) {
    throw new AttestationError(
      'Play Integrity payload is not a compact JWS',
      'ATTESTATION_INVALID',
      400,
    );
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  let header;
  try {
    header = JSON.parse(b64url(headerB64).toString('utf8'));
  } catch {
    throw new AttestationError(
      'Play Integrity JWS header is malformed',
      'ATTESTATION_INVALID',
      400,
    );
  }
  if (header.alg !== 'ES256') {
    throw new AttestationError(
      'Unsupported Play Integrity JWS algorithm',
      'ATTESTATION_INVALID',
      400,
    );
  }

  const key = crypto.createPublicKey({
    key: Buffer.from(verificationKeyB64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  let valid = false;
  try {
    valid = crypto.verify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`, 'ascii'),
      { key, dsaEncoding: 'ieee-p1363' },
      b64url(signatureB64),
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new AttestationError(
      'Play Integrity signature verification failed',
      'ATTESTATION_TAMPERED',
    );
  }

  try {
    return JSON.parse(b64url(payloadB64).toString('utf8'));
  } catch {
    throw new AttestationError('Play Integrity payload is malformed', 'ATTESTATION_INVALID', 400);
  }
}

const stripPadding = (s) => String(s ?? '').replace(/=+$/, '');

/**
 * Decrypt, verify and evaluate a Play Integrity token.
 *
 * @param {string} token - The integrity token returned to the app by the Play Integrity API.
 * @param {{ expectedNonce: string, now?: number, config?: object }} options
 * @returns {{ platform: 'android', verdict: string, deviceVerdicts: string[],
 *             appLicensingVerdict?: string }}
 * @throws {AttestationError} code DEVICE_INTEGRITY_FAILED when the device itself fails integrity.
 */
export function verifyPlayIntegrityToken(
  token,
  { expectedNonce, now = Date.now(), config: overrides } = {},
) {
  const config = loadConfig(overrides);
  const packageName = requireConfig(config.androidPackageName, 'ANDROID_PACKAGE_NAME');
  const decryptionKey = requireConfig(
    config.playIntegrityDecryptionKey,
    'PLAY_INTEGRITY_DECRYPTION_KEY',
  );
  const verificationKey = requireConfig(
    config.playIntegrityVerificationKey,
    'PLAY_INTEGRITY_VERIFICATION_KEY',
  );
  if (!token) {
    throw new AttestationError('Play Integrity token is required', 'ATTESTATION_INVALID', 400);
  }

  const payload = verifyJws(decryptJwe(token, decryptionKey), verificationKey);

  const request = payload.requestDetails ?? {};
  if (request.requestPackageName !== packageName) {
    throw new AttestationError(
      'Play Integrity token was issued for another package',
      'ATTESTATION_MISMATCH',
    );
  }
  if (!expectedNonce || stripPadding(request.nonce) !== stripPadding(expectedNonce)) {
    throw new AttestationError('Play Integrity nonce mismatch', 'ATTESTATION_NONCE_MISMATCH');
  }
  const issuedAt = Number(request.timestampMillis);
  if (
    !Number.isFinite(issuedAt) ||
    now - issuedAt > config.playIntegrityMaxAgeMs ||
    issuedAt - now > CLOCK_SKEW_MS
  ) {
    throw new AttestationError('Play Integrity token is stale', 'ATTESTATION_STALE');
  }

  const app = payload.appIntegrity ?? {};
  if (app.appRecognitionVerdict !== 'PLAY_RECOGNIZED' || app.packageName !== packageName) {
    throw new AttestationError(
      'App binary is not recognized by Google Play',
      'APP_INTEGRITY_FAILED',
    );
  }
  if (config.allowedCertDigests.length > 0) {
    const digests = app.certificateSha256Digest ?? [];
    if (!digests.some((d) => config.allowedCertDigests.includes(d))) {
      throw new AttestationError('App signing certificate is not allowed', 'APP_INTEGRITY_FAILED');
    }
  }

  const deviceVerdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const verdict = ACCEPTED_DEVICE_VERDICTS.find((v) => deviceVerdicts.includes(v));
  if (!verdict) {
    throw new AttestationError(
      'Device does not meet Play Integrity requirements',
      'DEVICE_INTEGRITY_FAILED',
    );
  }

  return {
    platform: 'android',
    verdict,
    deviceVerdicts,
    appLicensingVerdict: payload.accountDetails?.appLicensingVerdict,
  };
}

// ── Minimal CBOR decoder (RFC 8949 subset used by App Attest) ───────────────

export function decodeCbor(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let offset = 0;

  function readLength(info) {
    if (info < 24) return info;
    if (info === 24) return buf.readUInt8(offset++);
    if (info === 25) {
      const v = buf.readUInt16BE(offset);
      offset += 2;
      return v;
    }
    if (info === 26) {
      const v = buf.readUInt32BE(offset);
      offset += 4;
      return v;
    }
    if (info === 27) {
      const v = buf.readBigUInt64BE(offset);
      offset += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR length too large');
      return Number(v);
    }
    throw new Error('Indefinite-length CBOR items are not supported');
  }

  function readItem() {
    if (offset >= buf.length) throw new Error('Unexpected end of CBOR data');
    const initial = buf[offset++];
    const major = initial >> 5;
    const info = initial & 0x1f;

    switch (major) {
      case 0:
        return readLength(info);
      case 1:
        return -1 - readLength(info);
      case 2: {
        const len = readLength(info);
        if (offset + len > buf.length) throw new Error('CBOR byte string truncated');
        const bytes = buf.subarray(offset, offset + len);
        offset += len;
        return bytes;
      }
      case 3: {
        const len = readLength(info);
        if (offset + len > buf.length) throw new Error('CBOR text string truncated');
        const text = buf.toString('utf8', offset, offset + len);
        offset += len;
        return text;
      }
      case 4: {
        const len = readLength(info);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(readItem());
        return arr;
      }
      case 5: {
        const len = readLength(info);
        const map = {};
        for (let i = 0; i < len; i++) {
          const k = readItem();
          map[String(k)] = readItem();
        }
        return map;
      }
      case 6:
        readLength(info); // tag number — ignored, return the tagged item
        return readItem();
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error('Unsupported CBOR simple/float value');
      default:
        throw new Error('Invalid CBOR major type');
    }
  }

  const value = readItem();
  if (offset !== buf.length) throw new Error('Trailing bytes after CBOR item');
  return value;
}

function decodeCborOrThrow(bytes, what) {
  try {
    return decodeCbor(bytes);
  } catch (err) {
    throw new AttestationError(
      `${what} is not valid CBOR: ${err.message}`,
      'ATTESTATION_INVALID',
      400,
    );
  }
}

// ── Minimal DER walker for the Apple nonce extension ────────────────────────

function readTlv(buf, offset) {
  if (offset + 2 > buf.length) throw new Error('DER truncated');
  const tag = buf[offset];
  let length = buf[offset + 1];
  let headerLength = 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n === 0 || n > 4) throw new Error('Unsupported DER length');
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + buf[offset + 2 + i];
    headerLength += n;
  }
  const start = offset + headerLength;
  const end = start + length;
  if (end > buf.length) throw new Error('DER length exceeds buffer');
  return { tag, start, end };
}

function children(buf, start, end) {
  const out = [];
  let offset = start;
  while (offset < end) {
    const tlv = readTlv(buf, offset);
    out.push(tlv);
    offset = tlv.end;
  }
  return out;
}

/** Find the extnValue (OCTET STRING contents) of the extension with `oid` anywhere in `der`. */
function findExtensionValue(der, oid, start = 0, end = der.length, depth = 0) {
  if (depth > 12) return null;
  for (const node of children(der, start, end)) {
    if ((node.tag & 0x20) === 0) continue; // primitive
    const kids = children(der, node.start, node.end);
    if (
      node.tag === 0x30 &&
      kids.length >= 2 &&
      kids[0].tag === 0x06 &&
      der.subarray(kids[0].start, kids[0].end).equals(oid)
    ) {
      const value = kids[kids.length - 1];
      if (value.tag === 0x04) return der.subarray(value.start, value.end);
    }
    const found = findExtensionValue(der, oid, node.start, node.end, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Extract the 32-byte nonce from the Apple App Attest credential certificate:
 * extension 1.2.840.113635.100.8.2 → SEQUENCE { [1] EXPLICIT OCTET STRING nonce }.
 * @param {Buffer} certDer
 */
export function extractAppleNonce(certDer) {
  try {
    const ext = findExtensionValue(certDer, APPLE_NONCE_OID);
    if (!ext) return null;
    const seq = readTlv(ext, 0);
    if (seq.tag !== 0x30) return null;
    for (const node of children(ext, seq.start, seq.end)) {
      if (node.tag === 0xa1) {
        const octet = readTlv(ext, node.start);
        if (octet.tag === 0x04) return ext.subarray(octet.start, octet.end);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function checkValidity(cert, now) {
  const notBefore = Date.parse(cert.validFrom);
  const notAfter = Date.parse(cert.validTo);
  return now >= notBefore && now <= notAfter;
}

/**
 * Verify the App Attest x5c chain (credCert → intermediate → Apple root).
 * @returns {crypto.X509Certificate} The leaf (credential) certificate.
 */
export function verifyAppleCertificateChain(x5c, rootPem, now = Date.now()) {
  requireConfig(rootPem, 'APPLE_APP_ATTEST_ROOT_CA');
  if (!Array.isArray(x5c) || x5c.length < 2) {
    throw new AttestationError(
      'App Attest statement must include a certificate chain',
      'ATTESTATION_INVALID',
      400,
    );
  }

  let certs;
  let root;
  try {
    certs = x5c.map((der) => new crypto.X509Certificate(der));
    root = new crypto.X509Certificate(rootPem);
  } catch {
    throw new AttestationError(
      'App Attest certificate chain is malformed',
      'ATTESTATION_INVALID',
      400,
    );
  }

  const rootIncluded = certs[certs.length - 1].fingerprint256 === root.fingerprint256;
  const chain = rootIncluded ? certs : [...certs, root];
  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i];
    const issuer = i === chain.length - 1 ? root : chain[i + 1];
    if (!checkValidity(cert, now)) {
      throw new AttestationError(
        'App Attest certificate is expired or not yet valid',
        'ATTESTATION_TAMPERED',
      );
    }
    if (!cert.checkIssued(issuer) || !cert.verify(issuer.publicKey)) {
      throw new AttestationError(
        'App Attest certificate chain does not lead to the Apple root',
        'ATTESTATION_TAMPERED',
      );
    }
  }
  return certs[0];
}

function uncompressedPoint(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    throw new AttestationError(
      'App Attest key must be an EC P-256 key',
      'ATTESTATION_INVALID',
      400,
    );
  }
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
}

/**
 * Verify a one-time Apple App Attest attestation and return the key to store.
 *
 * @param {{ keyId: string, attestationObject: string|Buffer, challenge: string }} input
 *   keyId: base64 key identifier from DCAppAttestService.generateKey;
 *   attestationObject: base64 CBOR from attestKey(_:clientDataHash:);
 *   challenge: the server-issued nonce the app hashed into clientDataHash.
 * @param {{ now?: number, config?: object, verifyCertificateChain?: Function }} [options]
 * @returns {{ platform: 'ios', keyId: string, publicKeyPem: string, counter: number,
 *             environment: 'production'|'development', receipt: Buffer|null }}
 */
export function verifyAppAttestation({ keyId, attestationObject, challenge } = {}, options = {}) {
  const config = loadConfig(options.config);
  const appId = requireConfig(config.appleAppId, 'APPLE_APP_ID');
  const verifyChain = options.verifyCertificateChain ?? verifyAppleCertificateChain;
  const now = options.now ?? Date.now();

  if (!challenge) {
    throw new AttestationError('Attestation challenge is required', 'ATTESTATION_INVALID', 400);
  }
  const keyIdBytes = toBytes(keyId, 'keyId');
  const attestation = decodeCborOrThrow(
    toBytes(attestationObject, 'attestationObject'),
    'attestationObject',
  );

  if (
    attestation?.fmt !== 'apple-appattest' ||
    !Buffer.isBuffer(attestation.authData) ||
    !attestation.attStmt
  ) {
    throw new AttestationError(
      'Not an apple-appattest attestation statement',
      'ATTESTATION_INVALID',
      400,
    );
  }

  // 1. Certificate chain → Apple App Attestation Root CA.
  const credCert = verifyChain(attestation.attStmt.x5c, config.appleRootCa, now);

  // 2–4. nonce = SHA256(authData || SHA256(challenge)) must equal the cert extension.
  const clientDataHash = sha256(Buffer.from(challenge));
  const expectedNonce = sha256(Buffer.concat([attestation.authData, clientDataHash]));
  const certNonce = extractAppleNonce(Buffer.from(credCert.raw));
  if (!certNonce || !safeEqual(certNonce, expectedNonce)) {
    throw new AttestationError('App Attest nonce mismatch', 'ATTESTATION_NONCE_MISMATCH');
  }

  // 5. keyId must be SHA256 of the credential certificate's public key.
  const point = uncompressedPoint(credCert.publicKey);
  if (!safeEqual(sha256(point), keyIdBytes)) {
    throw new AttestationError(
      'App Attest keyId does not match the attested key',
      'ATTESTATION_MISMATCH',
    );
  }

  let authData;
  try {
    authData = parseAuthenticatorData(attestation.authData);
  } catch (err) {
    throw new AttestationError(
      `Invalid App Attest authData: ${err.message}`,
      'ATTESTATION_INVALID',
      400,
    );
  }

  // 6. rpIdHash must be SHA256 of our App ID.
  if (!safeEqual(authData.rpIdHash, sha256(appId))) {
    throw new AttestationError('App Attest App ID mismatch', 'ATTESTATION_MISMATCH');
  }
  // 7. Fresh key: counter is 0.
  if (authData.signCount !== 0) {
    throw new AttestationError('App Attest counter must be 0 for a new key', 'ATTESTATION_INVALID');
  }
  // 8. Environment AAGUID.
  let environment;
  if (authData.aaguid && safeEqual(authData.aaguid, AAGUID_PRODUCTION)) {
    environment = 'production';
  } else if (
    authData.aaguid &&
    safeEqual(authData.aaguid, AAGUID_DEVELOPMENT) &&
    config.appleAllowDevelopment
  ) {
    environment = 'development';
  } else {
    throw new AttestationError('App Attest environment is not accepted', 'ATTESTATION_MISMATCH');
  }
  // 9. credentialId must equal keyId.
  if (!authData.credentialId || !safeEqual(authData.credentialId, keyIdBytes)) {
    throw new AttestationError(
      'App Attest credentialId does not match keyId',
      'ATTESTATION_MISMATCH',
    );
  }

  return {
    platform: 'ios',
    keyId: keyIdBytes.toString('base64'),
    publicKeyPem: credCert.publicKey.export({ type: 'spki', format: 'pem' }),
    counter: 0,
    environment,
    receipt: Buffer.isBuffer(attestation.attStmt.receipt) ? attestation.attStmt.receipt : null,
  };
}

/**
 * Verify a per-request App Attest assertion.
 *
 * @param {{ assertion: string|Buffer, clientData: string|Buffer, expectedChallenge: string,
 *           publicKeyPem: string, previousCounter: number }} input
 *   assertion: base64 CBOR { signature, authenticatorData } from generateAssertion;
 *   clientData: base64 of the exact bytes the app hashed — a JSON object whose
 *   `challenge` field is the server-issued nonce.
 * @param {{ config?: object }} [options]
 * @returns {{ counter: number }}
 */
export function verifyAppAssertion(
  { assertion, clientData, expectedChallenge, publicKeyPem, previousCounter = 0 } = {},
  options = {},
) {
  const config = loadConfig(options.config);
  const appId = requireConfig(config.appleAppId, 'APPLE_APP_ID');
  if (!publicKeyPem) {
    throw new AttestationError('Device has no attested App Attest key', 'ATTESTATION_REQUIRED');
  }

  const clientDataBytes = toBytes(clientData, 'clientData');
  let parsedClientData;
  try {
    parsedClientData = JSON.parse(clientDataBytes.toString('utf8'));
  } catch {
    throw new AttestationError('App Attest clientData must be JSON', 'ATTESTATION_INVALID', 400);
  }
  if (
    !expectedChallenge ||
    typeof parsedClientData?.challenge !== 'string' ||
    !safeEqual(Buffer.from(parsedClientData.challenge), Buffer.from(expectedChallenge))
  ) {
    throw new AttestationError(
      'App Attest assertion challenge mismatch',
      'ATTESTATION_NONCE_MISMATCH',
    );
  }

  const decoded = decodeCborOrThrow(toBytes(assertion, 'assertion'), 'assertion');
  if (!Buffer.isBuffer(decoded?.signature) || !Buffer.isBuffer(decoded?.authenticatorData)) {
    throw new AttestationError(
      'App Attest assertion is missing fields',
      'ATTESTATION_INVALID',
      400,
    );
  }

  const nonce = sha256(Buffer.concat([decoded.authenticatorData, sha256(clientDataBytes)]));
  let valid = false;
  try {
    valid = crypto.verify('sha256', nonce, crypto.createPublicKey(publicKeyPem), decoded.signature);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new AttestationError(
      'App Attest assertion signature verification failed',
      'ATTESTATION_TAMPERED',
    );
  }

  let authData;
  try {
    authData = parseAuthenticatorData(decoded.authenticatorData);
  } catch (err) {
    throw new AttestationError(
      `Invalid App Attest authenticatorData: ${err.message}`,
      'ATTESTATION_INVALID',
      400,
    );
  }
  if (!safeEqual(authData.rpIdHash, sha256(appId))) {
    throw new AttestationError('App Attest App ID mismatch', 'ATTESTATION_MISMATCH');
  }
  if (authData.signCount <= Number(previousCounter)) {
    throw new AttestationError('App Attest counter did not increase', 'ATTESTATION_REPLAY');
  }

  return { counter: authData.signCount };
}
