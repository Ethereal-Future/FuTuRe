/**
 * Component test utilities
 * Shared render helpers, mock factories, and accessibility query shortcuts.
 */

import { render } from '@testing-library/react';
import { fakeStellarKeypair, fakeStellarPublicKey } from '../../../testing/privacy.js';

/**
 * Thin render wrapper — returns all RTL queries plus the container.
 * Use fireEvent from @testing-library/react for interactions.
 */
export function renderWithUser(ui, options = {}) {
  return render(ui, options);
}

/**
 * Mock axios module factory — returns jest-compatible vi.fn() stubs.
 * Usage: vi.mock('axios', () => createAxiosMock())
 */
export function createAxiosMock(overrides = {}) {
  return {
    default: {
      get: vi.fn(),
      post: vi.fn(),
      ...overrides,
    },
  };
}

/** Stub account returned by POST /api/stellar/account/create */
export const mockAccount = fakeStellarKeypair();

/** Stub balance returned by GET /api/stellar/account/:publicKey */
export const mockBalance = {
  publicKey: mockAccount.publicKey,
  balances: [{ asset: 'XLM', balance: '9999.0000000' }],
};

/** Stub payment result returned by POST /api/stellar/payment/send */
export const mockPaymentResult = {
  hash: 'a'.repeat(64),
  ledger: 12345,
  success: true,
};

/** A valid Stellar public key for a recipient */
export const mockRecipient = fakeStellarPublicKey();

/** Network status stub */
export const mockNetworkStatus = {
  network: 'testnet',
  online: true,
  horizonUrl: 'https://horizon-testnet.stellar.org',
  horizonVersion: '2.28.0',
  currentProtocolVersion: 21,
};
