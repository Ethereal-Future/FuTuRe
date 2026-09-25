import { describe, it, expect } from 'vitest';
import {
  validatePublicDomain,
  validatePublicHttpsUrl,
} from '../src/utils/ssrfValidator.js';

describe('ssrfValidator', () => {
  it('rejects IP addresses passed as domain input', async () => {
    await expect(validatePublicDomain('169.254.169.254')).rejects.toMatchObject({ status: 400 });
    await expect(validatePublicDomain('127.0.0.1:3001')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects hostnames that resolve to RFC1918 private addresses', async () => {
    const lookup = async () => [{ address: '10.42.0.7' }];
    await expect(
      validatePublicDomain('anchor.example', { lookup }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects non-https anchor URLs', async () => {
    await expect(validatePublicHttpsUrl('http://anchor.example/sep31')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('accepts public https hostnames and returns DNS pin data', async () => {
    const lookup = async () => [{ address: '1.2.3.4' }, { address: '2606:4700:4700::1111' }];
    const result = await validatePublicHttpsUrl('https://anchor.example/sep31', { lookup });
    expect(result.parsed.hostname).toBe('anchor.example');
    expect(result.dnsPin.addresses).toEqual(['1.2.3.4', '2606:4700:4700::1111']);
  });
});
