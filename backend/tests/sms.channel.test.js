/**
 * Tests for backend/src/notifications/channels/sms.js
 *
 * Key cases:
 *  1. Credentials present + twilio importable  → real client is constructed, sms.sent logged
 *  2. Credentials absent                        → stub path, sms.stub.sent logged
 *  3. twilio package not installed              → sms.twilio.unavailable logged, stub path taken
 *  4. Twilio API call fails                     → sms.send.failed logged, success: false returned
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Re-import the module under test with a fresh module registry each time. */
async function importSmsChannel() {
  // vitest's module registry must be cleared so the cached `twilioClient`
  // singleton inside the module is reset between tests.
  vi.resetModules();
  return import('../src/notifications/channels/sms.js');
}

// --------------------------------------------------------------------------
// Shared mocks
// --------------------------------------------------------------------------

// Silence real logger output during tests.
vi.mock('../src/config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('sendSms – SMS notification channel', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Restore env vars modified inside tests.
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Real client path: credentials present, twilio importable
  // -------------------------------------------------------------------------
  describe('when credentials are configured and twilio is installed', () => {
    it('constructs a real Twilio client and returns success with a sid', async () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
      process.env.TWILIO_AUTH_TOKEN = 'auth_token_test';
      process.env.TWILIO_FROM_NUMBER = '+15005550006';

      const fakeSid = 'SM_fake_sid_001';

      // Mock the twilio package so no real HTTP call is made.
      const mockMessagesCreate = vi.fn().mockResolvedValue({ sid: fakeSid });
      const mockTwilioInstance = { messages: { create: mockMessagesCreate } };
      const mockTwilioFactory = vi.fn().mockReturnValue(mockTwilioInstance);

      vi.doMock('twilio', () => ({ default: mockTwilioFactory }));

      const { sendSms } = await importSmsChannel();

      const result = await sendSms('+14155552671', { body: 'Hello from tests' });

      // Client should have been constructed with the env-var credentials.
      expect(mockTwilioFactory).toHaveBeenCalledWith('ACtest123', 'auth_token_test');

      // messages.create should have been called with the right params.
      expect(mockMessagesCreate).toHaveBeenCalledWith({
        from: '+15005550006',
        to: '+14155552671',
        body: 'Hello from tests',
      });

      // Return value should carry the sid and no stub flag.
      expect(result).toEqual({ success: true, sid: fakeSid });
      expect(result.stub).toBeUndefined();
    });

    it('logs sms.sent (not sms.stub.sent) when the real path is taken', async () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
      process.env.TWILIO_AUTH_TOKEN = 'auth_token_test';

      const mockTwilioFactory = vi
        .fn()
        .mockReturnValue({ messages: { create: vi.fn().mockResolvedValue({ sid: 'SM_x' }) } });

      vi.doMock('twilio', () => ({ default: mockTwilioFactory }));

      // Import logger AFTER resetting modules so we get the mocked version.
      const { sendSms } = await importSmsChannel();
      const { default: logger } = await import('../src/config/logger.js');

      await sendSms('+14155552671', { body: 'Hi' });

      expect(logger.info).toHaveBeenCalledWith('sms.sent', expect.objectContaining({ to: '+14155552671' }));
      expect(logger.info).not.toHaveBeenCalledWith('sms.stub.sent', expect.anything());
    });
  });

  // -------------------------------------------------------------------------
  // 2. Stub path: credentials absent
  // -------------------------------------------------------------------------
  describe('when credentials are absent', () => {
    it('returns stub:true without calling twilio at all', async () => {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;

      // twilio should never even be imported in this path.
      const mockTwilioFactory = vi.fn();
      vi.doMock('twilio', () => ({ default: mockTwilioFactory }));

      const { sendSms } = await importSmsChannel();
      const result = await sendSms('+14155552671', { body: 'Stub test' });

      expect(result).toEqual({ success: true, stub: true });
      expect(mockTwilioFactory).not.toHaveBeenCalled();
    });

    it('logs sms.stub.sent when credentials are absent', async () => {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;

      vi.doMock('twilio', () => ({ default: vi.fn() }));

      const { sendSms } = await importSmsChannel();
      const { default: logger } = await import('../src/config/logger.js');

      await sendSms('+14155552671', { body: 'Stub body text here' });

      expect(logger.info).toHaveBeenCalledWith(
        'sms.stub.sent',
        expect.objectContaining({ to: '+14155552671' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. twilio package not installed (dynamic import rejects)
  // -------------------------------------------------------------------------
  describe('when the twilio package is not installed', () => {
    it('logs sms.twilio.unavailable and falls back to the stub path', async () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
      process.env.TWILIO_AUTH_TOKEN = 'auth_token_test';

      // Simulate the package being absent by making the import reject.
      vi.doMock('twilio', () => {
        throw new Error("Cannot find package 'twilio'");
      });

      const { sendSms } = await importSmsChannel();
      const { default: logger } = await import('../src/config/logger.js');

      const result = await sendSms('+14155552671', { body: 'Unavailable test' });

      expect(logger.warn).toHaveBeenCalledWith(
        'sms.twilio.unavailable',
        expect.objectContaining({ reason: 'twilio not installed' }),
      );
      expect(result).toEqual({ success: true, stub: true });
    });
  });

  // -------------------------------------------------------------------------
  // 4. Twilio API call fails at runtime
  // -------------------------------------------------------------------------
  describe('when the Twilio API call fails', () => {
    it('returns success:false and logs sms.send.failed', async () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
      process.env.TWILIO_AUTH_TOKEN = 'auth_token_test';

      const apiError = new Error('Twilio API error – invalid number');
      const mockTwilioFactory = vi
        .fn()
        .mockReturnValue({ messages: { create: vi.fn().mockRejectedValue(apiError) } });

      vi.doMock('twilio', () => ({ default: mockTwilioFactory }));

      const { sendSms } = await importSmsChannel();
      const { default: logger } = await import('../src/config/logger.js');

      const result = await sendSms('+14155552671', { body: 'API fail test' });

      expect(result).toEqual({ success: false, error: apiError.message });
      expect(logger.error).toHaveBeenCalledWith(
        'sms.send.failed',
        expect.objectContaining({ error: apiError.message }),
      );
    });
  });
});
