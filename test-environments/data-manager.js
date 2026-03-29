/**
 * Test Data Manager
 *
 * Manages seeding and cleanup of test data across environments.
 * Data sets are defined as plain objects keyed by environment name.
 */

// Stellar testnet seed accounts (public keys only — no real funds)
const SEED_DATA = {
  unit: {
    accounts: [
      { publicKey: 'GABC1111111111111111111111111111111111111111111111111111', balance: '1000.0000000' },
    ],
    assets: ['XLM'],
  },
  integration: {
    accounts: [
      { publicKey: 'GINT1111111111111111111111111111111111111111111111111111', balance: '500.0000000' },
      { publicKey: 'GINT2222222222222222222222222222222222222222222222222222', balance: '250.0000000' },
    ],
    assets: ['XLM', 'USDC'],
  },
  e2e: {
    accounts: [
      { publicKey: 'GE2E1111111111111111111111111111111111111111111111111111', balance: '1000.0000000' },
      { publicKey: 'GE2E2222222222222222222222222222222222222222222222222222', balance: '1000.0000000' },
    ],
    assets: ['XLM', 'USDC'],
  },
  performance: {
    accounts: Array.from({ length: 10 }, (_, i) => ({
      publicKey: `GPERF${String(i).padStart(51, '0')}`,
      balance: '10000.0000000',
    })),
    assets: ['XLM'],
  },
};

/**
 * Returns the seed data for a given environment.
 */
export function getSeedData(envName) {
  return SEED_DATA[envName] ?? { accounts: [], assets: [] };
}

/**
 * Applies seed data to an in-memory store (used in tests via dependency injection).
 * Returns the seeded store so tests can reference it.
 */
export function seedStore(envName, store = {}) {
  const data = getSeedData(envName);
  store.accounts = data.accounts.map((a) => ({ ...a }));
  store.assets = [...data.assets];
  store.seededAt = new Date().toISOString();
  return store;
}

/**
 * Clears the store (cleanup).
 */
export function clearStore(store) {
  store.accounts = [];
  store.assets = [];
  store.seededAt = null;
}
