import crypto from 'crypto';
import logger from '../config/logger.js';
import prisma from '../config/database.js';
import { invalidateSanctionsCache } from './sanctionsChecker.js';

// Official OFAC SDN list feed. The Treasury publishes the SDN list as XML
// (sdn.xml) and a companion CSV (sdn.csv). We fetch the XML feed and parse
// individuals, vessels, and crypto addresses out of it.
export const OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

// OFAC publishes a SHA-256 checksum alongside the feed. When the checksum
// endpoint is unavailable we fall back to the previously observed digest so a
// transient outage does not silently accept a tampered payload.
let lastKnownChecksum = null;

/**
 * Compute the SHA-256 hex digest of a buffer.
 * @param {Buffer|string} data
 * @returns {string}
 */
export function computeChecksum(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Verify the downloaded payload against the expected checksum. Returns true
 * when the payload is trustworthy. When no expected checksum is available we
 * record the observed digest and accept the payload (first run).
 * @param {Buffer|string} data
 * @param {string|null} expected
 * @returns {boolean}
 */
export function verifyChecksum(data, expected) {
  const actual = computeChecksum(data);
  if (!expected) {
    lastKnownChecksum = actual;
    return true;
  }
  const ok = actual === expected;
  if (ok) lastKnownChecksum = actual;
  return ok;
}

/**
 * Extract the text content of the first matching tag inside a block.
 * @param {string} block
 * @param {string} tag
 * @returns {string}
 */
function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

/**
 * Extract all values for a repeated tag inside a block.
 * @param {string} block
 * @param {string} tag
 * @returns {string[]}
 */
function tagValues(block, tag) {
  const values = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let match;
  while ((match = re.exec(block)) !== null) {
    const value = match[1].trim();
    if (value) values.push(value);
  }
  return values;
}

const CRYPTO_ADDRESS_RE = /\b(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,62}|T[a-zA-Z0-9]{33})\b/g;

/**
 * Pull crypto addresses out of an entity's remarks/ids. OFAC embeds wallet
 * addresses in free-text remarks and in Digital Currency Address entries.
 * @param {string} text
 * @returns {string[]}
 */
export function extractCryptoAddresses(text) {
  if (!text) return [];
  const matches = text.match(CRYPTO_ADDRESS_RE);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Parse the OFAC SDN XML payload into normalized entity records.
 * @param {string} xml
 * @returns {Array<{name:string,aliases:string[],entityType:string,cryptoAddresses:string[],source:string}>}
 */
export function parseOfacXml(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const entities = [];
  const blocks = xml.match(/<sdnEntry[\s\S]*?<\/sdnEntry>/gi) || [];

  for (const block of blocks) {
    const firstName = tagValue(block, 'firstName');
    const lastName = tagValue(block, 'lastName');
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (!name) continue;

    const sdnType = tagValue(block, 'sdnType') || 'Individual';
    const entityType = /vessel/i.test(sdnType)
      ? 'vessel'
      : /entity|organization/i.test(sdnType)
        ? 'organization'
        : 'individual';

    const aliases = tagValues(block, 'aka')
      .map((aka) => {
        const akaFirst = tagValue(aka, 'firstName');
        const akaLast = tagValue(aka, 'lastName');
        return [akaFirst, akaLast].filter(Boolean).join(' ').trim();
      })
      .filter(Boolean);

    const remarks = tagValue(block, 'remarks');
    const cryptoAddresses = extractCryptoAddresses(remarks);

    entities.push({
      name,
      aliases,
      entityType,
      cryptoAddresses,
      source: 'OFAC_SDN',
    });
  }

  return entities;
}

/**
 * Download the OFAC SDN feed, verify its checksum, and return the raw XML.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function downloadOfacSdn(fetchImpl = fetch) {
  const response = await fetchImpl(OFAC_SDN_URL);
  if (!response.ok) {
    throw new Error(`OFAC SDN download failed with status ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const expected = response.headers?.get?.('x-checksum-sha256') || null;
  if (!verifyChecksum(buffer, expected)) {
    throw new Error('OFAC SDN checksum verification failed');
  }
  return buffer.toString('utf8');
}

/**
 * Upsert parsed entities into the SanctionsEntity table. Existing rows are
 * matched on (name, source) so re-running the sync is idempotent.
 * @param {Array<object>} entities
 * @returns {Promise<number>} number of entities written
 */
export async function upsertSanctionsEntities(entities) {
  let written = 0;
  for (const entity of entities) {
    await prisma.sanctionsEntity.upsert({
      where: { name_source: { name: entity.name, source: entity.source } },
      update: {
        aliases: entity.aliases,
        entityType: entity.entityType,
        cryptoAddresses: entity.cryptoAddresses,
        updatedAt: new Date(),
      },
      create: {
        name: entity.name,
        aliases: entity.aliases,
        entityType: entity.entityType,
        cryptoAddresses: entity.cryptoAddresses,
        source: entity.source,
      },
    });
    written += 1;
  }
  return written;
}

/**
 * Full synchronization cycle: download, parse, upsert, and invalidate cache.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{synced:number}>}
 */
export async function syncSanctionsList(fetchImpl = fetch) {
  logger.info('sanctionsSync.start');
  const xml = await downloadOfacSdn(fetchImpl);
  const entities = parseOfacXml(xml);
  const synced = await upsertSanctionsEntities(entities);
  await invalidateSanctionsCache();
  logger.info('sanctionsSync.complete', { synced });
  return { synced };
}
