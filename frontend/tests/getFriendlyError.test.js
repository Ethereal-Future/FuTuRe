import { describe, it, expect } from 'vitest';
import { getFriendlyError } from '../src/utils/errorMessages';

describe('getFriendlyError', () => {
  describe('network errors', () => {
    it('maps ERR_NETWORK code to connection message', () => {
      expect(getFriendlyError({ code: 'ERR_NETWORK' })).toMatch(/timed out|network/i);
    });

    it('maps network error message', () => {
      expect(getFriendlyError({ message: 'Network error' })).toMatch(/network error/i);
    });

    it('maps failed to fetch message', () => {
      expect(getFriendlyError({ message: 'Failed to fetch' })).toMatch(/network error/i);
    });

    it('maps ECONNREFUSED message', () => {
      expect(getFriendlyError({ message: 'ECONNREFUSED' })).toMatch(/network error/i);
    });
  });

  describe('timeout errors', () => {
    it('maps ECONNABORTED code to timeout message', () => {
      expect(getFriendlyError({ code: 'ECONNABORTED' })).toMatch(/timed out/i);
    });

    it('maps timeout message', () => {
      expect(getFriendlyError({ message: 'timeout' })).toMatch(/timed out/i);
    });
  });

  describe('422 validation errors', () => {
    it('returns server-provided error for 422 response', () => {
      const err = {
        response: { status: 422, data: { error: 'insufficient balance' } },
        message: 'Request failed with status code 422',
      };
      expect(getFriendlyError(err)).toMatch(/insufficient balance/i);
    });

    it('falls back to message matching when 422 has no data.error', () => {
      const err = {
        response: { status: 422, data: {} },
        message: 'insufficient balance',
      };
      expect(getFriendlyError(err)).toMatch(/insufficient balance/i);
    });
  });

  describe('500 server errors', () => {
    it('returns server-provided error for 500 response', () => {
      const err = {
        response: { status: 500, data: { error: 'Network error occurred' } },
        message: 'Request failed with status code 500',
      };
      expect(getFriendlyError(err)).toMatch(/network error/i);
    });

    it('returns generic message when 500 has no recognisable error', () => {
      const err = {
        response: { status: 500, data: { error: 'Internal server error' } },
        message: 'Request failed with status code 500',
      };
      expect(getFriendlyError(err)).toMatch(/something went wrong/i);
    });
  });

  describe('Stellar SDK result code errors', () => {
    it('maps tx_bad_auth transaction result code', () => {
      const err = {
        response: {
          data: { extras: { result_codes: { transaction: 'tx_bad_auth' } } },
        },
      };
      expect(getFriendlyError(err)).toMatch(/authentication failed/i);
    });

    it('maps tx_insufficient_balance transaction result code', () => {
      const err = {
        response: {
          data: { extras: { result_codes: { transaction: 'tx_insufficient_balance' } } },
        },
      };
      expect(getFriendlyError(err)).toMatch(/insufficient balance/i);
    });

    it('maps op_no_destination operation result code', () => {
      const err = {
        response: {
          data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_no_destination'] } } },
        },
      };
      expect(getFriendlyError(err)).toMatch(/does not exist/i);
    });

    it('maps op_underfunded operation result code', () => {
      const err = {
        response: {
          data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } } },
        },
      };
      expect(getFriendlyError(err)).toMatch(/insufficient funds/i);
    });

    it('maps tx_bad_seq transaction result code', () => {
      const err = {
        response: {
          data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
        },
      };
      expect(getFriendlyError(err)).toMatch(/sequence/i);
    });

    it('prefers transaction result code over operations when transaction code is known', () => {
      const err = {
        response: {
          data: {
            extras: {
              result_codes: {
                transaction: 'tx_insufficient_balance',
                operations: ['op_underfunded'],
              },
            },
          },
        },
      };
      expect(getFriendlyError(err)).toMatch(/insufficient balance/i);
    });
  });
});
