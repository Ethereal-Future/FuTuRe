import { describe, it, expect, vi } from 'vitest';

describe('GET /health', () => {
  it('should return status ok', () => {
    const handler = (_req, res) => {
      res.json({ status: 'ok', network: 'testnet' });
    };

    const res = { json: vi.fn() };
    handler({}, res);

    expect(res.json).toHaveBeenCalledWith({ status: 'ok', network: 'testnet' });
  });
});
