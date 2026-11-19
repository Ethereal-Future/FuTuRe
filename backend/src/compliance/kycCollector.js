import { z } from 'zod';
import prisma from '../db/client.js';
import { encryptToEnvValue, decryptFromEnvValue } from '../config/secrets.js';
import auditLogger from '../security/auditLogger.js';
import { normalizePhoneNumber, isSupportedRegion } from '../utils/phone.js';

const KYC_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', UNDER_REVIEW: 'UNDER_REVIEW' };

const kycSchema = z.object({
  fullName:       z.string().min(1),
  dateOfBirth:    z.string().date(),
  nationality:    z.string().min(1),
  documentType:   z.enum(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'RESIDENCE_PERMIT']),
  documentNumber: z.string().min(1),
  address:        z.string().min(1),
  phoneNumber:    z.string().optional(),
  // ISO 3166-1 alpha-2 region of the phone number; needed for national-format input like '0712345678'
  phoneCountry:   z.string().length(2).optional(),
  email:          z.string().email().optional(),
}).transform((data, ctx) => {
  if (data.phoneNumber === undefined) return data;
  // Fall back to nationality when it is an ISO region code
  const region = data.phoneCountry ?? (isSupportedRegion(data.nationality) ? data.nationality : undefined);
  const phoneNumber = normalizePhoneNumber(data.phoneNumber, region);
  if (!phoneNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phoneNumber'],
      message: 'Invalid phone number; use international format (e.g. +2348031234567) or provide phoneCountry',
    });
    return z.NEVER;
  }
  return { ...data, phoneNumber };
});

function getEncryptionKey() {
  const key = process.env.CONFIG_ENCRYPTION_KEY;
  if (!key) throw new Error('CONFIG_ENCRYPTION_KEY is not set');
  return key;
}

function encryptField(value) {
  return encryptToEnvValue(value, getEncryptionKey());
}

function decryptField(value) {
  if (!value) return value;
  try {
    return decryptFromEnvValue(value, getEncryptionKey());
  } catch {
    return value; // return as-is if not encrypted (migration safety)
  }
}

function decryptRecord(record) {
  if (!record) return record;
  return {
    ...record,
    documentNumber: decryptField(record.documentNumber),
    address: decryptField(record.address),
  };
}

class KYCCollector {
  async submitKYC(userId, data) {
    const parsed = kycSchema.parse(data);
    const dob = new Date(parsed.dateOfBirth);

    const record = await prisma.kYCRecord.upsert({
      where: { userId },
      create: {
        userId,
        status: KYC_STATUS.PENDING,
        fullName: parsed.fullName,
        dateOfBirth: dob,
        nationality: parsed.nationality,
        documentType: parsed.documentType,
        documentNumber: encryptField(parsed.documentNumber),
        address: encryptField(parsed.address),
        phoneNumber: parsed.phoneNumber ?? null,
        email: parsed.email ?? null,
      },
      update: {
        status: KYC_STATUS.PENDING,
        fullName: parsed.fullName,
        dateOfBirth: dob,
        nationality: parsed.nationality,
        documentType: parsed.documentType,
        documentNumber: encryptField(parsed.documentNumber),
        address: encryptField(parsed.address),
        phoneNumber: parsed.phoneNumber ?? null,
        email: parsed.email ?? null,
      },
    });

    return decryptRecord(record);
  }

  async getKYCRecord(userId) {
    const record = await prisma.kYCRecord.findUnique({ where: { userId } });
    return decryptRecord(record);
  }

  async updateStatus(userId, status, note = null) {
    const record = await prisma.kYCRecord.findUnique({ where: { userId } });
    if (!record) throw new Error(`KYC record not found for user ${userId}`);
    const updated = await prisma.kYCRecord.update({
      where: { userId },
      data: { status },
    });
    await auditLogger.logEvent('KYC_STATUS_CHANGED', userId, {
      previousStatus: record.status,
      newStatus: status,
      note: note ?? null,
    }, 'INFO');
    return decryptRecord(updated);
  }

  async isVerified(userId) {
    const record = await prisma.kYCRecord.findUnique({ where: { userId } });
    return record?.status === KYC_STATUS.APPROVED;
  }
}

export { KYC_STATUS };
export default new KYCCollector();
