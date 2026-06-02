import { verifyToken } from '../auth/tokens.js';
import prisma from '../db/client.js';

const KYC_LARGE_TRANSACTION_LIMIT = parseFloat(process.env.KYC_LARGE_TRANSACTION_LIMIT ?? '1000');

/**
 * Middleware: block payments above KYC_LARGE_TRANSACTION_LIMIT for users without APPROVED KYC.
 * Expects req.body.amount to be present. Requires a valid Bearer token.
 */
export async function requireKYC(req, res, next) {
  const amount = parseFloat(req.body?.amount);
  if (!amount || amount <= KYC_LARGE_TRANSACTION_LIMIT) return next();

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  let user;
  try {
    user = verifyToken(auth.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const record = await prisma.kYCRecord.findUnique({ where: { userId: user.id } });
  const kycStatus = record?.status ?? 'NONE';

  if (kycStatus !== 'APPROVED') {
    return res.status(403).json({ error: 'KYC_REQUIRED', kycStatus });
  }

  next();
}
