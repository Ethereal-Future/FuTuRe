import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KYC_DIR = path.join(__dirname, '../../data/kyc');

const KYC_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', UNDER_REVIEW: 'UNDER_REVIEW' };

class KYCCollector {
  async initialize() {
    await fs.mkdir(KYC_DIR, { recursive: true });
  }

  _filePath(userId) {
    return path.join(KYC_DIR, `${userId}.json`);
  }

  _normalizeDateOfBirth(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error('dateOfBirth must be a valid date');
    const today = new Date();
    if (parsed > today) throw new Error('dateOfBirth cannot be in the future');
    return parsed.toISOString();
  }

  async submitKYC(userId, data) {
    await this.initialize();

    const required = ['fullName', 'dateOfBirth', 'nationality', 'documentType', 'documentNumber', 'address'];
    const missing = required.filter(f => !data[f]);
    if (missing.length) throw new Error(`Missing required KYC fields: ${missing.join(', ')}`);
    const dateOfBirth = this._normalizeDateOfBirth(data.dateOfBirth);

    const record = {
      userId,
      status: KYC_STATUS.PENDING,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: {
        fullName: data.fullName,
        dateOfBirth,
        nationality: data.nationality,
        documentType: data.documentType,   // PASSPORT | NATIONAL_ID | DRIVERS_LICENSE
        documentNumber: data.documentNumber,
        address: data.address,
        phoneNumber: data.phoneNumber || null,
        email: data.email || null,
      },
      verificationNotes: [],
    };

    await fs.writeFile(this._filePath(userId), JSON.stringify(record, null, 2));
    return record;
  }

  async getKYCRecord(userId) {
    await this.initialize();
    try {
      const content = await fs.readFile(this._filePath(userId), 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async updateStatus(userId, status, note = null) {
    const record = await this.getKYCRecord(userId);
    if (!record) throw new Error(`KYC record not found for user ${userId}`);

    record.status = status;
    record.updatedAt = new Date().toISOString();
    if (note) record.verificationNotes.push({ timestamp: new Date().toISOString(), note });

    await fs.writeFile(this._filePath(userId), JSON.stringify(record, null, 2));
    return record;
  }

  async isVerified(userId) {
    const record = await this.getKYCRecord(userId);
    return record?.status === KYC_STATUS.APPROVED;
  }
}

export { KYC_STATUS };
export default new KYCCollector();
