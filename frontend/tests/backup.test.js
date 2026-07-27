import { describe, it, expect } from 'vitest';
import {
  encryptBackup,
  decryptBackup,
  serializeBackupFile,
  parseBackupFile,
  BACKUP_ERROR_CODES,
} from '../src/utils/backup.js';

const PAYLOAD = {
  publicKey: 'GABC123',
  secretKey: 'SABC123',
  accountLabel: 'My Account',
  createdAt: '2026-07-26T00:00:00.000Z',
};

describe('backup encryption round trip', () => {
  it('encrypts and decrypts a payload with the correct password', async () => {
    const envelope = await encryptBackup(PAYLOAD, 'correct horse battery staple');
    const decrypted = await decryptBackup(envelope, 'correct horse battery staple');
    expect(decrypted).toEqual(PAYLOAD);
  });

  it('serialises and parses the envelope without losing data', async () => {
    const envelope = await encryptBackup(PAYLOAD, 'my-backup-password');
    const json = serializeBackupFile(envelope);
    const parsed = parseBackupFile(json);
    const decrypted = await decryptBackup(parsed, 'my-backup-password');
    expect(decrypted).toEqual(PAYLOAD);
  });

  it('throws a WRONG_PASSWORD error when decrypting with an incorrect password', async () => {
    const envelope = await encryptBackup(PAYLOAD, 'my-backup-password');
    await expect(decryptBackup(envelope, 'wrong-password')).rejects.toMatchObject({
      code: BACKUP_ERROR_CODES.WRONG_PASSWORD,
    });
  });

  it('throws a CORRUPTED_FILE error for malformed JSON', () => {
    expect(() => parseBackupFile('not json')).toThrow(
      expect.objectContaining({ code: BACKUP_ERROR_CODES.CORRUPTED_FILE }),
    );
  });

  it('throws a CORRUPTED_FILE error when required envelope fields are missing', () => {
    expect(() => parseBackupFile(JSON.stringify({ version: 1 }))).toThrow(
      expect.objectContaining({ code: BACKUP_ERROR_CODES.CORRUPTED_FILE }),
    );
  });
});
