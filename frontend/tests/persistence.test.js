import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadState, saveState, clearState, sliceKey } from '../src/store/persistence.js';
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

  describe('per-slice isolation (#1699)', () => {
    it('a corrupted slice does not purge unrelated stored data', () => {
      saveState({ ...initialState, account: { publicKey: 'pk123' }, accountLabel: 'Savings' });
      localStorage.setItem(sliceKey('accountLabel'), '{not json');

      const loaded = loadState();

      expect(loaded.account).toEqual({ publicKey: 'pk123' });
      expect(localStorage.getItem(sliceKey('account'))).not.toBeNull();
    });

    it('applies fallback defaults only to the malformed slice', () => {
      saveState({ ...initialState, account: { publicKey: 'pk123' }, accountLabel: 'Savings' });
      localStorage.setItem(sliceKey('account'), 'garbage');

      const loaded = loadState();

      expect(loaded.account).toBe(initialState.account);
      expect(loaded.accountLabel).toBe('Savings');
      // Only the corrupted key is removed
      expect(localStorage.getItem(sliceKey('account'))).toBeNull();
      expect(localStorage.getItem(sliceKey('accountLabel'))).toBe(JSON.stringify('Savings'));
    });

    it('leaves unrelated localStorage keys untouched on corruption', () => {
      localStorage.setItem('address_book', JSON.stringify([{ name: 'Alice' }]));
      saveState({ ...initialState, account: { publicKey: 'pk123' } });
      localStorage.setItem(sliceKey('account'), '}');

      loadState();

      expect(localStorage.getItem('address_book')).toBe(JSON.stringify([{ name: 'Alice' }]));
    });

    it('migrates the legacy single-blob key into per-slice keys', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ _version: STATE_VERSION, account: { publicKey: 'pk1' }, accountLabel: 'L' }),
      );

      const loaded = loadState();

      expect(loaded.account).toEqual({ publicKey: 'pk1' });
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(JSON.parse(localStorage.getItem(sliceKey('account')))).toEqual({ publicKey: 'pk1' });
    });

    it('never writes secretKey to storage', () => {
      saveState({ ...initialState, account: { publicKey: 'pk1', secretKey: 'S123' } });
      for (let i = 0; i < localStorage.length; i++) {
        expect(localStorage.getItem(localStorage.key(i))).not.toContain('S123');
      }
    });

    it('clearState removes all persisted slices', () => {
      saveState({ ...initialState, account: { publicKey: 'pk1' }, accountLabel: 'L' });
      clearState();
      expect(loadState()).toEqual(initialState);
    });
  });
});
