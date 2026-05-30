import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../src/db/client.js';
import { createStream } from '../src/services/streaming.js';
import { Keypair } from 'stellar-sdk';

describe('PaymentStream Encryption', () => {
  let senderKeypair;
  let recipientKeypair;

  beforeEach(() => {
    senderKeypair = Keypair.random();
    recipientKeypair = Keypair.random();
  });

  it('should encrypt senderSecret on write', async () => {
    const stream = await createStream({
      senderPublicKey: senderKeypair.publicKey(),
      senderSecret: senderKeypair.secret(),
      recipientPublicKey: recipientKeypair.publicKey(),
      assetCode: 'XLM',
      rateAmount: 10,
      intervalSeconds: 60,
    });

    // Read directly from database
    const dbStream = await prisma.paymentStream.findUnique({
      where: { id: stream.id },
    });

    // Verify senderSecret is encrypted (not a valid Stellar secret key)
    expect(dbStream.senderSecret).toBeDefined();
    expect(dbStream.senderSecret).not.toBe(senderKeypair.secret());
    
    // Verify it's not a valid Stellar keypair
    expect(() => {
      Keypair.fromSecret(dbStream.senderSecret);
    }).toThrow();
  });

  it('should not store raw Stellar secret keys in database', async () => {
    const stream = await createStream({
      senderPublicKey: senderKeypair.publicKey(),
      senderSecret: senderKeypair.secret(),
      recipientPublicKey: recipientKeypair.publicKey(),
      assetCode: 'XLM',
      rateAmount: 10,
      intervalSeconds: 60,
    });

    const dbStream = await prisma.paymentStream.findUnique({
      where: { id: stream.id },
    });

    // Attempt to use the stored secret as a Stellar keypair should fail
    let isValidKeypair = false;
    try {
      Keypair.fromSecret(dbStream.senderSecret);
      isValidKeypair = true;
    } catch {
      isValidKeypair = false;
    }

    expect(isValidKeypair).toBe(false);
  });

  it('should store encrypted ciphertext that is not plaintext', async () => {
    const secretKey = senderKeypair.secret();
    
    const stream = await createStream({
      senderPublicKey: senderKeypair.publicKey(),
      senderSecret: secretKey,
      recipientPublicKey: recipientKeypair.publicKey(),
      assetCode: 'XLM',
      rateAmount: 10,
      intervalSeconds: 60,
    });

    const dbStream = await prisma.paymentStream.findUnique({
      where: { id: stream.id },
    });

    // Verify the stored value is different from the original
    expect(dbStream.senderSecret).not.toContain(secretKey);
    
    // Verify it looks like ciphertext (contains non-alphanumeric characters or is base64-like)
    expect(dbStream.senderSecret.length).toBeGreaterThan(secretKey.length);
  });
});
