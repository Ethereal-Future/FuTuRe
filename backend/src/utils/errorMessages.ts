const STELLAR_RESULT_CODES: Record<string, string> = {
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

export function getStellarErrorKey(code: string): string | null {
  if (code in STELLAR_RESULT_CODES) return `stellarErrors.${code}`;
  return null;
}

export function getFriendlyError(code: string): string {
  return STELLAR_RESULT_CODES[code] ?? `Unknown error: ${code}`;
}

export { STELLAR_RESULT_CODES };
