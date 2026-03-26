/**
 * Testnet Account Manager
 * Creates and funds Stellar testnet accounts for integration tests.
 * Uses Friendbot to fund accounts so no real XLM is needed.
 */

import * as StellarSDK from '@stellar/stellar-sdk';

const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const server = new StellarSDK.Horizon.Server(HORIZON_TESTNET);

/**
 * Generate a fresh keypair and fund it via Friendbot.
 * @returns {{ publicKey: string, secretKey: string }}
 */
export async function createFundedTestAccount() {
  const keypair = StellarSDK.Keypair.random();
  const publicKey = keypair.publicKey();

  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) {
    throw new Error(`Friendbot failed for ${publicKey}: ${res.statusText}`);
  }

  return { publicKey, secretKey: keypair.secret() };
}

/**
 * Load the XLM balance for an account.
 * @param {string} publicKey
 * @returns {string} balance string e.g. "10000.0000000"
 */
export async function getXLMBalance(publicKey) {
  const account = await server.loadAccount(publicKey);
  const xlm = account.balances.find((b) => b.asset_type === 'native');
  return xlm ? xlm.balance : '0';
}

/**
 * Wait until an account exists on the testnet (poll up to maxAttempts).
 * Useful after Friendbot to ensure the account is indexed.
 */
export async function waitForAccount(publicKey, maxAttempts = 10, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await server.loadAccount(publicKey);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Account ${publicKey} not found after ${maxAttempts} attempts`);
}
