/**
 * #1121 — SRI middleware fix.
 *
 * SRI is enforced by the browser reading the `integrity` HTML attribute on
 * the tag that requests a resource, never a response header. These tests
 * verify:
 *  1. The manifest builder produces real, verifiable sha384 hashes for
 *     built assets (the "real fix" — out-of-band hashes for HTML to embed).
 *  2. The old middleware no longer sets a header implying SRI compliance.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('SRI asset integrity manifest', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sri-manifest-test-'));
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'console.log("app");');
    fs.mkdirSync(path.join(tmpDir, 'assets'));
    fs.writeFileSync(path.join(tmpDir, 'assets', 'main.css'), 'body { color: red; }');
    // Non-asset file — must be excluded from the manifest.
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html></html>');
    process.env.STATIC_ASSETS_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.STATIC_ASSETS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('produces a verifiable sha384 hash per built .js/.css asset', async () => {
    const { getAssetIntegrityManifest } = await import('../src/utils/sriManifest.js');
    const { verifySRIHash } = await import('../src/utils/sriHash.js');

    const manifest = getAssetIntegrityManifest();

    expect(manifest.algorithm).toBe('sha384');
    expect(Object.keys(manifest.hashes).sort()).toEqual(['/app.js', '/assets/main.css']);
    expect(manifest.hashes['/app.js']).toMatch(/^sha384-/);

    const content = fs.readFileSync(path.join(tmpDir, 'app.js'));
    expect(verifySRIHash(content, manifest.hashes['/app.js'])).toBe(true);
  });

  it('excludes non-JS/CSS files (e.g. index.html) from the manifest', async () => {
    const { getAssetIntegrityManifest } = await import('../src/utils/sriManifest.js');
    const manifest = getAssetIntegrityManifest();
    expect(manifest.hashes['/index.html']).toBeUndefined();
  });

  it('looks up integrity for a single asset path', async () => {
    const { getAssetIntegrity } = await import('../src/utils/sriManifest.js');
    expect(getAssetIntegrity('assets/main.css')).toMatch(/^sha384-/);
    expect(getAssetIntegrity('does-not-exist.js')).toBeNull();
  });

  it('invalidates the cache when an asset changes', async () => {
    const { getAssetIntegrityManifest } = await import('../src/utils/sriManifest.js');
    const before = getAssetIntegrityManifest().hashes['/app.js'];

    // Ensure the mtime actually advances on fast filesystems/CI runners.
    const future = Date.now() / 1000 + 5;
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'console.log("changed");');
    fs.utimesSync(path.join(tmpDir, 'app.js'), future, future);

    const after = getAssetIntegrityManifest().hashes['/app.js'];
    expect(after).not.toBe(before);
  });
});

describe('sriHeadersMiddleware (deprecated diagnostic-only)', () => {
  it('does not set X-SRI-Hash or any header implying SRI compliance', async () => {
    const { sriHeadersMiddleware } = await import('../src/middleware/sriHeaders.js');
    const middleware = sriHeadersMiddleware();

    const headers = {};
    const req = { path: '/assets/app.js' };
    const res = {
      setHeader: vi.fn((name, value) => { headers[name] = value; }),
      send: function (data) { this._sent = data; return this; },
    };
    const next = vi.fn();

    middleware(req, res, next);
    res.send('console.log(1);');

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(headers['X-SRI-Hash']).toBeUndefined();
  });

  it('passes through non-asset requests untouched', async () => {
    const { sriHeadersMiddleware } = await import('../src/middleware/sriHeaders.js');
    const middleware = sriHeadersMiddleware();

    const req = { path: '/api/stellar/network/status' };
    const originalSend = vi.fn();
    const res = { send: originalSend, setHeader: vi.fn() };
    const next = vi.fn();

    middleware(req, res, next);

    // send() must be left completely untouched for non-JS/CSS responses
    expect(res.send).toBe(originalSend);
    expect(next).toHaveBeenCalled();
  });
});
