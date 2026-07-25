import crypto from 'crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

class MFAManager {
  constructor() {
    this.userMFA = new Map();
    this.backupCodes = new Map();
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

  enableMFA(userId, secret) {
    const backupCodes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(4).toString('hex')
    );

    this.userMFA.set(userId, {
      secret,
      enabled: true,
      createdAt: new Date(),
      lastUsed: null
    });

    this.backupCodes.set(userId, backupCodes);

    return backupCodes;
  }

  verifyTOTP(userId, token, secret) {
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 2
    });

    if (!verified) {
      throw new Error('Invalid TOTP token');
    }

    const mfa = this.userMFA.get(userId);
    if (mfa) {
      mfa.lastUsed = new Date();
    }
    return true;
  }

  verifyBackupCode(userId, code) {
    const codes = this.backupCodes.get(userId);
    if (!codes) {
      throw new Error('No backup codes found');
    }

    const index = codes.indexOf(code);
    if (index === -1) {
      throw new Error('Invalid backup code');
    }

    codes.splice(index, 1);
    return true;
  }

  disableMFA(userId) {
    this.userMFA.delete(userId);
    this.backupCodes.delete(userId);
  }

  isMFAEnabled(userId) {
    const mfa = this.userMFA.get(userId);
    return mfa ? mfa.enabled : false;
  }
}

export default new MFAManager();
