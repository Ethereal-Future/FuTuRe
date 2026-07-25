import crypto from 'crypto';

/**
 * Generate Subresource Integrity (SRI) hash for a resource
 * @param {string | Buffer} content - the resource content
 * @param {string} algorithm - hash algorithm (default: sha256)
 * @returns {string} SRI hash in format 'sha256-base64hash'
 */
export function generateSRIHash(content, algorithm = 'sha256') {
  if (typeof content === 'string') {
    content = Buffer.from(content, 'utf-8');
  }

  const hash = crypto.createHash(algorithm).update(content).digest('base64');
  return `${algorithm}-${hash}`;
}

/**
 * Verify an SRI hash against resource content
 * @param {string | Buffer} content - the resource content
 * @param {string} integrityAttribute - the integrity attribute value (e.g., 'sha256-abc123...')
 * @returns {boolean} true if hash matches
 */
export function verifySRIHash(content, integrityAttribute) {
  if (typeof content === 'string') {
    content = Buffer.from(content, 'utf-8');
  }

  const [algorithm, expectedHash] = integrityAttribute.split('-', 2);
  if (!algorithm || !expectedHash) return false;

  const actualHash = crypto.createHash(algorithm).update(content).digest('base64');
  return actualHash === expectedHash;
}

export default {
  generateSRIHash,
  verifySRIHash,
};
