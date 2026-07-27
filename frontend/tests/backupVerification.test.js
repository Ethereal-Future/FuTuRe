import { describe, it, expect } from 'vitest';
import {
  encryptBackup,
  parseBackupFile,
  verifyBackupAgainstAccount,
  BACKUP_ERROR_CODES,
} from '../src/utils/backup.js';

const PAYLOAD = {
  publicKey: 'GABC123ACCOUNT',
  secretKey: 'SABC123SECRET',
  accountLabel: 'My Account',
  createdAt: '2026-07-26T00:00:00.000Z',
};
const PASSWORD = 'my-backup-password';

describe('backup verification outcomes', () => {
  it('success: decrypts and matches the currently loaded account', async () => {
    const envelope = await encryptBackup(PAYLOAD, PASSWORD);
    const result = await verifyBackupAgainstAccount(envelope, PASSWORD, PAYLOAD.publicKey);
    expect(result).toEqual({ outcome: 'success', createdAt: envelope.createdAt, backupPublicKey: PAYLOAD.publicKey });
  });

  it('wrong password: rejects with a WRONG_PASSWORD error', async () => {
    const envelope = await encryptBackup(PAYLOAD, PASSWORD);
    await expect(verifyBackupAgainstAccount(envelope, 'not-the-password', PAYLOAD.publicKey)).rejects.toMatchObject({
      code: BACKUP_ERROR_CODES.WRONG_PASSWORD,
    });
  });

  it('corrupted file: parseBackupFile rejects malformed input before verification even begins', () => {
    expect(() => parseBackupFile('{ this is not valid json')).toThrow(
      expect.objectContaining({ code: BACKUP_ERROR_CODES.CORRUPTED_FILE }),
    );
  });

  it('mismatched account: decrypts fine but the public key does not match the current account', async () => {
    const envelope = await encryptBackup(PAYLOAD, PASSWORD);
    const result = await verifyBackupAgainstAccount(envelope, PASSWORD, 'GDIFFERENTACCOUNT');
    expect(result).toEqual({ outcome: 'mismatch', createdAt: envelope.createdAt, backupPublicKey: PAYLOAD.publicKey });
  });

  it('never returns the secret key as part of any outcome', async () => {
    const envelope = await encryptBackup(PAYLOAD, PASSWORD);
    const success = await verifyBackupAgainstAccount(envelope, PASSWORD, PAYLOAD.publicKey);
    const mismatch = await verifyBackupAgainstAccount(envelope, PASSWORD, 'GDIFFERENTACCOUNT');
    expect(success).not.toHaveProperty('secretKey');
    expect(mismatch).not.toHaveProperty('secretKey');
  });
});
