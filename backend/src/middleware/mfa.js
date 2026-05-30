import mfaManager from '../security/mfa.js';

/**
 * Middleware to enforce MFA for high-value operations
 * Checks X-MFA-Token header against user's TOTP secret
 */
export function requireMFA(req, res, next) {
  const mfaToken = req.headers['x-mfa-token'];
  
  if (!mfaToken) {
    return res.status(403).json({ error: 'MFA token required' });
  }

  // Get user's MFA secret from database/store
  // This is a placeholder - in production, fetch from database
  const userMFASecret = req.user?.mfaSecret;
  
  if (!userMFASecret) {
    return res.status(403).json({ error: 'MFA not enabled for this user' });
  }

  try {
    mfaManager.verifyTOTP(req.user.sub, mfaToken, userMFASecret);
    next();
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
}

/**
 * Middleware to optionally check MFA if enabled
 * Allows request to proceed but sets req.mfaVerified flag
 */
export function optionalMFA(req, res, next) {
  const mfaToken = req.headers['x-mfa-token'];
  const userMFASecret = req.user?.mfaSecret;

  req.mfaVerified = false;

  if (mfaToken && userMFASecret) {
    try {
      mfaManager.verifyTOTP(req.user.sub, mfaToken, userMFASecret);
      req.mfaVerified = true;
    } catch (error) {
      // MFA verification failed, but we don't block the request
      // The route handler can decide what to do
    }
  }

  next();
}
