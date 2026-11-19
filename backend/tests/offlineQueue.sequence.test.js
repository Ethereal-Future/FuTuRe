import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';

vi.mock('../src/config/stellar.js', () => ({
  horizonServer: {
    loadAccount: vi.fn(),
    submitTransaction: vi.fn(),
  },
  networkPassphrase: StellarSDK.Networks.TESTNET,
}));

vi.mock('../src/services/stellar.js', () => ({
  sendPayment: vi.fn(),
}));

const { default: offlineQueue } = await import('../src/mobile/offlineQueue.js');
const { horizonServer } = await import('../src/config/stellar.js');
const StellarService = await import('../src/services/stellar.js');

describe('offlineQueue flushQueue sequence drift (#1377)', () => {
  const userId = 'user-seq-drift';

  beforeEach(() => {
    offlineQueue.queues.clear();
    offlineQueue.persistenceEnabled = false;
    vi.clearAllMocks();
  });

  it('detects sequence drift on signed XDR and returns SEQUENCE_MISMATCH resign prompt', async () => {
    const source = StellarSDK.Keypair.random();
    const dest = StellarSDK.Keypair.random();

    // Build a signed tx with stale sequence 10
    const account = new StellarSDK.Account(source.publicKey(), '9'); // next seq = 10
    const tx = new StellarSDK.TransactionBuilder(account, {
      fee: StellarSDK.BASE_FEE,
      networkPassphrase: StellarSDK.Networks.TESTNET,
    })
      .addOperation(
        StellarSDK.Operation.payment({
          destination: dest.publicKey(),
          asset: StellarSDK.Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build();
    tx.sign(source);
    const signedXdr = tx.toXDR();

    offlineQueue.enqueue(userId, { signedXdr });

    // Live account last-used sequence is 15 → next expected is 16
    horizonServer.loadAccount.mockResolvedValue({
      sequenceNumber: () => '15',
      accountId: source.publicKey(),
    });

    const outcome = await offlineQueue.flushQueue(userId);

    expect(outcome.requiresResign).toBe(true);
    expect(outcome.results[0].status).toBe('SEQUENCE_MISMATCH');
    expect(outcome.sequenceDrift.code).toBe('SEQUENCE_MISMATCH');
    expect(outcome.sequenceDrift.expectedSequence).toBe('16');
    expect(outcome.sequenceDrift.embeddedSequence).toBe('10');
    expect(outcome.sequenceDrift.resignPayload.suggestedSequence).toBe('16');
    expect(horizonServer.submitTransaction).not.toHaveBeenCalled();
  });

  it('re-sequences server-signed delegated payments using live Horizon state', async () => {
    const source = StellarSDK.Keypair.random();
    const dest = StellarSDK.Keypair.random();

    offlineQueue.enqueue(userId, {
      sourceSecret: source.secret(),
      destination: dest.publicKey(),
      amount: '2',
      assetCode: 'XLM',
      sequence: '5', // stale
    });

    horizonServer.loadAccount.mockResolvedValue({
      sequenceNumber: () => '20',
      accountId: source.publicKey(),
    });
    StellarService.sendPayment.mockResolvedValue({ success: true, hash: 'abc123' });

    const outcome = await offlineQueue.flushQueue(userId);

    expect(outcome.requiresResign).toBe(false);
    expect(outcome.results[0].status).toBe('success');
    expect(outcome.results[0].hash).toBe('abc123');
    expect(StellarService.sendPayment).toHaveBeenCalledOnce();
  });
});
