/**
 * Map Stellar error codes to user-friendly messages and determine if retryable.
 */

import logger from '../config/logger.js';

const STELLAR_ERROR_MAP = {
  // Permanent errors
  'op_underfunded': {
    userMessage: 'Your account balance was too low to complete this payment.',
    retryable: false,
  },
  'op_no_destination': {
    userMessage: 'The recipient account does not exist on the network.',
    retryable: false,
  },
  'op_no_trust': {
    userMessage: 'The recipient account does not have a trustline for this asset.',
    retryable: false,
  },
  'op_not_authorized': {
    userMessage: 'You are not authorized to send this asset.',
    retryable: false,
  },
  'op_line_full': {
    userMessage: 'The recipient account has reached the balance limit for this asset.',
    retryable: false,
  },
  'op_self_not_allowed': {
    userMessage: 'You cannot send a payment to yourself.',
    retryable: false,
  },
  'op_low_reserve': {
    userMessage: 'This operation would drop your account below the minimum required XLM reserve.',
    retryable: false,
  },
  'op_no_issuer': {
    userMessage: 'The asset issuer for this operation does not exist on the network.',
    retryable: false,
  },
  'op_already_exists': {
    userMessage: 'A trustline for this asset already exists.',
    retryable: false,
  },
  'op_malformed': {
    userMessage: 'The operation was malformed. Please check the details and try again.',
    retryable: false,
  },
  'op_immutable_set': {
    userMessage: 'This account has been permanently locked and can no longer be modified.',
    retryable: false,
  },
  'tx_bad_seq': {
    userMessage: 'The account sequence number is invalid. Please try again.',
    retryable: true,
  },
  'tx_bad_auth': {
    userMessage: 'Transaction authorization failed. Please try again.',
    retryable: true,
  },
  'tx_insufficient_fee': {
    userMessage: 'The transaction fee was too low. Please try with a higher fee.',
    retryable: true,
  },
  'tx_too_late': {
    userMessage: 'The transaction time bounds have expired. Please try again.',
    retryable: true,
  },
  'tx_too_early': {
    userMessage: 'The transaction is too early. Please try again later.',
    retryable: true,
  },

  // Transient errors
  'tx_failed': {
    userMessage: 'The transaction failed on the network. Please try again.',
    retryable: true,
  },
  'connection_error': {
    userMessage: 'Network connection failed. Please check your internet and try again.',
    retryable: true,
  },
  'timeout': {
    userMessage: 'The request timed out. Please try again.',
    retryable: true,
  },
  'rate_limit': {
    userMessage: 'Too many requests. Please try again in a moment.',
    retryable: true,
  },
};

/**
 * Get a user-friendly error message for a Stellar error code.
 * @param {string} errorCode - The error code from Stellar API
 * @returns {{ userMessage: string, retryable: boolean }}
 */
export function getStellarErrorInfo(errorCode) {
  const info = STELLAR_ERROR_MAP[errorCode];
  if (info) return info;

  // An unmapped code is a genuinely unknown/new result code. Presenting a
  // deterministic on-chain rejection as retryable just encourages pointless
  // retries against a failure that will never succeed, so default to
  // non-retryable and log a warning so new codes get visibility. See #953.
  logger.warn('stellarErrors.unmappedCode', { errorCode });
  return {
    userMessage:
      'This transaction could not be completed due to an unrecognized network error. Please contact support if this persists.',
    retryable: false,
  };
}

/**
 * Extract error code from Horizon API error response.
 * @param {Error|object} error - Error object from Horizon API
 * @returns {string} Error code
 */
export function extractStellarErrorCode(error) {
  if (!error) return 'unknown';

  // Check for various error structures
  if (error.status === 400 && error.data?.extras?.result_codes) {
    const resultCodes = error.data.extras.result_codes;
    // Return transaction-level error if available, otherwise operation error
    if (resultCodes.transaction) {
      return resultCodes.transaction;
    }
    if (resultCodes.operations && resultCodes.operations.length > 0) {
      return resultCodes.operations[0];
    }
  }

  if (error.status >= 500) {
    return 'connection_error';
  }

  if (error.name === 'TimeoutError' || error.code === 'ECONNABORTED') {
    return 'timeout';
  }

  if (error.status === 429) {
    return 'rate_limit';
  }

  return 'tx_failed';
}
