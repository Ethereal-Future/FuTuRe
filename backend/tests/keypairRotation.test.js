import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rotateKeypair } from '../src/services/keypairRotation.js';

vi.mock('../src/services/stellar.js', () => ({
  createAccount: vi.fn(),
  mergeAccount: vi.fn(),
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

import { createAccount, mergeAccount } from '../src/services/stellar.js';
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
});
