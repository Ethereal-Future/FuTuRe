/**
 * W3C WebAuthn `authenticatorData` parsing (issue #1380). Apple App Attest
 * reuses the same binary layout, so `attestation.js` shares this parser.
 *
 * Layout (WebAuthn Level 3 §6.1):
 *   bytes  0..31  rpIdHash   SHA-256 of the RP ID (or App ID for App Attest)
 *   byte   32     flags      bit 0 UP, bit 2 UV, bit 3 BE, bit 4 BS, bit 6 AT, bit 7 ED
 *   bytes 33..36  signCount  big-endian uint32
 *   then, if AT:  aaguid (16) | credentialIdLength (uint16 BE) | credentialId |
 *                 credentialPublicKey (COSE)
 */

export const FLAG_USER_PRESENT = 0x01;
export const FLAG_USER_VERIFIED = 0x04;
export const FLAG_BACKUP_ELIGIBLE = 0x08;
export const FLAG_BACKUP_STATE = 0x10;
export const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;
export const FLAG_EXTENSION_DATA = 0x80;

const MIN_LENGTH = 37;

/**
 * @param {Buffer|Uint8Array|string} input - Raw bytes, or a base64/base64url string.
 * @returns {{
 *   rpIdHash: Buffer, flags: number, userPresence: boolean, userVerification: boolean,
 *   backupEligible: boolean, backupState: boolean, attestedCredentialData: boolean,
 *   extensionData: boolean, signCount: number, aaguid?: Buffer, credentialId?: Buffer,
 *   credentialPublicKey?: Buffer, raw: Buffer
 * }}
 */
export function parseAuthenticatorData(input) {
  const buf = toBuffer(input);
  if (buf.length < MIN_LENGTH) {
    throw new Error(
      `authenticatorData too short: expected at least ${MIN_LENGTH} bytes, got ${buf.length}`,
    );
  }

  const flags = buf[32];
  const parsed = {
    rpIdHash: buf.subarray(0, 32),
    flags,
    userPresence: (flags & FLAG_USER_PRESENT) !== 0,
    userVerification: (flags & FLAG_USER_VERIFIED) !== 0,
    backupEligible: (flags & FLAG_BACKUP_ELIGIBLE) !== 0,
    backupState: (flags & FLAG_BACKUP_STATE) !== 0,
    attestedCredentialData: (flags & FLAG_ATTESTED_CREDENTIAL_DATA) !== 0,
    extensionData: (flags & FLAG_EXTENSION_DATA) !== 0,
    signCount: buf.readUInt32BE(33),
    raw: buf,
  };

  if (parsed.attestedCredentialData) {
    if (buf.length < MIN_LENGTH + 18) {
      throw new Error('authenticatorData flags AT but attested credential data is truncated');
    }
    parsed.aaguid = buf.subarray(37, 53);
    const credentialIdLength = buf.readUInt16BE(53);
    const credentialIdEnd = 55 + credentialIdLength;
    if (buf.length < credentialIdEnd) {
      throw new Error('authenticatorData credentialId is truncated');
    }
    parsed.credentialId = buf.subarray(55, credentialIdEnd);
    parsed.credentialPublicKey = buf.subarray(credentialIdEnd);
  }

  return parsed;
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === 'string') {
    // Buffer's base64 decoder accepts both the standard and URL-safe alphabets.
    return Buffer.from(input, 'base64');
  }
  throw new Error('authenticatorData must be a Buffer or base64/base64url string');
}
