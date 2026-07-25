import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, { connectDB, disconnectDB } from '../src/db/client.js';

// Skip if no DATABASE_URL is set
const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)('Database Integration: Prisma + Postgres', () => {
  beforeAll(async () => {
    await connectDB();
    // In a real integration test, we might run migrations here or use a shadow DB
  });

  afterAll(async () => {
    await disconnectDB();
  });

  it('should create and retrieve a user', async () => {
    const publicKey = 'G' + Math.random().toString(36).substring(2, 12).toUpperCase();
    
    const user = await prisma.user.create({
      data: { publicKey }
    });

    expect(user).toHaveProperty('id');
    expect(user.publicKey).toBe(publicKey);

    const retrieved = await prisma.user.findUnique({
      where: { id: user.id }
    });
    expect(retrieved.publicKey).toBe(publicKey);
  });

  it('should manage user settings with cascade delete', async () => {
    const user = await prisma.user.create({
      data: { 
        publicKey: 'G' + Math.random().toString(36).substring(2, 12).toUpperCase(),
        settings: {
          create: { defaultAsset: 'USDC' }
        }
      },
      include: { settings: true }
    });

    expect(user.settings.defaultAsset).toBe('USDC');

    // Delete user and verify settings are gone
    await prisma.user.delete({ where: { id: user.id } });
    
    const settings = await prisma.setting.findUnique({
      where: { userId: user.id }
    });
    expect(settings).toBeNull();
  });

  it('should record a transaction between two users', async () => {
    const sender = await prisma.user.create({ data: { publicKey: 'GSENDER' + Math.random().toString(36).substring(2, 12).toUpperCase() } });
    const recipient = await prisma.user.create({ data: { publicKey: 'GRECIPIENT' + Math.random().toString(36).substring(2, 12).toUpperCase() } });
    
    const txHash = 'hash' + Math.random().toString(36).substring(2, 12);

    const tx = await prisma.transaction.create({
      data: {
        hash: txHash,
        amount: 100.50,
        senderId: sender.id,
        recipientId: recipient.id,
        successful: true
      }
    });

    expect(tx.senderId).toBe(sender.id);
    expect(tx.recipientId).toBe(recipient.id);
    expect(tx.amount.toString()).toBe('100.5');
  });
});

if (!hasDb) {
  describe('Database Integration: Prisma + Postgres', () => {
    it.skip('Skipped: DATABASE_URL not set', () => {});
  });
}
