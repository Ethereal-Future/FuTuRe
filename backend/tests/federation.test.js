import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimFederationAddress,
  isFederationAddress,
  resolveFederationAddress,
} from '../src/services/federation.js';
import prisma from '../src/db/client.js';

vi.mock('../src/db/client.js', () => ({
  default: {
    setting: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      upsert: vi.fn(),
    },
  },
}));

describe('Stellar federation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STELLAR_FEDERATION_DOMAIN = 'futureremit.app';
  });

  it('detects valid federation addresses', () => {
    expect(isFederationAddress('alice*futureremit.app')).toBe(true);
    expect(isFederationAddress('GABC')).toBe(false);
  });

  it('resolves claimed federation addresses to Stellar accounts', async () => {
    vi.mocked(prisma.setting.findFirst).mockResolvedValue({
      federationAddress: 'alice*futureremit.app',
      user: { publicKey: 'G'.padEnd(56, 'A') },
    });

    const result = await resolveFederationAddress('alice*futureremit.app');

    expect(result.account_id).toBe('G'.padEnd(56, 'A'));
    expect(result.stellar_address).toBe('alice*futureremit.app');
  });

  it('claims a federation address for a user settings record', async () => {
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: 'user-1', publicKey: 'G'.padEnd(56, 'A') });
    vi.mocked(prisma.setting.upsert).mockResolvedValue({ federationAddress: 'alice*futureremit.app' });

    const result = await claimFederationAddress({
      publicKey: 'G'.padEnd(56, 'A'),
      localPart: 'Alice',
    });

    expect(result.federationAddress).toBe('alice*futureremit.app');
    expect(prisma.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { federationAddress: 'alice*futureremit.app' },
    }));
  });
});
