/**
 * Tests for QRScanner (#1420)
 *
 * After detecting a QR code the scanner must:
 *  1. Cancel the pending requestAnimationFrame (so the loop stops)
 *  2. Stop all camera tracks (so the stream is released)
 *  3. Call onScan with the parsed result
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { QRScanner, parseStellarQR } from './QRScanner.jsx';

afterEach(() => cleanup());

// ── i18n stub ────────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
}));

// ── useFocusTrap stub ─────────────────────────────────────────────────────────
vi.mock('../hooks/useFocusTrap', () => ({ useFocusTrap: () => {} }));

// ── jsqr stub ────────────────────────────────────────────────────────────────
vi.mock('jsqr', () => ({
  default: vi.fn(() => null), // no QR by default
}));

// ── parseStellarQR unit tests ────────────────────────────────────────────────
describe('parseStellarQR', () => {
  it('parses a plain Stellar address', () => {
    const addr = 'G' + 'A'.repeat(55);
    const result = parseStellarQR(addr);
    expect(result.destination).toBe(addr);
    expect(result.amount).toBe('');
  });

  it('parses a web+stellar:pay URI', () => {
    const uri = 'web+stellar:pay?destination=GABC&amount=10&asset_code=XLM&memo=test&memo_type=text';
    const result = parseStellarQR(uri);
    expect(result.destination).toBe('GABC');
    expect(result.amount).toBe('10');
    expect(result.assetCode).toBe('XLM');
    expect(result.memo).toBe('test');
    expect(result.memoType).toBe('text');
  });

  it('trims whitespace from the raw value', () => {
    const addr = '  GABC  ';
    expect(parseStellarQR(addr).destination).toBe('GABC');
  });

  it('defaults memoType to empty string when no memo present', () => {
    const result = parseStellarQR('web+stellar:pay?destination=GABC');
    expect(result.memoType).toBe('');
  });
});

// ── QRScanner component: stream cleanup on successful scan ────────────────────
describe('QRScanner — stream cleanup after successful scan (#1420)', () => {
  let stopMock;
  let cancelAnimationFrameSpy;
  let rafCallbacks;

  beforeEach(() => {
    stopMock = vi.fn();
    rafCallbacks = [];

    // jsdom doesn't provide navigator.mediaDevices — define it
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {},
        writable: true,
        configurable: true,
      });
    }

    const fakeStream = { getTracks: () => [{ stop: stopMock }] };
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(fakeStream);

    // Make video.play() a no-op
    vi.spyOn(window.HTMLVideoElement.prototype, 'play').mockResolvedValue(undefined);

    // Make video.readyState === HAVE_ENOUGH_DATA (4) immediately
    Object.defineProperty(window.HTMLVideoElement.prototype, 'readyState', {
      get: () => 4, // HTMLVideoElement.HAVE_ENOUGH_DATA
      configurable: true,
    });

    // Stub canvas so getContext('2d').getImageData returns something safe
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    });

    // Control rAF manually
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up the readyState override
    delete window.HTMLVideoElement.prototype.readyState;
  });

  it('cancels the animation frame and stops the stream before calling onScan', async () => {
    const onScan = vi.fn();
    const onClose = vi.fn();

    // Make jsqr return a QR code on every call
    const jsqr = await import('jsqr');
    jsqr.default.mockReturnValue({ data: 'GABC1234' });

    render(<QRScanner onScan={onScan} onClose={onClose} />);

    // Wait for getUserMedia promise to resolve and the first rAF to be queued
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Run the tick — the video is ready + jsqr returns a code, so the
    // fix should: cancelAnimationFrame, stop tracks, then call onScan
    expect(rafCallbacks.length).toBeGreaterThan(0);
    await act(async () => {
      for (const cb of rafCallbacks) {
        await cb();
      }
    });

    expect(cancelAnimationFrameSpy).toHaveBeenCalled();
    expect(stopMock).toHaveBeenCalled();
    expect(onScan).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'GABC1234' }),
    );
  });

  it('stops the stream in the cleanup function when the component unmounts', async () => {
    const { unmount } = render(<QRScanner onScan={vi.fn()} onClose={vi.fn()} />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    unmount();
    expect(stopMock).toHaveBeenCalled();
  });
});
