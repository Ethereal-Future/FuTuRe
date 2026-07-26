/**
 * Parse a SEP-0007 web+stellar URI according to the specification
 * @see https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md
 *
 * Examples:
 * - web+stellar:pay?destination=GBUQWP3BOUZX34ULNQG23RQ6F4BWFIDBMSCFF336W3SKHT4UX7EASUP&amount=100
 * - web+stellar:pay?destination=GBUQWP3BOUZX34ULNQG23RQ6F4BWFIDBMSCFF336W3SKHT4UX7EASUP&amount=50.50&memo=Invoice%20123&memo_type=text
 * - web+stellar:pay?destination=G...&amount=100&asset_code=USDC&asset_issuer=GBUQWP3BOUZX34ULNQG23RQ6F4BWFIDBMSCFF336W3SKHT4UX7EASUP
 *
 * @param {string} uri - The web+stellar: URI
 * @returns {Object} Parsed payment request with validation
 *   {
 *     valid: boolean,
 *     error: string|null,
 *     destination: string,
 *     amount: string|null,
 *     memo: string|null,
 *     memoType: string|null,
 *     assetCode: string,
 *     assetIssuer: string|null,
 *     originDomain: string|null,
 *     message: string|null,
 *     callbackUrl: string|null
 *   }
 */
export function parseSep7Uri(uri) {
  const result = {
    valid: false,
    error: null,
    destination: null,
    amount: null,
    memo: null,
    memoType: null,
    assetCode: 'XLM',
    assetIssuer: null,
    originDomain: null,
    message: null,
    callbackUrl: null,
  };

  if (!uri || typeof uri !== 'string') {
    result.error = 'Invalid URI: URI must be a non-empty string';
    return result;
  }

  const prefix = 'web+stellar:';
  if (!uri.startsWith(prefix)) {
    result.error = 'Invalid URI: Must start with web+stellar:';
    return result;
  }

  const operationAndParams = uri.slice(prefix.length);
  const [operation, paramsStr] = operationAndParams.split('?', 2);

  if (operation !== 'pay') {
    result.error = `Unsupported operation: ${operation}. Currently only 'pay' is supported.`;
    return result;
  }

  if (!paramsStr) {
    result.error = 'Invalid URI: Missing query parameters';
    return result;
  }

  try {
    const params = new URLSearchParams(paramsStr);

    // Required: destination
    const destination = params.get('destination');
    if (!destination) {
      result.error = 'Missing required parameter: destination';
      return result;
    }
    if (!/^G[A-Z2-7]{55}$/.test(destination)) {
      result.error = 'Invalid destination: Not a valid Stellar public key';
      return result;
    }
    result.destination = destination;

    // Optional: amount (must be a valid number if provided)
    const amount = params.get('amount');
    if (amount !== null) {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum < 0) {
        result.error = 'Invalid amount: Must be a non-negative number';
        return result;
      }
      result.amount = amount;
    }

    // Optional: asset
    const assetCode = params.get('asset_code');
    const assetIssuer = params.get('asset_issuer');

    if (assetCode && assetIssuer) {
      // Both must be provided for non-native assets
      if (!/^G[A-Z2-7]{55}$/.test(assetIssuer)) {
        result.error = 'Invalid asset_issuer: Not a valid Stellar public key';
        return result;
      }
      result.assetCode = assetCode;
      result.assetIssuer = assetIssuer;
    } else if (assetCode || assetIssuer) {
      // Can't have just one
      result.error = 'Invalid asset: Both asset_code and asset_issuer must be provided together';
      return result;
    }

    // Optional: memo
    const memo = params.get('memo');
    const memoType = params.get('memo_type') || 'text';

    if (memo !== null) {
      const validMemoTypes = ['text', 'id', 'hash', 'return'];
      if (!validMemoTypes.includes(memoType)) {
        result.error = `Invalid memo_type: Must be one of ${validMemoTypes.join(', ')}`;
        return result;
      }

      // Validate memo format based on type
      if (memoType === 'id') {
        const memoNum = parseInt(memo, 10);
        if (isNaN(memoNum) || memoNum < 0 || memoNum > Number.MAX_SAFE_INTEGER) {
          result.error = 'Invalid memo: ID memo must be a non-negative integer';
          return result;
        }
      } else if (memoType === 'hash' || memoType === 'return') {
        if (!/^[A-Za-z0-9+/=]{88}$/.test(memo)) {
          result.error = `Invalid memo: ${memoType} memo must be a 64-byte value encoded in base64`;
          return result;
        }
      }

      result.memo = memo;
      result.memoType = memoType;
    }

    // Optional: origin domain (for security validation)
    const originDomain = params.get('origin_domain');
    if (originDomain) {
      result.originDomain = originDomain;
    }

    // Optional: message (user-facing)
    const message = params.get('message');
    if (message) {
      result.message = message;
    }

    // Optional: callback URL
    const callback = params.get('callback');
    if (callback) {
      try {
        new URL(callback);
        result.callbackUrl = callback;
      } catch {
        result.error = 'Invalid callback: Must be a valid URL';
        return result;
      }
    }

    result.valid = true;
    return result;
  } catch (error) {
    result.error = `Failed to parse URI: ${error.message}`;
    return result;
  }
}

/**
 * Validate a parsed SEP-0007 request
 * @param {Object} parsed - Result from parseSep7Uri
 * @returns {boolean} Whether the request is valid
 */
export function validateSep7Request(parsed) {
  return parsed.valid && parsed.destination !== null;
}

/**
 * Extract origin domain from a full URL for verification
 * @param {string} url - Full URL or domain
 * @returns {string} Domain without protocol
 */
export function extractOriginDomain(url) {
  try {
    const urlObj = new URL(url.includes('://') ? url : `https://${url}`);
    return urlObj.hostname;
  } catch {
    return url;
  }
}
