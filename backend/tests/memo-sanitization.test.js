/**
 * Memo Sanitization Tests (#729)
 * Validates that user-supplied memo fields are sanitized before Stellar submission
 * Covers memo length, character validation, and type-specific validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Custom error class for invalid memo
class InvalidMemoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidMemoError';
  }
}

/**
 * Validates and sanitizes Stellar memo fields
 */
class MemoValidator {
  static MAX_MEMO_BYTES = 28;
  static MAX_MEMO_ID = BigInt('18446744073709551615'); // 2^64 - 1

  static validateMemoBytesLength(memo) {
    const bytes = Buffer.byteLength(memo, 'utf8');
    if (bytes > this.MAX_MEMO_BYTES) {
      throw new InvalidMemoError(
        `Memo exceeds maximum length of ${this.MAX_MEMO_BYTES} bytes (got ${bytes})`,
      );
    }
  }

  static validateMemoTextCharacters(memo) {
    for (let i = 0; i < memo.length; i++) {
      const code = memo.charCodeAt(i);
      // Allow printable ASCII (0x20-0x7E) and common whitespace
      if ((code < 0x20 || code > 0x7e) && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        throw new InvalidMemoError(
          `Memo contains non-printable character at position ${i} (code: ${code})`,
        );
      }
    }
  }

  static validateMemoText(memo) {
    if (typeof memo !== 'string') {
      throw new InvalidMemoError('Memo must be a string');
    }

    const trimmed = memo.trim();
    if (trimmed.length === 0) {
      throw new InvalidMemoError('Memo cannot be empty');
    }

    this.validateMemoTextCharacters(trimmed);
    this.validateMemoBytesLength(trimmed);

    return trimmed;
  }

  static validateMemoId(memoId) {
    if (typeof memoId !== 'number' && typeof memoId !== 'bigint') {
      throw new InvalidMemoError('Memo ID must be a number or BigInt');
    }

    const id = BigInt(memoId);
    if (id < 0n || id > this.MAX_MEMO_ID) {
      throw new InvalidMemoError(`Memo ID must be between 0 and ${this.MAX_MEMO_ID} (got ${id})`);
    }

    return id;
  }

  static validateMemoHash(hash) {
    if (typeof hash !== 'string') {
      throw new InvalidMemoError('Memo hash must be a string');
    }

    // Hash should be 64 hex characters (32 bytes)
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      throw new InvalidMemoError('Memo hash must be exactly 32 bytes (64 hex characters)');
    }

    return hash;
  }

  static sanitizeForLogging(memo) {
    if (memo.length > 10) {
      return memo.substring(0, 10) + '...';
    }
    return memo;
  }
}

describe('Memo Sanitization - #729', () => {
  describe('MEMO_TEXT validation', () => {
    it('should accept valid ASCII memo', () => {
      const memo = 'Payment for services';
      expect(() => MemoValidator.validateMemoText(memo)).not.toThrow();
      expect(MemoValidator.validateMemoText(memo)).toBe(memo);
    });

    it('should accept memo exactly 28 bytes', () => {
      const memo = 'a'.repeat(28);
      expect(() => MemoValidator.validateMemoText(memo)).not.toThrow();
      expect(MemoValidator.validateMemoText(memo)).toBe(memo);
    });

    it('should reject memo longer than 28 bytes', () => {
      const memo = 'a'.repeat(29);
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(InvalidMemoError);
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(/exceeds maximum length/);
    });

    it('should reject memo with non-printable characters', () => {
      const memo = 'valid\x00invalid'; // Contains null byte
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(InvalidMemoError);
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(/non-printable/);
    });

    it('should reject memo with ANSI escape codes', () => {
      const memo = 'text\x1b[31mred\x1b[0m'; // ANSI color codes
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(InvalidMemoError);
    });

    it('should trim leading and trailing whitespace', () => {
      const memo = '  payment  ';
      const result = MemoValidator.validateMemoText(memo);
      expect(result).toBe('payment');
    });

    it('should reject empty string', () => {
      expect(() => MemoValidator.validateMemoText('')).toThrow(InvalidMemoError);
      expect(() => MemoValidator.validateMemoText('   ')).toThrow(InvalidMemoError);
    });

    it('should reject non-string memo', () => {
      expect(() => MemoValidator.validateMemoText(123)).toThrow(InvalidMemoError);
      expect(() => MemoValidator.validateMemoText(null)).toThrow(InvalidMemoError);
      expect(() => MemoValidator.validateMemoText({})).toThrow(InvalidMemoError);
    });

    it('should reject memo with Unicode characters beyond ASCII', () => {
      const memo = 'payment 💸'; // Emoji outside ASCII range
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(InvalidMemoError);
    });

    it('should accept memo with newline characters in whitespace', () => {
      // Newline is allowed as valid whitespace (0x0A)
      const memo = 'line1\nline2';
      expect(() => MemoValidator.validateMemoText(memo)).not.toThrow();
    });

    it('should accept memo with tabs (valid whitespace)', () => {
      const memo = 'payment\tdetails';
      expect(() => MemoValidator.validateMemoText(memo)).not.toThrow();
    });

    it('should count UTF-8 byte length not character count', () => {
      // Create a string that's 28 UTF-8 bytes but fewer characters
      const memo = 'abc'; // 3 bytes
      expect(() => MemoValidator.validateMemoText(memo)).not.toThrow();

      // If someone passes multi-byte UTF-8 that exceeds 28 bytes in length
      // This should fail because we validate against byte length
      const multiByte = 'ñ'.repeat(20); // Each ñ is 2 bytes = 40 bytes total
      expect(() => MemoValidator.validateMemoText(multiByte)).toThrow();
    });

    it('should provide clear error message for length violation', () => {
      const memo = 'a'.repeat(50);
      try {
        MemoValidator.validateMemoText(memo);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e.message).toContain('exceeds maximum length');
        expect(e.message).toContain('28');
        expect(e.message).toContain('50');
      }
    });
  });

  describe('MEMO_ID validation', () => {
    it('should accept valid unsigned 64-bit integer', () => {
      const memoId = 12345;
      expect(() => MemoValidator.validateMemoId(memoId)).not.toThrow();
      expect(MemoValidator.validateMemoId(memoId)).toBe(BigInt(12345));
    });

    it('should accept zero', () => {
      expect(() => MemoValidator.validateMemoId(0)).not.toThrow();
    });

    it('should accept maximum 64-bit unsigned integer', () => {
      const max = '18446744073709551615'; // 2^64 - 1
      expect(() => MemoValidator.validateMemoId(BigInt(max))).not.toThrow();
    });

    it('should reject negative number', () => {
      expect(() => MemoValidator.validateMemoId(-1)).toThrow(InvalidMemoError);
    });

    it('should reject number exceeding max uint64', () => {
      const overflow = BigInt('18446744073709551616'); // 2^64
      expect(() => MemoValidator.validateMemoId(overflow)).toThrow(InvalidMemoError);
    });

    it('should reject non-numeric values', () => {
      expect(() => MemoValidator.validateMemoId('not-a-number')).toThrow();
      expect(() => MemoValidator.validateMemoId(null)).toThrow();
    });

    it('should accept BigInt input', () => {
      const bigId = BigInt('9223372036854775807');
      expect(() => MemoValidator.validateMemoId(bigId)).not.toThrow();
    });
  });

  describe('MEMO_HASH / MEMO_RETURN validation', () => {
    it('should accept valid 32-byte hex hash', () => {
      const hash = 'a'.repeat(64); // 64 hex chars = 32 bytes
      expect(() => MemoValidator.validateMemoHash(hash)).not.toThrow();
    });

    it('should reject hash with incorrect length', () => {
      const hash = 'a'.repeat(63); // Too short
      expect(() => MemoValidator.validateMemoHash(hash)).toThrow(InvalidMemoError);
    });

    it('should reject hash with non-hex characters', () => {
      const hash = 'a'.repeat(62) + 'XY'; // XY not valid hex
      expect(() => MemoValidator.validateMemoHash(hash)).toThrow(InvalidMemoError);
    });

    it('should accept uppercase hex', () => {
      const hash = 'A'.repeat(64);
      expect(() => MemoValidator.validateMemoHash(hash)).not.toThrow();
    });

    it('should accept mixed case hex', () => {
      const hash = 'Aa'.repeat(32);
      expect(() => MemoValidator.validateMemoHash(hash)).not.toThrow();
    });

    it('should reject non-string hash', () => {
      expect(() => MemoValidator.validateMemoHash(12345)).toThrow(InvalidMemoError);
    });
  });

  describe('Logging sanitization', () => {
    it('should truncate memo for logging', () => {
      const memo = 'very long memo that should be truncated';
      const sanitized = MemoValidator.sanitizeForLogging(memo);
      expect(sanitized).toBe('very long ...');
      expect(sanitized.length).toBeLessThan(memo.length);
    });

    it('should not truncate short memos', () => {
      const memo = 'short';
      const sanitized = MemoValidator.sanitizeForLogging(memo);
      expect(sanitized).toBe('short');
    });

    it('should handle exactly 10 character memo', () => {
      const memo = 'a'.repeat(10);
      const sanitized = MemoValidator.sanitizeForLogging(memo);
      expect(sanitized).toBe(memo);
    });

    it('should handle 11 character memo', () => {
      const memo = 'a'.repeat(11);
      const sanitized = MemoValidator.sanitizeForLogging(memo);
      expect(sanitized).toBe('a'.repeat(10) + '...');
    });
  });

  describe('Type-specific memo validation', () => {
    const memoTypes = {
      MEMO_TEXT: 'text',
      MEMO_ID: 'id',
      MEMO_HASH: 'hash',
      MEMO_RETURN: 'return',
    };

    it('should validate MEMO_TEXT type', () => {
      expect(() => MemoValidator.validateMemoText('valid text')).not.toThrow();
    });

    it('should validate MEMO_ID type', () => {
      expect(() => MemoValidator.validateMemoId(12345)).not.toThrow();
    });

    it('should validate MEMO_HASH type', () => {
      const hash = 'ab'.repeat(32);
      expect(() => MemoValidator.validateMemoHash(hash)).not.toThrow();
    });

    it('should reject MEMO_TEXT when ID expected', () => {
      expect(() => MemoValidator.validateMemoId('not-a-number')).toThrow();
    });

    it('should reject MEMO_ID when MEMO_HASH expected', () => {
      expect(() => MemoValidator.validateMemoHash(12345)).toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle memo with only whitespace', () => {
      expect(() => MemoValidator.validateMemoText('   ')).toThrow(InvalidMemoError);
      expect(() => MemoValidator.validateMemoText('\t\t')).toThrow(InvalidMemoError);
    });

    it('should handle memo with mixed valid/invalid characters', () => {
      const memo = 'valid\x01invalid'; // \x01 is non-printable
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(InvalidMemoError);
    });

    it('should reject memo with form feed character', () => {
      const memo = 'text\x0cmore'; // \x0c is form feed
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(InvalidMemoError);
    });

    it('should reject memo with vertical tab', () => {
      const memo = 'text\x0bmore'; // \x0b is vertical tab
      expect(() => MemoValidator.validateMemoText(memo)).toThrow(InvalidMemoError);
    });

    it('should validate exactly at boundary (28 bytes)', () => {
      const memo = 'x'.repeat(28); // Exactly 28 bytes
      expect(() => MemoValidator.validateMemoText(memo)).not.toThrow();

      const memoOver = 'x'.repeat(29); // 29 bytes
      expect(() => MemoValidator.validateMemoText(memoOver)).toThrow();
    });

    it('should handle special payment memo formats', () => {
      const memos = ['INV-12345', 'ORDER#2024-001', 'Fee 0.5 XLM'];

      memos.forEach((memo) => {
        expect(() => MemoValidator.validateMemoText(memo)).not.toThrow();
      });
    });
  });

  describe('Error reporting', () => {
    it('should provide error name as InvalidMemoError', () => {
      try {
        MemoValidator.validateMemoText('x'.repeat(50));
        expect.fail('Should throw');
      } catch (e) {
        expect(e.name).toBe('InvalidMemoError');
      }
    });

    it('should provide position information for character errors', () => {
      const memo = 'valid\x00broken';
      try {
        MemoValidator.validateMemoText(memo);
        expect.fail('Should throw');
      } catch (e) {
        expect(e.message).toContain('position');
      }
    });

    it('should provide code point information for invalid characters', () => {
      const memo = 'text\x1f'; // Unit separator, code 31
      try {
        MemoValidator.validateMemoText(memo);
        expect.fail('Should throw');
      } catch (e) {
        expect(e.message).toContain('code');
      }
    });
  });
});
