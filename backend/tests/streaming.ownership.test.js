import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();

vi.mock('../src/db/client.js', () => ({
  default: {
    paymentStream: {
      findUnique: (...args) => mockFindUnique(...args),
    },
  },
}));

const { requireStreamAccess, requireStreamOwner } = await import('../src/middleware/streamAuth.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('stream ownership middleware (#1372)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const stream = {
    id: 'stream-a',
    senderId: 'user-a',
    recipientId: 'user-r',
    sender: { id: 'user-a' },
    recipient: { id: 'user-r' },
  };

  it('returns 403 when User B tries to pause User A stream', async () => {
    mockFindUnique.mockResolvedValue(stream);
    const req = { params: { id: 'stream-a' }, user: { sub: 'user-b' } };
    const res = mockRes();
    const next = vi.fn();

    await requireStreamAccess(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the sender to manage their stream', async () => {
    mockFindUnique.mockResolvedValue(stream);
    const req = { params: { id: 'stream-a' }, user: { sub: 'user-a' } };
    const res = mockRes();
    const next = vi.fn();

    await requireStreamAccess(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.stream).toEqual(stream);

    await requireStreamOwner(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('allows the recipient to view but not mutate', async () => {
    mockFindUnique.mockResolvedValue(stream);
    const req = { params: { id: 'stream-a' }, user: { id: 'user-r' } };
    const res = mockRes();
    const next = vi.fn();

    await requireStreamAccess(req, res, next);
    expect(next).toHaveBeenCalled();

    await requireStreamOwner(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/do not own/i);
  });

  it('allows admins to mutate any stream', async () => {
    mockFindUnique.mockResolvedValue(stream);
    const req = { params: { id: 'stream-a' }, user: { sub: 'admin-1', role: 'ADMIN' }, stream };
    const res = mockRes();
    const next = vi.fn();

    await requireStreamOwner(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 404 when stream does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const req = { params: { id: 'missing' }, user: { sub: 'user-a' } };
    const res = mockRes();
    const next = vi.fn();

    await requireStreamAccess(req, res, next);
    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });
});
