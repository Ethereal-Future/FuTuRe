import { describe, it, expect } from 'vitest';
import { generateSRIHash, verifySRIHash } from '../src/utils/sriHash.js';

describe('SRI Hash Utilities', () => {
  describe('generateSRIHash', () => {
    it('generates SHA256 hash for string content', () => {
      const content = 'console.log("hello");';
      const hash = generateSRIHash(content);

      expect(hash).toMatch(/^sha256-[A-Za-z0-9+/=]+$/);
      expect(hash).toBeDefined();
    });

    it('generates SHA256 hash for Buffer content', () => {
      const content = Buffer.from('const x = 1;');
      const hash = generateSRIHash(content);

      expect(hash).toMatch(/^sha256-[A-Za-z0-9+/=]+$/);
    });

    it('generates different hashes for different content', () => {
      const hash1 = generateSRIHash('content1');
      const hash2 = generateSRIHash('content2');

      expect(hash1).not.toBe(hash2);
    });

    it('generates same hash for identical content', () => {
      const content = 'const a = "same";';
      const hash1 = generateSRIHash(content);
      const hash2 = generateSRIHash(content);

      expect(hash1).toBe(hash2);
    });

    it('supports custom algorithms', () => {
      const content = 'test content';
      const sha256Hash = generateSRIHash(content, 'sha256');
      const sha512Hash = generateSRIHash(content, 'sha512');

      expect(sha256Hash).toMatch(/^sha256-/);
      expect(sha512Hash).toMatch(/^sha512-/);
      expect(sha256Hash).not.toBe(sha512Hash);
    });
  });

  describe('verifySRIHash', () => {
    it('verifies valid SRI hash', () => {
      const content = 'function test() { return 42; }';
      const hash = generateSRIHash(content);

      const isValid = verifySRIHash(content, hash);
      expect(isValid).toBe(true);
    });

    it('rejects invalid SRI hash', () => {
      const content = 'const x = 1;';
      const wrongHash = 'sha256-wrongbase64hashvalue==';

      const isValid = verifySRIHash(content, wrongHash);
      expect(isValid).toBe(false);
    });

    it('rejects modified content', () => {
      const originalContent = 'const safe = true;';
      const modifiedContent = 'const safe = false;';
      const hash = generateSRIHash(originalContent);

      const isValid = verifySRIHash(modifiedContent, hash);
      expect(isValid).toBe(false);
    });

    it('handles Buffer and string interchangeably', () => {
      const content = 'test';
      const bufferContent = Buffer.from(content);
      const hash = generateSRIHash(content);

      expect(verifySRIHash(bufferContent, hash)).toBe(true);
    });

    it('handles malformed integrity attributes', () => {
      const content = 'test';
      expect(verifySRIHash(content, 'invalid')).toBe(false);
      expect(verifySRIHash(content, '')).toBe(false);
      expect(verifySRIHash(content, 'sha256')).toBe(false);
    });

    it('verifies hash with different algorithm specified', () => {
      const content = 'const code = "test";';
      const sha512Hash = generateSRIHash(content, 'sha512');

      const isValid = verifySRIHash(content, sha512Hash);
      expect(isValid).toBe(true);
    });

    it('works with multi-algorithm integrity string', () => {
      const content = 'code content';
      const hash1 = generateSRIHash(content, 'sha256');
      const hash2 = generateSRIHash(content, 'sha512');
      const multiAlgoHash = `${hash1} ${hash2}`;

      // Should verify against the first algorithm listed
      const result = verifySRIHash(content, multiAlgoHash.split(' ')[0]);
      expect(result).toBe(true);
    });
  });
});
