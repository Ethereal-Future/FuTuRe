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

  verifyTOTP(userId, token) {
    const mfa = this.userMFA.get(userId);
    if (!mfa || !mfa.enabled) {
      throw new Error('MFA not enabled for user');
    }

    const verified = speakeasy.totp.verify({
      secret: mfa.secret,
      encoding: 'base32',
      token,
      window: 2
    });

    if (!verified) {
      throw new Error('Invalid TOTP token');
    }

    mfa.lastUsed = new Date();
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
