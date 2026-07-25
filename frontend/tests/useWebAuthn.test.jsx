import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWebAuthn } from '../src/hooks/usePWA';

// ── Mock fetch ────────────────────────────────────────────────────────────────

const REGISTRATION_OPTIONS = {
  challengeId: 'ch-123',
  challenge: 'dGVzdC1jaGFsbGVuZ2U=', // base64 "test-challenge"
  rp: { id: 'localhost', name: 'FuTuRe' },
  user: { id: 'dXNlci0x', name: 'user', displayName: 'user' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: {},
};

const AUTH_OPTIONS = {
  challengeId: 'ch-456',
  challenge: 'dGVzdC1hdXRoLWNoYWxsZW5nZQ==',
  allowCredentials: [{ type: 'public-key', id: 'Y3JlZC0x' }],
};

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Mock browser WebAuthn APIs ────────────────────────────────────────────────

const mockGetPublicKey = vi.fn(() => new ArrayBuffer(8));
const mockCreate = vi.fn(() =>
  Promise.resolve({
    id: 'cred-browser-id',
    response: { getPublicKey: mockGetPublicKey },
  })
);
const mockGet = vi.fn(() =>
  Promise.resolve({
    id: 'cred-browser-id',
    response: {
      signature: new Uint8Array([1, 2, 3]).buffer,
    },
  })
);

Object.defineProperty(global, 'PublicKeyCredential', { value: class {}, configurable: true });
Object.defineProperty(navigator, 'credentials', {
  value: { create: mockCreate, get: mockGet },
  configurable: true,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useWebAuthn', () => {
  const userId = 'user-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports isSupported=true when PublicKeyCredential is available', () => {
    const { result } = renderHook(() => useWebAuthn(userId));
    expect(result.current.isSupported).toBe(true);
  });

  it('registerBiometric calls the backend twice (options then verify)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(REGISTRATION_OPTIONS) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ registered: true, credentialId: 'cred-browser-id' }) });

    const { result } = renderHook(() => useWebAuthn(userId));

    let response;
    await act(async () => {
      response = await result.current.registerBiometric('My Device');
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(response.registered).toBe(true);
    expect(result.current.webAuthnError).toBeNull();
  });

  it('loginWithBiometric calls the backend twice (options then verify)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(AUTH_OPTIONS) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt-token', expiresIn: 604800 }) });

    const { result } = renderHook(() => useWebAuthn(userId));

    let response;
    await act(async () => {
      response = await result.current.loginWithBiometric();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(response.token).toBe('jwt-token');
  });

  it('sets webAuthnError when the server returns an error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'No credentials registered' }),
    });

    const { result } = renderHook(() => useWebAuthn(userId));

    await act(async () => {
      try { await result.current.loginWithBiometric(); } catch {}
    });

    expect(result.current.webAuthnError).toContain('No credentials registered');
  });

  it('isSupported is false when PublicKeyCredential is not defined', () => {
    const original = global.PublicKeyCredential;
    delete global.PublicKeyCredential;

    const { result } = renderHook(() => useWebAuthn(userId));
    expect(result.current.isSupported).toBe(false);

    global.PublicKeyCredential = original;
  });
});
