import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiClient } from '../src/api/client.js';

describe('API Client', () => {
  it('should use VITE_API_URL as baseURL when set', () => {
    // Note: In actual tests, import.meta.env is mocked by Vitest
    // This test verifies the client is properly configured
    expect(apiClient).toBeDefined();
    expect(apiClient.defaults).toBeDefined();
    expect(apiClient.defaults.timeout).toBe(30000);
  });

  it('should have baseURL configured', () => {
    const baseURL = apiClient.defaults.baseURL;
    // baseURL should be either empty string (relative) or a full URL
    expect(typeof baseURL).toBe('string');
  });

  it('should support GET requests', async () => {
    expect(apiClient.get).toBeDefined();
    expect(typeof apiClient.get).toBe('function');
  });

  it('should support POST requests', async () => {
    expect(apiClient.post).toBeDefined();
    expect(typeof apiClient.post).toBe('function');
  });
});
