/**
 * Stellar transaction memo validation.
 *
 * Stellar Horizon enforces a hard 28-byte limit on MEMO_TEXT measured in
 * UTF-8 bytes, not Unicode code points.  Using `memo.length <= 28` passes
 * multi-byte characters (emoji, non-ASCII scripts) that contain fewer than
 * 29 code points but more than 28 UTF-8 bytes, causing Horizon to reject
 * the transaction with a memo error.
 *
 * This module validates all memo types against their Stellar constraints
 * before the transaction is signed or broadcast.
 *
 * Fixes ISSUE-317.
 */

/** Maximum UTF-8 byte length for a MEMO_TEXT value. */
export const MEMO_TEXT_MAX_BYTES = 28;

/** Maximum value for a MEMO_ID (unsigned 64-bit integer). */
export const MEMO_ID_MAX = 18446744073709551615n;

export class MemoValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MemoValidationError';
    this.status = 400;
    this.statusCode = 400;
  }
}

/**
 * Validate a Stellar transaction memo against the protocol constraints.
 *
 * @param {string|number|null|undefined} memo - Memo value
 * @param {'text'|'id'|'hash'|'return'} [memoType='text'] - Memo type
 * @returns {void}
 * @throws {MemoValidationError} When the memo violates its type constraints
 */
export function validateMemo(memo, memoType = 'text') {
  if (memo === null || memo === undefined || memo === '') return;

  const memoString = String(memo);

  switch (memoType) {
    case 'id': {
      if (!/^\d+$/.test(memoString)) {
        throw new MemoValidationError('MEMO_ID must be an unsigned 64-bit integer');
      }
      const value = BigInt(memoString);
      if (value < 0n || value > MEMO_ID_MAX) {
        throw new MemoValidationError(
          `MEMO_ID must be between 0 and ${MEMO_ID_MAX}`
        );
      }
      return;
    }

    case 'hash':
    case 'return': {
      if (!/^[0-9a-fA-F]{64}$/.test(memoString)) {
        throw new MemoValidationError(
          `MEMO_${memoType.toUpperCase()} must be a 32-byte hex string (64 hex characters)`
        );
      }
      return;
    }

    case 'text':
    default: {
      // Measure the byte length, not the character count. Multi-byte Unicode
      // characters (e.g. emoji: 4 bytes, Arabic/CJK: 2–4 bytes) must be
      // counted in bytes to match Horizon's 28-byte limit.
      const byteLength = Buffer.byteLength(memoString, 'utf8');
      if (byteLength > MEMO_TEXT_MAX_BYTES) {
        throw new MemoValidationError(
          `MEMO_TEXT exceeds the 28-byte limit (got ${byteLength} bytes for "${memoString}")`
        );
      }
    }
  }
}
