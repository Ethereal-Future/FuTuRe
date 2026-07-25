/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequestUse = vi.fn();
const mockResponseUse = vi.fn();
const mockApiInstance = Object.assign(
  vi.fn(() => Promise.resolve({ data: { success: true } })),
  {
    interceptors: {
      request: { use: mockRequestUse },
      response: { use: mockResponseUse },
    },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }
);

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockApiInstance),
  },
}));

describe('apiClient interceptor behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('attaches Authorization and correlation headers to requests', async () => {
    localStorage.setItem('accessToken', 'test-token');
    await import('../src/api/client.js');

    const requestInterceptor = mockRequestUse.mock.calls[0][0];
    const config = { headers: {} };
    const result = await requestInterceptor(config);

    expect(result.headers.Authorization).toBe('Bearer test-token');
    expect(result.headers['X-Correlation-ID']).toBeTruthy();
  });

  it('refreshes access token on 401 and retries the original request', async () => {
    localStorage.setItem('accessToken', 'old-token');
    mockApiInstance.post.mockResolvedValueOnce({ data: { accessToken: 'new-token' } });
    mockApiInstance.mockResolvedValueOnce({ data: { success: true } });

    await import('../src/api/client.js');

    const responseInterceptor = mockResponseUse.mock.calls[0][1];
    const originalRequest = { url: '/api/stellar/payment/send', method: 'post', headers: {} };
    const error = { response: { status: 401 }, config: originalRequest };

    const result = await responseInterceptor(error);

    expect(mockApiInstance.post).toHaveBeenCalledWith('/api/auth/refresh');
    expect(originalRequest.headers.Authorization).toBe('Bearer new-token');
    expect(localStorage.getItem('accessToken')).toBe('new-token');
    expect(result).toEqual({ data: { success: true } });
  });

  it('normalizes errors without a response object', async () => {
    await import('../src/api/client.js');
    const responseInterceptor = mockResponseUse.mock.calls[0][1];
    const error = new Error('Network failure');

    await expect(responseInterceptor(error)).rejects.toMatchObject({
      normalized: {
        message: 'Network failure',
        status: undefined,
        data: undefined,
      },
    });
  });
});
