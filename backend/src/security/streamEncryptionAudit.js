import { Keypair } from 'stellar-sdk';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Validates that all PaymentStream senderSecret values are encrypted
 * and not raw Stellar secret keys
 */
export async function validateStreamSecretsEncrypted() {
  const streams = await prisma.paymentStream.findMany({
    where: { senderSecret: { not: null } },
  });

  const issues = [];

  for (const stream of streams) {
    if (!stream.senderSecret) continue;

    // Check if it's a valid Stellar secret key (which would be bad)
    try {
      Keypair.fromSecret(stream.senderSecret);
      issues.push({
        streamId: stream.id,
        issue: 'senderSecret is a valid Stellar keypair (not encrypted)',
      });
    } catch {
      // Expected - secret should not be a valid keypair
    }

    // Check if it looks like plaintext (Stellar secrets start with 'S')
    if (stream.senderSecret.startsWith('S') && stream.senderSecret.length === 56) {
      issues.push({
        streamId: stream.id,
        issue: 'senderSecret appears to be plaintext Stellar secret',
      });
    }
  }

  if (issues.length > 0) {
    logger.error({ issues }, 'Found unencrypted senderSecret values in database');
    return { valid: false, issues };
  }

  logger.info({ count: streams.length }, 'All PaymentStream senderSecret values are properly encrypted');
  return { valid: true, count: streams.length };
}

/**
 * Audit function to check encryption consistency
 */
export async function auditStreamEncryption() {
  const result = await validateStreamSecretsEncrypted();
  
  if (!result.valid) {
    throw new Error(`Encryption audit failed: ${result.issues.length} unencrypted secrets found`);
  }

  return result;
}
