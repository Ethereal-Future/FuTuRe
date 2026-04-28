const ERROR_MAP = [
  { match: /insufficient balance/i, message: 'Insufficient balance to complete this payment.' },
  { match: /no account found|account not found|404/i, message: 'Destination account does not exist on the Stellar network.' },
  { match: /network error|failed to fetch|econnrefused|networkerror/i, message: 'Network error — check your connection and try again.' },
  { match: /timeout/i, message: 'Request timed out. The Stellar network may be busy — please retry.' },
  { match: /bad sequence/i, message: 'Transaction sequence error. Please refresh and try again.' },
  { match: /tx_failed/i, message: 'Transaction was rejected by the Stellar network.' },
];

const STELLAR_RESULT_CODES = {
  // Transaction result codes
  tx_success: 'Transaction completed successfully.',
  tx_failed: 'Transaction failed.',
  tx_too_early: 'Transaction timestamp is too early.',
  tx_too_late: 'Transaction timestamp is too late.',
  tx_missing_operation: 'Transaction has no operations.',
  tx_bad_seq: 'Transaction sequence number is invalid.',
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
  op_underfunded: 'Source account has insufficient funds.',
  op_line_full: 'Destination trust line is full.',
  op_self_not_allowed: 'Cannot send to self.',
  op_not_supported: 'Operation type is not supported.',
};

export function getFriendlyError(error) {
  // Check for Stellar SDK result codes first
  const resultCodes = error?.response?.data?.extras?.result_codes;
  if (resultCodes) {
    if (resultCodes.transaction) {
      const txCode = resultCodes.transaction;
      if (STELLAR_RESULT_CODES[txCode]) {
        return STELLAR_RESULT_CODES[txCode];
      }
    }
    if (resultCodes.operations && resultCodes.operations.length > 0) {
      const opCode = resultCodes.operations[0];
      if (STELLAR_RESULT_CODES[opCode]) {
        return STELLAR_RESULT_CODES[opCode];
      }
    }
  }

  // Fall back to string matching
  const raw = error?.response?.data?.error || error?.message || String(error);
  console.error('[Stellar Error]', raw);
  const match = ERROR_MAP.find(e => e.match.test(raw));
  return match ? match.message : `Something went wrong: ${raw}`;
}
