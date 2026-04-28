import { z } from 'zod';
import prisma from '../db/client.js';

const KYC_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', UNDER_REVIEW: 'UNDER_REVIEW' };

const kycSchema = z.object({
  fullName:       z.string().min(1),
  dateOfBirth:    z.string().date(),
  nationality:    z.string().min(1),
  documentType:   z.enum(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'RESIDENCE_PERMIT']),
  documentNumber: z.string().min(1),
  address:        z.string().min(1),
  phoneNumber:    z.string().regex(/^\+[1-9]\d{1,14}$/).optional(),
  email:          z.string().email().optional(),
});

class KYCCollector {
  async submitKYC(userId, data) {
    const parsed = kycSchema.parse(data);
    const dob = new Date(parsed.dateOfBirth);

    return prisma.kYCRecord.upsert({
      where: { userId },
      create: {
        userId,
        status: KYC_STATUS.PENDING,
        fullName: parsed.fullName,
        dateOfBirth: dob,
        nationality: parsed.nationality,
        documentType: parsed.documentType,
        documentNumber: parsed.documentNumber,
        address: parsed.address,
        phoneNumber: parsed.phoneNumber ?? null,
        email: parsed.email ?? null,
      },
      update: {
        status: KYC_STATUS.PENDING,
        fullName: parsed.fullName,
        dateOfBirth: dob,
        nationality: parsed.nationality,
        documentType: parsed.documentType,
        documentNumber: parsed.documentNumber,
        address: parsed.address,
        phoneNumber: parsed.phoneNumber ?? null,
        email: parsed.email ?? null,
      },
    });
  }

  async getKYCRecord(userId) {
    return prisma.kYCRecord.findUnique({ where: { userId } });
  }

  async updateStatus(userId, status, note = null) {
    const record = await this.getKYCRecord(userId);
    if (!record) throw new Error(`KYC record not found for user ${userId}`);
    return prisma.kYCRecord.update({
      where: { userId },
      data: { status },
    });
  }

  async isVerified(userId) {
    const record = await this.getKYCRecord(userId);
    return record?.status === KYC_STATUS.APPROVED;
  }
}

export { KYC_STATUS };
export default new KYCCollector();
