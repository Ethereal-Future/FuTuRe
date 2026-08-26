import crypto from 'crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import prisma from '../db/client.js';
import { encryptToEnvValue, decryptFromEnvValue } from '../config/secrets.js';
import logger from '../config/logger.js';

class MFAManager {
  constructor() {
    // Removed in-memory storage - now using database
  }

  getEncryptionKey() {
    const key = process.env.CONFIG_ENCRYPTION_KEY;
    if (!key) throw new Error('CONFIG_ENCRYPTION_KEY is not set');
    return key;
  }

  encryptField(value) {
    return encryptToEnvValue(value, this.getEncryptionKey());
  }

  decryptField(value) {
    if (!value) return value;
    try {
      return decryptFromEnvValue(value, this.getEncryptionKey());
    } catch (err) {
      logger.error({ err }, 'Failed to decrypt MFA field');
      return value; // return as-is if decryption fails
    }
  }

  generateSecret(userId, appName = 'FuTuRe') {
    const secret = speakeasy.generateSecret({
      name: `${appName} (${userId})`,
      issuer: appName,
      length: 32
    });

    return {
      secret: secret.base32,
      qrCode: secret.otpauth_url
    };
  }

  async generateQRCode(otpauthUrl) {
    return QRCode.toDataURL(otpauthUrl);
  }

  encryptSecret(secret, encryptionKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decryptSecret(encryptedSecret, encryptionKey) {
    const [ivHex, authTagHex, encrypted] = encryptedSecret.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async enableMFA(userId, secret) {
    const backupCodes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(4).toString('hex')
    );

    // Encrypt and store secret in database
    const encryptedSecret = this.encryptField(secret);
    
    await prisma.mFASettings.upsert({
      where: { userId },
      create: {
        userId,
        secret: encryptedSecret,
        enabled: true,
        createdAt: new Date(),
      },
      update: {
        secret: encryptedSecret,
        enabled: true,
        updatedAt: new Date(),
      },
    });

    // Store backup codes in database (they will be hashed by auth route handler)
    return backupCodes;
  }

  async verifyTOTP(userId, token, secret) {
    let secretToVerify = secret;
    
    // If secret is not provided, fetch from database
    if (!secretToVerify) {
      const mfaSettings = await prisma.mFASettings.findUnique({
        where: { userId },
      });
      
      if (!mfaSettings || !mfaSettings.secret) {
        throw new Error('MFA not enabled for this user');
      }
      
      secretToVerify = this.decryptField(mfaSettings.secret);
    }

    const verified = speakeasy.totp.verify({
      secret: secretToVerify,
      encoding: 'base32',
      token,
      window: 2
    });

    if (!verified) {
      throw new Error('Invalid TOTP token');
    }

    // Update last used timestamp
    await prisma.mFASettings.update({
      where: { userId },
      data: { lastUsed: new Date() },
    });

    return true;
  }

  async verifyBackupCode(userId, code) {
    // Backup codes are now stored in RecoveryCode table
    // This is handled by the auth route handler
    const codes = await prisma.recoveryCode.findMany({
      where: { userId, used: false },
    });

    if (!codes || codes.length === 0) {
      throw new Error('No backup codes found');
    }

    // The actual verification is done in the route handler with bcrypt
    // This method is kept for backward compatibility
    throw new Error('Use recovery code verification endpoint');
  }

  async disableMFA(userId) {
    await prisma.$transaction([
      prisma.mFASettings.update({
        where: { userId },
        data: { enabled: false, secret: null },
      }),
      prisma.recoveryCode.deleteMany({
        where: { userId },
      }),
    ]);
    
    logger.info({ userId }, 'MFA disabled for user');
  }

  async isMFAEnabled(userId) {
    const mfaSettings = await prisma.mFASettings.findUnique({
      where: { userId },
    });
    return mfaSettings ? mfaSettings.enabled : false;
  }

  async getMFASecret(userId) {
    const mfaSettings = await prisma.mFASettings.findUnique({
      where: { userId },
    });
    
    if (!mfaSettings || !mfaSettings.secret) {
      return null;
    }
    
    return this.decryptField(mfaSettings.secret);
  }
}

export default new MFAManager();
