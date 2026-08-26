import * as StellarSDK from '@stellar/stellar-sdk';
import prisma from '../db/client.js';
import { getConfig } from '../config/env.js';

const DEFAULT_FEDERATION_DOMAIN = 'futureremit.app';

/**
 * Get the domain this platform serves federation lookups for.
 * @returns {string} The federation domain, from STELLAR_FEDERATION_DOMAIN or the built-in default
 */
export function getFederationDomain() {
  return process.env.STELLAR_FEDERATION_DOMAIN || DEFAULT_FEDERATION_DOMAIN;
}

/**
 * Normalize a federation address for comparison/storage (trim + lowercase).
 * @param {string} address - Raw federation address, e.g. "Alice*Example.com"
 * @returns {string} Normalized address, e.g. "alice*example.com"
 */
export function normalizeFederationAddress(address) {
  return String(address || '').trim().toLowerCase();
}

/**
 * Check whether a string has the shape of a federation address (`local*domain.tld`).
 * @param {string} address - Address to test
 * @returns {boolean} True if the address matches the federation address pattern
 */
export function isFederationAddress(address) {
  return /^[a-z0-9._-]+\*[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(address || '').trim());
}

/**
 * Resolve a federation address to its Stellar account id, per SEP-0002.
 * @param {string} address - Federation address to resolve, e.g. "alice*futureremit.app"
 * @returns {Promise<{stellar_address: string, account_id: string, memo_type: string}>} SEP-0002 federation response
 * @throws {Error} With `status` 400 if the address is malformed, or 404 if the domain isn't served here or no matching account exists
 */
export async function resolveFederationAddress(address) {
  const normalized = normalizeFederationAddress(address);
  if (!isFederationAddress(normalized)) {
    const error = new Error('Invalid federation address');
    error.status = 400;
    throw error;
  }

  const [, domain] = normalized.split('*');
  if (domain !== getFederationDomain().toLowerCase()) {
    const error = new Error('Federation domain is not served by this platform');
    error.status = 404;
    throw error;
  }

  const setting = await prisma.setting.findFirst({
    where: { federationAddress: normalized },
    include: { user: { select: { publicKey: true } } },
  });

  if (!setting?.user?.publicKey) {
    const error = new Error('Federation address not found');
    error.status = 404;
    throw error;
  }

  return {
    stellar_address: normalized,
    account_id: setting.user.publicKey,
    memo_type: 'none',
  };
}

/**
 * Claim a federation address (local part) for a user's Stellar account, creating the
 * user/settings record if it doesn't already exist.
 * @param {object} opts
 * @param {string} opts.publicKey - Stellar public key to associate with the federation address
 * @param {string} opts.localPart - Desired local part (before the `*`), 3-32 chars: letters, numbers, `.`, `_`, `-`
 * @returns {Promise<{federationAddress: string}>} The claimed, fully-qualified federation address
 * @throws {Error} With `status` 400 if localPart doesn't meet the format requirements
 */
export async function claimFederationAddress({ publicKey, localPart }) {
  const safeLocalPart = String(localPart || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(safeLocalPart)) {
    const error = new Error('Federation name must be 3-32 characters: letters, numbers, dot, underscore, or hyphen');
    error.status = 400;
    throw error;
  }

  const federationAddress = `${safeLocalPart}*${getFederationDomain().toLowerCase()}`;
  const user = await prisma.user.upsert({
    where: { publicKey },
    update: {},
    create: { publicKey },
  });

  const setting = await prisma.setting.upsert({
    where: { userId: user.id },
    update: { federationAddress },
    create: { userId: user.id, federationAddress },
  });

  return { federationAddress: setting.federationAddress };
}

/**
 * ACCOUNTS in a SEP-1 stellar.toml is meant to list this platform's known
 * Stellar accounts for wallet discovery. The only account the platform
 * controls end-to-end today is the fee-sponsoring account used for fee-bump
 * transactions (see wrapWithFeeBump in services/stellar.js) — if that isn't
 * configured, there is intentionally nothing else to list here yet.
 * See issue #954.
 * @returns {string[]} Public keys to advertise in ACCOUNTS.
 */
function getKnownAccounts() {
  const feeSecret = process.env.PLATFORM_FEE_ACCOUNT_SECRET;
  if (!feeSecret) return [];
  try {
    return [StellarSDK.Keypair.fromSecret(feeSecret).publicKey()];
  } catch {
    return [];
  }
}

/**
 * Build this platform's SEP-1 stellar.toml contents, sourced entirely
 * through getConfig() rather than raw process.env. Shared by the canonical
 * /.well-known/stellar.toml route (server.js) and the federation-scoped
 * /api/v1/stellar/federation/stellar.toml route (routes/stellar/federation.js)
 * so the two can't drift out of sync. See issue #954.
 * @returns {string} The stellar.toml document body.
 */
export function buildStellarToml() {
  const { stellar } = getConfig();
  const baseUrl = stellar.serverBaseUrl;
  const networkPassphrase =
    stellar.network === 'mainnet'
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015';

  const accounts = getKnownAccounts();

  return [
    `FEDERATION_SERVER="${baseUrl}/api/v1/stellar/federation"`,
    `SIGNING_KEY="${stellar.signingKey}"`,
    `NETWORK_PASSPHRASE="${networkPassphrase}"`,
    `TRANSFER_SERVER="${baseUrl}/api/v1/stellar"`,
    // Advertises this platform as a SEP-0031 sending anchor. See issue #955.
    `DIRECT_PAYMENT_SERVER="${baseUrl}/api/v1/stellar/sep31"`,
    `ACCOUNTS=[${accounts.map((account) => `"${account}"`).join(', ')}]`,
    `VERSION="2.0.0"`,
    `# Federation domain: ${getFederationDomain()}`,
  ].join('\n');
}
