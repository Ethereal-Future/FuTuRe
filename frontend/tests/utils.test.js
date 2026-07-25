import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateAmount, formatAmount } from '../src/utils/validateAmount';
import { formatBalance, formatBalanceWithAsset } from '../src/utils/formatBalance';
import { isValidStellarAddress } from '../src/utils/validateStellarAddress';
import { getFriendlyError } from '../src/utils/errorMessages';
import { highlightSearchTerms, filterTransactions } from '../src/utils/searchHighlighter';

// ── validateAmount ────────────────────────────────────────────────────────────
describe('validateAmount', () => {
  // falsy / empty → null (no validation)
  it('returns null for empty string', () => expect(validateAmount('', null)).toBeNull());
  it('returns null for undefined', () => expect(validateAmount(undefined, null)).toBeNull());
  it('returns null for null', () => expect(validateAmount(null, null)).toBeNull());

  // scientific notation
  it('rejects scientific notation (e)', () => expect(validateAmount('1e5', null)).toMatch(/scientific/i));
  it('rejects scientific notation (E)', () => expect(validateAmount('1E5', null)).toMatch(/scientific/i));

  // non-positive
  it('rejects zero', () => expect(validateAmount('0', null)).toMatch(/positive/i));
  it('rejects negative', () => expect(validateAmount('-1', null)).toMatch(/positive/i));
  it('rejects NaN string', () => expect(validateAmount('abc', null)).toMatch(/positive/i));
  it('rejects bare dot', () => expect(validateAmount('.', null)).toMatch(/positive/i));

  // below minimum
  it('rejects amount below 0.0000001', () => expect(validateAmount('0.00000001', null)).toMatch(/minimum/i));

  // decimal places
  it('rejects more than 7 decimal places', () => expect(validateAmount('1.12345678', null)).toMatch(/decimal/i));
  it('accepts exactly 7 decimal places', () => expect(validateAmount('1.1234567', null)).toBeNull());

  // minimum valid amount
  it('accepts 0.0000001 (minimum)', () => expect(validateAmount('0.0000001', null)).toBeNull());

  // balance check skipped when null
  it('skips balance check when availableBalance is null', () => expect(validateAmount('999999', null)).toBeNull());

  // exceeds balance
  it('rejects amount exceeding available balance', () => expect(validateAmount('100', 50)).toMatch(/exceeds/i));

  // minimum reserve: balance - amount - fee < 1 XLM
  // With balance=50, amount=49, fee=0.00001: 50 - 49 - 0.00001 = 0.99999 < 1 → reserve error
  it('rejects when remaining balance would fall below 1 XLM reserve', () =>
    expect(validateAmount('49', 50)).toMatch(/reserve/i));

  // valid with balance: balance - amount - fee >= 1 XLM
  // With balance=52, amount=50, fee=0.00001: 52 - 50 - 0.00001 = 1.99999 >= 1 → valid
  it('accepts amount that leaves sufficient reserve', () => expect(validateAmount('50', 52)).toBeNull());

  // Property: any valid positive number with ≤7 decimals, no 'e', ≥ 0.0000001, with null balance → null
  it('property: valid amounts always return null (no balance check)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9_000_000 }).map(n => String(n)),
        (amount) => validateAmount(amount, null) === null
      ),
      { numRuns: 200 }
    );
  });

  // Property: scientific notation always rejected
  it('property: scientific notation always rejected', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 1, max: 1e10, noNaN: true }).map(n => n.toExponential()),
        (amount) => validateAmount(amount, null) !== null
      ),
      { numRuns: 100 }
    );
  });
});

// ── formatAmount ──────────────────────────────────────────────────────────────
describe('formatAmount', () => {
  it('strips leading zeros from integers', () => expect(formatAmount('007')).toBe('7'));
  it('preserves "0." prefix', () => expect(formatAmount('0.5')).toBe('0.5'));
  it('leaves normal values unchanged', () => expect(formatAmount('42')).toBe('42'));
  it('leaves single zero unchanged', () => expect(formatAmount('0')).toBe('0'));
});

// ── formatBalance ─────────────────────────────────────────────────────────────
describe('formatBalance', () => {
  // null / undefined / empty → em dash
  it('returns — for null', () => expect(formatBalance(null)).toBe('—'));
  it('returns — for undefined', () => expect(formatBalance(undefined)).toBe('—'));
  it('returns — for empty string', () => expect(formatBalance('')).toBe('—'));

  // NaN string → returns the string as-is
  it('returns string as-is for non-numeric input', () => expect(formatBalance('abc')).toBe('abc'));

  // very small non-zero
  it('returns "< 0.0000001" for values smaller than minimum', () =>
    expect(formatBalance(0.00000001)).toBe('< 0.0000001'));
  it('returns "< 0.0000001" for 1e-8', () => expect(formatBalance(1e-8)).toBe('< 0.0000001'));

  // normal values
  it('formats integer balance', () => expect(formatBalance(1000)).toBe('1,000'));
  it('formats decimal balance', () => expect(formatBalance(1234.5)).toBe('1,234.5'));
  it('formats zero', () => expect(formatBalance(0)).toBe('0'));
  it('formats string number', () => expect(formatBalance('9999.99')).toBe('9,999.99'));

  // custom decimals
  it('respects custom decimals parameter', () =>
    expect(formatBalance(1.123456789, 2)).toBe('1.12'));

  // Property: any finite positive number ≥ 0.0000001 returns a non-empty string
  it('property: valid numbers always return a non-empty string', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0000001, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          const result = formatBalance(n);
          return typeof result === 'string' && result.length > 0;
        }
      ),
      { numRuns: 200 }
    );
  });

  // Property: null/undefined/'' always returns '—'
  it('property: nullish inputs always return —', () => {
    for (const v of [null, undefined, '']) {
      expect(formatBalance(v)).toBe('—');
    }
  });
});

// ── formatBalanceWithAsset ────────────────────────────────────────────────────
describe('formatBalanceWithAsset', () => {
  it('appends asset label when provided', () =>
    expect(formatBalanceWithAsset(1000, 'XLM')).toBe('1,000 XLM'));
  it('returns just the formatted balance when asset is falsy', () =>
    expect(formatBalanceWithAsset(1000, '')).toBe('1,000'));
  it('returns just the formatted balance when asset is null', () =>
    expect(formatBalanceWithAsset(1000, null)).toBe('1,000'));
});

// ── isValidStellarAddress ─────────────────────────────────────────────────────
describe('isValidStellarAddress', () => {
  const VALID = 'GAKI3CZCF2YY5MTNZBIUL2KIJ5TVZMR334KXQE35C7FCBGWAXCKODMHC';

  it('returns true for a valid Ed25519 public key', () => expect(isValidStellarAddress(VALID)).toBe(true));
  it('returns false for null', () => expect(isValidStellarAddress(null)).toBe(false));
  it('returns false for undefined', () => expect(isValidStellarAddress(undefined)).toBe(false));
  it('returns false for empty string', () => expect(isValidStellarAddress('')).toBe(false));
  it('returns false for a number', () => expect(isValidStellarAddress(12345)).toBe(false));
  it('returns false for a secret key (starts with S)', () =>
    expect(isValidStellarAddress('SCZANGBA5RLMQ4DQTNU37XHZGEL5IQTARX5IFGGCDKOGCW5DYWI5ZRD')).toBe(false));
  it('returns false for a truncated address', () =>
    expect(isValidStellarAddress(VALID.slice(0, 30))).toBe(false));
  it('returns false for an address with invalid characters', () =>
    expect(isValidStellarAddress(VALID.replace('G', '0'))).toBe(false));
});

// ── getFriendlyError ──────────────────────────────────────────────────────────
describe('getFriendlyError', () => {
  // Stellar SDK result codes — transaction level
  it('maps tx_failed result code', () => {
    const err = { response: { data: { extras: { result_codes: { transaction: 'tx_failed' } } } } };
    expect(getFriendlyError(err)).toMatch(/failed/i);
  });
  it('maps tx_bad_seq result code', () => {
    const err = { response: { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } } };
    expect(getFriendlyError(err)).toMatch(/sequence/i);
  });
  it('maps tx_insufficient_balance result code', () => {
    const err = { response: { data: { extras: { result_codes: { transaction: 'tx_insufficient_balance' } } } } };
    expect(getFriendlyError(err)).toMatch(/insufficient/i);
  });
  it('falls through to operation codes when tx code is unknown', () => {
    const err = { response: { data: { extras: { result_codes: { transaction: 'tx_unknown_xyz', operations: ['op_no_trust'] } } } } };
    expect(getFriendlyError(err)).toMatch(/trust/i);
  });
  it('maps op_underfunded operation result code', () => {
    const err = { response: { data: { extras: { result_codes: { operations: ['op_underfunded'] } } } } };
    expect(getFriendlyError(err)).toMatch(/insufficient/i);
  });
  it('maps op_no_destination operation result code', () => {
    const err = { response: { data: { extras: { result_codes: { operations: ['op_no_destination'] } } } } };
    expect(getFriendlyError(err)).toMatch(/does not exist/i);
  });

  // error.code shortcuts
  it('maps ECONNABORTED error code', () => {
    expect(getFriendlyError({ code: 'ECONNABORTED' })).toMatch(/timed out/i);
  });
  it('maps ERR_NETWORK error code', () => {
    expect(getFriendlyError({ code: 'ERR_NETWORK' })).toMatch(/timed out/i);
  });

  // string matching via ERROR_MAP
  it('maps insufficient balance message', () => {
    expect(getFriendlyError({ message: 'insufficient balance' })).toMatch(/Insufficient balance/i);
  });
  it('maps account not found message', () => {
    expect(getFriendlyError({ message: 'no account found' })).toMatch(/does not exist/i);
  });
  it('maps network error message', () => {
    expect(getFriendlyError({ message: 'Network error' })).toMatch(/Network error/i);
  });
  it('maps timeout message', () => {
    expect(getFriendlyError({ message: 'Request timeout' })).toMatch(/timed out/i);
  });
  it('maps bad sequence message', () => {
    expect(getFriendlyError({ message: 'bad sequence' })).toMatch(/sequence error/i);
  });
  it('maps tx_failed message string', () => {
    expect(getFriendlyError({ message: 'tx_failed' })).toMatch(/rejected/i);
  });
  it('uses response.data.error when available', () => {
    const err = { response: { data: { error: 'insufficient balance' } }, message: 'Request failed' };
    expect(getFriendlyError(err)).toMatch(/Insufficient balance/i);
  });

  // fallback
  it('returns generic message for unknown errors', () => {
    expect(getFriendlyError({ message: 'some unknown thing' })).toMatch(/Something went wrong/i);
  });
  it('handles error with no message property', () => {
    expect(getFriendlyError({})).toMatch(/Something went wrong/i);
  });
});

// ── highlightSearchTerms ──────────────────────────────────────────────────────
describe('highlightSearchTerms', () => {
  it('returns text unchanged when query is empty', () =>
    expect(highlightSearchTerms('hello world', '')).toBe('hello world'));
  it('returns text unchanged when query is null', () =>
    expect(highlightSearchTerms('hello world', null)).toBe('hello world'));
  it('returns text unchanged when text is empty', () =>
    expect(highlightSearchTerms('', 'hello')).toBe(''));
  it('returns text unchanged when text is null', () =>
    expect(highlightSearchTerms(null, 'hello')).toBe(null));
  it('wraps matching term in <mark>', () =>
    expect(highlightSearchTerms('hello world', 'hello')).toBe('<mark>hello</mark> world'));
  it('is case-insensitive', () =>
    expect(highlightSearchTerms('Hello World', 'hello')).toBe('<mark>Hello</mark> World'));
  it('wraps all occurrences', () =>
    expect(highlightSearchTerms('foo foo foo', 'foo')).toBe('<mark>foo</mark> <mark>foo</mark> <mark>foo</mark>'));
});

// ── filterTransactions ────────────────────────────────────────────────────────
describe('filterTransactions', () => {
  const txs = [
    { id: 'tx1', memo: 'rent', source: 'GABC', destination: 'GXYZ', type: 'payment', status: 'success', created_at: '2024-01-15T00:00:00Z', amount: '100' },
    { id: 'tx2', memo: 'salary', source: 'GDEF', destination: 'GABC', type: 'payment', status: 'failed', created_at: '2024-02-20T00:00:00Z', amount: '5000' },
    { id: 'tx3', memo: null, source: 'GXYZ', destination: 'GDEF', type: 'create_account', status: 'success', created_at: '2024-03-10T00:00:00Z', amount: '10' },
  ];

  it('returns all transactions when criteria is empty', () =>
    expect(filterTransactions(txs, {})).toHaveLength(3));

  it('returns empty array for empty input', () =>
    expect(filterTransactions([], { query: 'foo' })).toHaveLength(0));

  // query filter
  it('filters by query matching id', () =>
    expect(filterTransactions(txs, { query: 'tx1' })).toHaveLength(1));
  it('filters by query matching memo', () =>
    expect(filterTransactions(txs, { query: 'rent' })).toHaveLength(1));
  it('filters by query matching source', () =>
    expect(filterTransactions(txs, { query: 'GDEF' })).toHaveLength(2));
  it('filters by query matching destination', () =>
    expect(filterTransactions(txs, { query: 'GXYZ' })).toHaveLength(2));
  it('returns empty when query matches nothing', () =>
    expect(filterTransactions(txs, { query: 'zzznomatch' })).toHaveLength(0));

  // type filter
  it('filters by type', () =>
    expect(filterTransactions(txs, { type: 'create_account' })).toHaveLength(1));
  it('returns all when type is "all"', () =>
    expect(filterTransactions(txs, { type: 'all' })).toHaveLength(3));

  // status filter
  it('filters by status', () =>
    expect(filterTransactions(txs, { status: 'failed' })).toHaveLength(1));
  it('returns all when status is "all"', () =>
    expect(filterTransactions(txs, { status: 'all' })).toHaveLength(3));

  // date range filter
  it('filters by dateFrom', () =>
    expect(filterTransactions(txs, { dateFrom: '2024-02-01' })).toHaveLength(2));
  it('filters by dateTo', () =>
    expect(filterTransactions(txs, { dateTo: '2024-01-31' })).toHaveLength(1));
  it('filters by dateFrom and dateTo range', () =>
    expect(filterTransactions(txs, { dateFrom: '2024-02-01', dateTo: '2024-02-28' })).toHaveLength(1));

  // amount range filter
  it('filters by amountMin', () =>
    expect(filterTransactions(txs, { amountMin: '500' })).toHaveLength(1));
  it('filters by amountMax', () =>
    expect(filterTransactions(txs, { amountMax: '50' })).toHaveLength(1));

  // address filter
  it('filters by address matching source', () =>
    expect(filterTransactions(txs, { address: 'GABC' })).toHaveLength(2));
  it('returns empty when address matches nothing', () =>
    expect(filterTransactions(txs, { address: 'GZZZ' })).toHaveLength(0));
});
