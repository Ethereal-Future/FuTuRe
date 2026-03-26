import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Stellar SDK
vi.mock('@stellar/stellar-sdk', async () => {
  const mockKeypair = {
    publicKey: () => 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
    secret: () => 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH',
    sign: vi.fn(),
    verify: vi.fn(() => true),
  };

  const mockTransaction = {
    sign: vi.fn(),
    toXDR: vi.fn(() => 'mock-xdr-string'),
    hash: vi.fn(() => Buffer.from('mockhash')),
    signatures: [
      {
        signature: () => Buffer.from('mocksig'),
      },
    ],
  };

  const mockBuilder = {
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn(() => mockTransaction),
  };

  return {
    Horizon: {
      Server: vi.fn(() => ({
        loadAccount: vi.fn(() => ({
          balances: [],
          signers: [
            { key: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H', weight: 1, type: 'ed25519_public_key' },
          ],
          thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3, master_key_weight: 1 },
        })),
        submitTransaction: vi.fn(() => ({ hash: 'mock-hash', ledger: 1, successful: true })),
      })),
    },
    Keypair: {
      random: vi.fn(() => mockKeypair),
      fromSecret: vi.fn(() => mockKeypair),
      fromPublicKey: vi.fn(() => mockKeypair),
    },
    TransactionBuilder: Object.assign(
      vi.fn(() => mockBuilder),
      {
        fromXDR: vi.fn(() => mockTransaction),
      }
    ),
    Operation: {
      setOptions: vi.fn((opts) => opts),
      payment: vi.fn((opts) => opts),
    },
    Asset: {
      native: vi.fn(() => ({ type: 'native' })),
    },
    Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
    BASE_FEE: '100',
  };
});

// Mock event monitor
vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: {
    publishEvent: vi.fn(() => Promise.resolve({})),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const {
  createMultiSigAccount,
  buildMultiSigTransaction,
  addSignature,
  submitMultiSigTransaction,
  verifySignatures,
  getMultiSigConfig,
  updateMultiSigConfig,
  getPendingTransactions,
  getPendingTransaction,
} = await import('../src/services/multiSig.js');

const MOCK_SECRET = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
const MOCK_PUBLIC = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
const MOCK_DEST = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQ';

describe('Multi-Signature Service', () => {
  describe('createMultiSigAccount', () => {
    it('should create a multi-sig account with signers and thresholds', async () => {
      const signers = [{ publicKey: MOCK_DEST, weight: 1 }];
      const thresholds = { low: 1, medium: 2, high: 3 };

      const result = await createMultiSigAccount(MOCK_SECRET, signers, thresholds, 1);

      expect(result).toHaveProperty('publicKey');
      expect(result).toHaveProperty('hash');
      expect(result.success).toBe(true);
      expect(result.signers).toEqual(signers);
      expect(result.thresholds).toEqual(thresholds);
    });
  });

  describe('buildMultiSigTransaction', () => {
    it('should build a transaction and return txId and txXdr', async () => {
      const result = await buildMultiSigTransaction(MOCK_PUBLIC, MOCK_DEST, '100', 'XLM');

      expect(result).toHaveProperty('txId');
      expect(result).toHaveProperty('txXdr');
      expect(result.txId).toMatch(/^multisig-/);
    });

    it('should store the pending transaction', async () => {
      const result = await buildMultiSigTransaction(MOCK_PUBLIC, MOCK_DEST, '50');
      const pending = getPendingTransaction(result.txId);

      expect(pending).not.toBeNull();
      expect(pending.status).toBe('pending');
      expect(pending.sourcePublicKey).toBe(MOCK_PUBLIC);
    });
  });

  describe('addSignature', () => {
    it('should add a signature to a pending transaction', async () => {
      const built = await buildMultiSigTransaction(MOCK_PUBLIC, MOCK_DEST, '75');
      const result = await addSignature(built.txId, MOCK_SECRET);

      expect(result.txId).toBe(built.txId);
      expect(result.totalSignatures).toBe(1);
      expect(result.signatures[0].publicKey).toBe(MOCK_PUBLIC);
    });

    it('should throw if transaction not found', async () => {
      await expect(addSignature('nonexistent-id', MOCK_SECRET)).rejects.toThrow('not found');
    });

    it('should prevent duplicate signatures from same signer', async () => {
      const built = await buildMultiSigTransaction(MOCK_PUBLIC, MOCK_DEST, '25');
      await addSignature(built.txId, MOCK_SECRET);
      await expect(addSignature(built.txId, MOCK_SECRET)).rejects.toThrow('already signed');
    });
  });

  describe('submitMultiSigTransaction', () => {
    it('should submit a pending transaction', async () => {
      const built = await buildMultiSigTransaction(MOCK_PUBLIC, MOCK_DEST, '200');
      await addSignature(built.txId, MOCK_SECRET);
      const result = await submitMultiSigTransaction(built.txId);

      expect(result.txId).toBe(built.txId);
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('hash');
    });

    it('should throw if transaction not found', async () => {
      await expect(submitMultiSigTransaction('bad-id')).rejects.toThrow('not found');
    });

    it('should throw if transaction already submitted', async () => {
      const built = await buildMultiSigTransaction(MOCK_PUBLIC, MOCK_DEST, '10');
      await submitMultiSigTransaction(built.txId);
      await expect(submitMultiSigTransaction(built.txId)).rejects.toThrow('already submitted');
    });
  });

  describe('verifySignatures', () => {
    it('should verify signatures on a transaction XDR', () => {
      const result = verifySignatures('mock-xdr', [MOCK_PUBLIC]);

      expect(result).toHaveProperty('allValid');
      expect(result).toHaveProperty('results');
      expect(result.results[0].publicKey).toBe(MOCK_PUBLIC);
    });
  });

  describe('getMultiSigConfig', () => {
    it('should return signers and thresholds for an account', async () => {
      const config = await getMultiSigConfig(MOCK_PUBLIC);

      expect(config.publicKey).toBe(MOCK_PUBLIC);
      expect(config).toHaveProperty('signers');
      expect(config).toHaveProperty('thresholds');
      expect(config.thresholds).toHaveProperty('low');
      expect(config.thresholds).toHaveProperty('medium');
      expect(config.thresholds).toHaveProperty('high');
    });
  });

  describe('updateMultiSigConfig', () => {
    it('should update thresholds on a multi-sig account', async () => {
      const result = await updateMultiSigConfig(MOCK_SECRET, {
        thresholds: { low: 1, medium: 2, high: 3 },
      });

      expect(result.success).toBe(true);
      expect(result).toHaveProperty('hash');
    });

    it('should add and remove signers', async () => {
      const result = await updateMultiSigConfig(MOCK_SECRET, {
        addSigners: [{ publicKey: MOCK_DEST, weight: 1 }],
        removeSigners: [MOCK_DEST],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getPendingTransactions', () => {
    it('should return all pending transactions for an account', async () => {
      await buildMultiSigTransaction(MOCK_PUBLIC, MOCK_DEST, '300');
      const txs = getPendingTransactions(MOCK_PUBLIC);

      expect(Array.isArray(txs)).toBe(true);
      expect(txs.length).toBeGreaterThan(0);
      expect(txs[0]).toHaveProperty('txId');
      expect(txs[0]).toHaveProperty('status');
    });

    it('should return empty array for unknown account', () => {
      const txs = getPendingTransactions('GUNKNOWNKEY000000000000000000000000000000000000000000000');
      expect(txs).toEqual([]);
    });
  });
});
