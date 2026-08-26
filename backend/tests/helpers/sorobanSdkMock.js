import { vi } from 'vitest';

/**
 * Builds a minimal @stellar/stellar-sdk mock covering the surface used by
 * routes/stellar/contract.js (Soroban RPC) and services/federation.js
 * (Keypair, for deriving the platform fee account's public key).
 *
 * Constructor-style exports (Server, Contract, TransactionBuilder) MUST use
 * `function` rather than an arrow function inside vi.fn() — vitest's mock
 * wrapper delegates `new` to the implementation via construct semantics,
 * and arrow functions are not constructible, so `new StellarSDK.rpc.Server()`
 * would throw "is not a constructor" if these were arrows.
 *
 * @param {object} [overrides]
 * @param {import('vitest').Mock} [overrides.rpcServerCtor] - Constructor mock for StellarSDK.rpc.Server
 * @param {import('vitest').Mock} [overrides.keypairFromSecret] - Mock for StellarSDK.Keypair.fromSecret
 */
export function buildStellarSdkMock({ rpcServerCtor, keypairFromSecret } = {}) {
  const defaultRpcServerCtor = vi.fn(function defaultRpcServer() {
    return {
      getAccount: vi.fn(() => Promise.resolve({})),
      simulateTransaction: vi.fn(() => Promise.resolve({})),
      sendTransaction: vi.fn(() => Promise.resolve({})),
    };
  });

  const mockTx = {
    toXDR: vi.fn(() => 'mock-xdr'),
    fee: '100',
  };
  const mockBuilder = {
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn(() => mockTx),
  };

  return {
    rpc: {
      Server: rpcServerCtor || defaultRpcServerCtor,
      Api: { isSimulationError: vi.fn(() => false) },
      assembleTransaction: vi.fn(() => ({ build: vi.fn(() => mockTx) })),
    },
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
    },
    nativeToScVal: vi.fn((v) => v),
    StrKey: { isValidEd25519PublicKey: vi.fn(() => false) },
    Address: { fromString: vi.fn((v) => v) },
    Contract: vi.fn(function MockContract() {
      return { call: vi.fn(() => ({ type: 'mock-operation' })) };
    }),
    TransactionBuilder: Object.assign(
      vi.fn(function MockTransactionBuilder() {
        return mockBuilder;
      }),
      { fromXDR: vi.fn(() => mockTx) },
    ),
    BASE_FEE: '100',
    Keypair: {
      fromSecret: keypairFromSecret || vi.fn(() => ({ publicKey: () => 'GMOCKPUBLICKEY' })),
    },
  };
}
