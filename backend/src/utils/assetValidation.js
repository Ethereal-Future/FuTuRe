/**
 * Asset identifier validation utilities.
 *
 * On the Stellar DEX / AMM endpoints, asset identifiers arrive as route params
 * or query-string values in one of two formats:
 *
 *   • Native XLM  – the string `'XLM'` (case-insensitive)
 *   • Other assets – `'CODE:ISSUER'` where CODE is 1–12 alphanumeric chars and
 *     ISSUER is a valid 56-character ed25519 Stellar public key (starts with 'G').
 *
 * ISSUE-048: Validate all AMM/DEX route parameters to prevent injection of
 * spoofed asset identifiers that could direct the backend to scam/phishing pools.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Asset code regex: 1–12 uppercase or lowercase letters/digits.
 * Stellar allows up to 12-character alphanumeric codes.
 */
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

/**
 * Parse and validate a Stellar asset identifier string.
 *
 * Accepted formats:
 *   - `'XLM'` (native, case-insensitive)
 *   - `'CODE:ISSUER'` where CODE matches `[A-Za-z0-9]{1,12}` and ISSUER is a
 *     valid ed25519 Stellar public key according to the Stellar SDK.
 *
 * @param {string} assetStr - Raw asset string from the request
 * @returns {{ isNative: boolean, code: string, issuer: string|null }} Parsed asset
 * @throws {Error} With a descriptive message if the format is invalid
 */
export function parseAndValidateAsset(assetStr) {
  if (typeof assetStr !== 'string' || !assetStr.trim()) {
    throw new Error('Asset identifier must be a non-empty string.');
  }

  const trimmed = assetStr.trim();

  // Native XLM — must be exactly 'XLM' (case-insensitive).
  if (trimmed.toUpperCase() === 'XLM') {
    return { isNative: true, code: 'XLM', issuer: null };
  }

  // Non-native — must be 'CODE:ISSUER'.
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(
      `Invalid asset format "${trimmed}". ` +
      `Non-native assets must use the format CODE:ISSUER ` +
      `(e.g. "USDC:GABC..."). Only "XLM" is accepted as a native asset.`
    );
  }

  const code   = trimmed.slice(0, colonIdx);
  const issuer = trimmed.slice(colonIdx + 1);

  // Validate asset code.
  if (!ASSET_CODE_RE.test(code)) {
    throw new Error(
      `Invalid asset code "${code}". ` +
      `Asset codes must be 1–12 alphanumeric characters (A-Z, a-z, 0-9).`
    );
  }

  // Validate issuer public key using the Stellar SDK.
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(issuer)) {
    throw new Error(
      `Invalid issuer public key "${issuer}" for asset "${code}". ` +
      `The issuer must be a valid 56-character ed25519 Stellar public key starting with "G".`
    );
  }

  return { isNative: false, code, issuer };
}

/**
 * Express middleware factory that validates one or more named route/query
 * parameters as Stellar asset identifiers.
 *
 * Usage (in a route file):
 *   router.get(
 *     '/arbitrage/:assetA/:assetB',
 *     validateAssetParams('assetA', 'assetB'),
 *     handler
 *   );
 *
 * On validation failure the middleware responds immediately with HTTP 400 and a
 * JSON error body, so the handler never executes.
 *
 * @param {...string} paramNames - Names of `req.params` fields to validate
 * @returns {import('express').RequestHandler}
 */
export function validateAssetParams(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      const raw = req.params[name] ?? req.query[name];
      if (raw === undefined) {
        return res.status(400).json({
          error: `Missing required asset parameter: ${name}`,
        });
      }
      try {
        parseAndValidateAsset(raw);
      } catch (err) {
        return res.status(400).json({
          error: `Invalid asset parameter "${name}": ${err.message}`,
        });
      }
    }
    return next();
  };
}

/**
 * Express middleware factory that validates one or more named **body** fields
 * as Stellar asset identifiers.
 *
 * @param {...string} fieldNames - Names of `req.body` fields to validate
 * @returns {import('express').RequestHandler}
 */
export function validateAssetBody(...fieldNames) {
  return (req, res, next) => {
    for (const name of fieldNames) {
      const raw = req.body?.[name];
      if (raw === undefined) {
        return res.status(400).json({
          error: `Missing required asset field: ${name}`,
        });
      }
      try {
        parseAndValidateAsset(raw);
      } catch (err) {
        return res.status(400).json({
          error: `Invalid asset field "${name}": ${err.message}`,
        });
      }
    }
    return next();
  };
}
