const ERROR_MAP = [
  { match: /insufficient balance/i, message: 'Insufficient balance to complete this payment.' },
  { match: /no account found|account not found|404/i, message: 'Destination account does not exist on the Stellar network.' },
  { match: /network error|failed to fetch|econnrefused|networkerror/i, message: 'Network error — check your connection and try again.' },
  { match: /timeout/i, message: 'Request timed out. The Stellar network may be busy — please retry.' },
  { match: /bad sequence/i, message: 'Transaction sequence error. Please refresh and try again.' },
  { match: /tx_failed/i, message: 'Transaction was rejected by the Stellar network.' },
];

export function getFriendlyError(error) {
  const raw = error?.response?.data?.error || error?.message || String(error);
  console.error('[Stellar Error]', raw);
  const match = ERROR_MAP.find(e => e.match.test(raw));
  return match ? match.message : `Something went wrong: ${raw}`;
}
