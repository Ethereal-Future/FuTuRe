import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadState, saveState, clearState } from '../src/store/persistence.js';
import { initialState, STATE_VERSION } from '../src/store/reducer.js';

const STORAGE_KEY = 'app_state_v2';

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('loadState', () => {
    it('returns initialState when localStorage is empty', () => {
      const result = loadState();
      expect(result).toEqual(initialState);
    });

    it('returns initialState when stored version does not match', () => {
      const malformed = { _version: 'wrong_version', account: { publicKey: 'pk123' } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed));

      const result = loadState();
      expect(result).toEqual(initialState);
    });

    it('returns initialState on JSON parse error', () => {
      localStorage.setItem(STORAGE_KEY, 'invalid json');

      const result = loadState();
      expect(result).toEqual(initialState);
    });

    it('sanitizes account object on read, stripping secretKey and other fields', () => {
      const malformed = {
        _version: STATE_VERSION,
        account: {
          publicKey: 'pk123',
          secretKey: 'secret456',
          extraField: 'should be stripped',
        },
        accountLabel: 'My Account',
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed));

      const result = loadState();

      // Only publicKey should be present
      expect(result.account).toEqual({ publicKey: 'pk123' });
      expect(result.account).not.toHaveProperty('secretKey');
      expect(result.account).not.toHaveProperty('extraField');
      expect(result.accountLabel).toBe('My Account');
    });

    it('handles null account correctly', () => {
      const data = {
        _version: STATE_VERSION,
        account: null,
        accountLabel: 'Label',
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

      const result = loadState();
      expect(result.account).toBeNull();
      expect(result.accountLabel).toBe('Label');
    });

    it('handles account with no publicKey', () => {
      const malformed = {
        _version: STATE_VERSION,
        account: {
          secretKey: 'secret456',
          other: 'field',
        },
        accountLabel: 'Label',
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed));

      const result = loadState();
      expect(result.account).toBeNull();
    });
  });

  describe('roundtrip: save and load', () => {
    it('preserves legitimate account state through save/load cycle', () => {
      const testState = {
        ...initialState,
        account: { publicKey: 'pk123' },
        accountLabel: 'Test Account',
      };

      saveState(testState);
      const loaded = loadState();

      expect(loaded.account).toEqual({ publicKey: 'pk123' });
      expect(loaded.accountLabel).toBe('Test Account');
    });
  });
});
