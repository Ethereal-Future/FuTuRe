interface ErrorMatch {
  match: RegExp;
  message: string;
}

interface ApiError {
  response?: {
    data?: {
      // Standard envelope: { success: false, error: { code, message, details? } }
      error?: string | { code?: string; message?: string; details?: unknown };
      extras?: {
        result_codes?: {
          transaction?: string;
          operations?: string[];
        };
      };
    };
  };
  code?: string;
  message?: string;
  // Normalized shape set by api/client.js interceptor
  normalized?: { message?: string; code?: string };
}

const ERROR_MAP: ErrorMatch[] = [
  { match: /insufficient balance/i, message: 'Insufficient balance to complete this payment.' },
  { match: /no account found|account not found|404/i, message: 'Destination account does not exist on the Stellar network.' },
  { match: /ECONNABORTED|ERR_NETWORK/i, message: 'Connection timed out — please check your internet connection.' },
  { match: /network error|failed to fetch|econnrefused|networkerror/i, message: 'Network error — check your connection and try again.' },
  { match: /timeout/i, message: 'Request timed out. The Stellar network may be busy — please retry.' },
  { match: /bad sequence/i, message: 'Transaction sequence error. Please refresh and try again.' },
  { match: /tx_failed/i, message: 'Transaction was rejected by the Stellar network.' },
];

const STELLAR_RESULT_CODES: Record<string, string> = {
  // Transaction result codes
  tx_success: 'Transaction completed successfully.',
  tx_failed: 'Transaction failed.',
  tx_too_early: 'Transaction timestamp is too early.',
  tx_too_late: 'Transaction timestamp is too late.',
  tx_missing_operation: 'Transaction has no operations.',
  tx_bad_seq: 'Transaction sequence error. Please refresh and try again.',
  tx_bad_auth: 'Transaction authentication failed.',
  tx_insufficient_balance: 'Insufficient balance for this transaction.',
  tx_no_source_account: 'Source account does not exist.',
  tx_insufficient_fee: 'Transaction fee is too low.',
  tx_fee_bump_inner_failed: 'Inner transaction of fee bump failed.',
  tx_bad_auth_extra: 'Extra signers provided but not required.',
  tx_internal_error: 'Internal Stellar network error.',
  tx_not_supported: 'Transaction type is not supported.',
  tx_bad_sponsorship: 'Sponsorship setup is invalid.',
  tx_bad_min_seq_age: 'Minimum sequence age requirement not met.',
  tx_malformed: 'Transaction is malformed.',

  // Operation result codes
  op_success: 'Operation completed successfully.',
  op_inner: 'Operation failed with inner error.',
  op_bad_auth: 'Operation authentication failed.',
  op_no_destination: 'Destination account does not exist.',
  op_no_trust: 'Destination has no trust line for this asset.',
  op_not_authorized: 'Operation not authorized.',
  op_underfunded: 'Insufficient funds — please top up your account.',
  op_line_full: 'Destination trust line is full.',
  op_self_not_allowed: 'Cannot send to your own account.',
  op_not_supported: 'Operation type is not supported.',
  op_too_many_subentries: 'Account has too many subentries.',
  op_exceed_work_limit: 'Operation exceeded the network work limit.',
  op_too_many_sponsoring: 'Too many sponsored entries.',
};

/**
 * Returns the i18n key for a Stellar result code, or null if not recognised.
 * Use with `t(key)` from react-i18next for a translated message.
 * Example: getStellarErrorKey('op_underfunded') → 'stellarErrors.op_underfunded'
 */
export function getStellarErrorKey(code: string): string | null {
  if (code in STELLAR_RESULT_CODES) return `stellarErrors.${code}`;
  return null;
}

export function getFriendlyError(error: unknown): string {
  const err = error as ApiError;

  // Use the normalized message set by the axios interceptor if available.
  if (err?.normalized?.message) return err.normalized.message;

  // Check for Stellar SDK result codes first (Horizon extras)
  const extras = err?.response?.data?.extras;
  if (extras?.result_codes) {
    const { transaction, operations } = extras.result_codes;
    if (transaction && STELLAR_RESULT_CODES[transaction]) {
      return STELLAR_RESULT_CODES[transaction];
    }
    if (operations && operations.length > 0 && STELLAR_RESULT_CODES[operations[0]]) {
      return STELLAR_RESULT_CODES[operations[0]];
    }
  }

  // Handle axios timeout / network error codes
  if (err?.code === 'ECONNABORTED' || err?.code === 'ERR_NETWORK') {
    return 'Connection timed out — please check your internet connection.';
  }

  // Extract message from either the standard envelope { error: { message } } or flat { error: string }
  const responseError = err?.response?.data?.error;
  const rawMessage =
    (typeof responseError === 'object' ? responseError?.message : responseError) ||
    err?.message ||
    String(error);

  console.error('[Stellar Error]', rawMessage);
  const match = ERROR_MAP.find(e => e.match.test(rawMessage));
  return match ? match.message : `Something went wrong: ${rawMessage}`;
}
