import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCSRFToken, addCSRFTokenToHeaders } from '../src/hooks/useCSRFToken';

describe('useCSRFToken hook', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches CSRF token on mount', async () => {
    const mockToken = 'test-csrf-token-123';
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: mockToken }),
    });

    const { result } = renderHook(() => useCSRFToken());

    expect(result.current).toBeNull();

    await waitFor(() => {
      expect(result.current).toBe(mockToken);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/auth/csrf-token', {
      credentials: 'include',
    });
  });

  it('handles fetch errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useCSRFToken());

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(result.current).toBeNull();
    consoleSpy.mockRestore();
  });

  it('handles non-ok response status', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Unauthorized',
    });

    const { result } = renderHook(() => useCSRFToken());

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(result.current).toBeNull();
    consoleSpy.mockRestore();
  });

  it('includes credentials in fetch request', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: 'token' }),
    });

    renderHook(() => useCSRFToken());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/auth/csrf-token',
        expect.objectContaining({ credentials: 'include' }),
      );
    });
  });
});

describe('addCSRFTokenToHeaders', () => {
  it('adds CSRF token to headers', () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = 'test-token';

    const result = addCSRFTokenToHeaders(headers, token);

    expect(result).toEqual({
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    });
  });

  it('returns headers unchanged if token is null', () => {
    const headers = { 'Content-Type': 'application/json' };

    const result = addCSRFTokenToHeaders(headers, null);

    expect(result).toEqual(headers);
  });

  it('returns headers unchanged if token is undefined', () => {
    const headers = { Authorization: 'Bearer abc' };

    const result = addCSRFTokenToHeaders(headers, undefined);

    expect(result).toEqual(headers);
  });

  it('overwrites existing CSRF token header', () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'old-token',
    };
    const newToken = 'new-token';

    const result = addCSRFTokenToHeaders(headers, newToken);

    expect(result['X-CSRF-Token']).toBe(newToken);
  });

  it('preserves original headers object', () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = 'test-token';

    const result = addCSRFTokenToHeaders(headers, token);

    expect(headers).not.toHaveProperty('X-CSRF-Token');
    expect(result).toHaveProperty('X-CSRF-Token');
  });
});
