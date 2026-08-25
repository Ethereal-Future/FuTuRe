import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rotateKeypair, KeypairRotationBlockedError } from '../src/services/keypairRotation.js';

vi.mock('../src/services/stellar.js', () => ({
  createAccount: vi.fn(),
  mergeAccount: vi.fn(),
  getTrustlines: vi.fn(),
  getOpenOffers: vi.fn(),
  isTestnet: vi.fn(() => true),
}));

vi.mock('../src/db/client.js', () => ({
  default: { $transaction: vi.fn(), user: { update: vi.fn() } },
}));

vi.mock('../src/security/index.js', () => ({
  auditLogger: { logSecurityEvent: vi.fn() },
}));

vi.mock('../src/notifications/service.js', () => ({
  sendNotification: vi.fn(),
}));

vi.mock('../src/config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { createAccount, mergeAccount, getTrustlines, getOpenOffers } from '../src/services/stellar.js';
import prisma from '../src/db/client.js';
import { auditLogger } from '../src/security/index.js';
import { sendNotification } from '../src/notifications/service.js';

const OLD_PUBLIC = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OLD_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NEW_PUBLIC = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const NEW_SECRET = 'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const MERGE_HASH = 'abc123mergehash';

const BASE_OPTS = {
  oldPublicKey: OLD_PUBLIC,
  oldSecretKey: OLD_SECRET,
  userId: 'user-1',
  adminEmail: 'admin@example.com',
  correlationId: 'corr-1',
};

describe('rotateKeypair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAccount.mockResolvedValue({ publicKey: NEW_PUBLIC, secretKey: NEW_SECRET });
    mergeAccount.mockResolvedValue({ hash: MERGE_HASH, ledger: 100, successful: true });
    getTrustlines.mockResolvedValue([]);
    getOpenOffers.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((fn) => fn(prisma));
    prisma.user = { update: vi.fn().mockResolvedValue({}) };
    auditLogger.logSecurityEvent.mockResolvedValue({});
    sendNotification.mockResolvedValue({});
  });

  it('returns new keypair and merge hash on success', async () => {
    const result = await rotateKeypair(BASE_OPTS);

    expect(result).toEqual({
      newPublicKey: NEW_PUBLIC,
      newSecretKey: NEW_SECRET,
      mergeHash: MERGE_HASH,
    });
  });

  it('calls createAccount then mergeAccount with correct args', async () => {
    await rotateKeypair(BASE_OPTS);

    expect(createAccount).toHaveBeenCalledWith('corr-1');
    expect(mergeAccount).toHaveBeenCalledWith(OLD_SECRET, NEW_PUBLIC);
  });

  it('updates DB with new public key after successful merge', async () => {
    await rotateKeypair(BASE_OPTS);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { publicKey: OLD_PUBLIC },
      data: { publicKey: NEW_PUBLIC },
    });
  });

  it('emits KEYPAIR_ROTATE audit log', async () => {
    await rotateKeypair(BASE_OPTS);

    expect(auditLogger.logSecurityEvent).toHaveBeenCalledWith(
      'KEYPAIR_ROTATE',
      'user-1',
      expect.objectContaining({
        oldPublicKey: OLD_PUBLIC,
        newPublicKey: NEW_PUBLIC,
        mergeHash: MERGE_HASH,
      })
    );
  });

  it('sends email notification to adminEmail', async () => {
    await rotateKeypair(BASE_OPTS);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'admin@example.com', channels: ['email'] })
    );
  });

  it('throws and does NOT update DB if createAccount fails', async () => {
    createAccount.mockRejectedValue(new Error('Friendbot down'));

    await expect(rotateKeypair(BASE_OPTS)).rejects.toThrow('Failed to create new account');
    expect(mergeAccount).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws and does NOT update DB if mergeAccount fails (rollback)', async () => {
    mergeAccount.mockRejectedValue(new Error('tx failed'));

    await expect(rotateKeypair(BASE_OPTS)).rejects.toThrow(
      'Balance transfer failed — rotation rolled back'
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditLogger.logSecurityEvent).not.toHaveBeenCalled();
  });

  it('throws with critical message if DB update fails after successful merge', async () => {
    prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

    await expect(rotateKeypair(BASE_OPTS)).rejects.toThrow(
      'DB update failed after successful balance transfer'
    );
  });

  it('does not throw if audit log fails (non-fatal)', async () => {
    auditLogger.logSecurityEvent.mockRejectedValue(new Error('audit unavailable'));

    await expect(rotateKeypair(BASE_OPTS)).resolves.toMatchObject({ newPublicKey: NEW_PUBLIC });
  });

  it('does not throw if email notification fails (non-fatal)', async () => {
    sendNotification.mockRejectedValue(new Error('SMTP error'));

    await expect(rotateKeypair(BASE_OPTS)).resolves.toMatchObject({ newPublicKey: NEW_PUBLIC });
  });

  it('skips email notification when adminEmail is not provided', async () => {
    await rotateKeypair({ ...BASE_OPTS, adminEmail: undefined });

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('checks trustlines and offers before creating a new account', async () => {
    await rotateKeypair(BASE_OPTS);

    expect(getTrustlines).toHaveBeenCalledWith(OLD_PUBLIC);
    expect(getOpenOffers).toHaveBeenCalledWith(OLD_PUBLIC);
  });

  it('fails fast with KeypairRotationBlockedError when a non-zero trustline exists, without creating a new account', async () => {
    getTrustlines.mockResolvedValue([
      { assetCode: 'USDC', issuer: 'GISSUER', balance: '10.0000000', limit: '1000', authorized: true },
    ]);

    await expect(rotateKeypair(BASE_OPTS)).rejects.toThrow(KeypairRotationBlockedError);
    expect(createAccount).not.toHaveBeenCalled();
    expect(mergeAccount).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails fast with KeypairRotationBlockedError when an open offer exists, without creating a new account', async () => {
    getOpenOffers.mockResolvedValue([{ id: '1', selling: {}, buying: {} }]);

    await expect(rotateKeypair(BASE_OPTS)).rejects.toThrow(KeypairRotationBlockedError);
    expect(createAccount).not.toHaveBeenCalled();
    expect(mergeAccount).not.toHaveBeenCalled();
  });

  it('ignores a zero-balance trustline and proceeds with rotation', async () => {
    getTrustlines.mockResolvedValue([
      { assetCode: 'USDC', issuer: 'GISSUER', balance: '0.0000000', limit: '1000', authorized: true },
    ]);

    await expect(rotateKeypair(BASE_OPTS)).resolves.toMatchObject({ newPublicKey: NEW_PUBLIC });
    expect(createAccount).toHaveBeenCalled();
  });

  it('surfaces the error and does not proceed if the mergeability precheck itself fails', async () => {
    getTrustlines.mockRejectedValue(new Error('Horizon unreachable'));

    await expect(rotateKeypair(BASE_OPTS)).rejects.toThrow('Failed to verify account is mergeable');
    expect(createAccount).not.toHaveBeenCalled();
  });
});
